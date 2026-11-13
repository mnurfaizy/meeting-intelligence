"use client";

/** Each chunk is a standalone audio file that gets transcribed while recording continues. */
export const CHUNK_MS = 10 * 60 * 1000;
/** Same hard limit as the reference app. */
export const MAX_RECORDING_MS = 6 * 60 * 60 * 1000;

export type RecordedChunk = {
  index: number;
  blob: Blob;
  mimeType: string;
  startMs: number;
  durationMs: number;
};

export type RecordingResult = {
  blob: Blob;
  mimeType: string;
  durationMs: number;
  /** Screen video with the same mixed audio, when video recording was turned on. */
  video?: { blob: Blob; mimeType: string };
};

type Callbacks = {
  onChunk: (chunk: RecordedChunk) => void;
  /**
   * Every second's worth of the full recording (and of the screen video). Joined in order these
   * parts form a playable file, so saving them as they come means a closed tab loses seconds, not minutes.
   */
  onPart?: (part: { kind: "audio" | "video"; seq: number; blob: Blob; mimeType: string }) => void;
  /**
   * Tab sharing ended ("Stop sharing" clicked, tab closed, Chrome cut it off). Recording keeps
   * going (the microphone is still captured) until the user shares a tab again or stops.
   */
  onShareEnded: () => void;
  /** The 6-hour limit was hit. */
  onAutoStop: (reason: "max") => void;
};

/** What the user picked in Chrome's share dialog. */
type Surface = "browser" | "window" | "monitor" | undefined;

/** The share has no audio; the message says how to fix it for what was picked. */
export class NoTabAudioError extends Error {
  constructor(surface: Surface) {
    super(
      surface === "window"
        ? 'Chrome can\'t record sound from an app window. For a desktop app (Zoom, Teams…), choose "Entire screen" and turn on "Also share system audio". For a meeting in the browser, choose its Chrome tab.'
        : surface === "monitor"
          ? 'No sound was shared. Choose "Entire screen" again and turn on "Also share system audio" at the bottom of the dialog.'
          : 'No audio was shared. Pick the meeting\'s Chrome tab and make sure "Also share tab audio" is turned on.',
    );
  }
}

const pickMimeType = (candidates: string[]) => candidates.find((t) => MediaRecorder.isTypeSupported(t)) ?? "";

/** About 450 MB per hour: sharp enough for slides and shared screens. */
const VIDEO_BITS_PER_SECOND = 1_000_000;

/**
 * Records a shared browser tab's audio, mixed with the user's microphone.
 *
 * Two MediaRecorders run on the same mixed stream: one produces the full file for
 * playback, the other is restarted every CHUNK_MS so each slice is a valid file
 * that can be transcribed on its own. With video on, a third one records the tab's
 * picture together with the mixed audio.
 */
export class TabRecorder {
  mimeType = "";
  sourceLabel = "";
  micActive = false;
  videoActive = false;
  private videoMimeType = "";
  private video: MediaRecorder | null = null;
  private videoParts: Blob[] = [];

  /** False while tab sharing is lost (see onShareEnded). */
  shareActive = false;

  private ctx: AudioContext | null = null;
  private display: MediaStream | null = null;
  private destination: MediaStreamAudioDestinationNode | null = null;
  private tabSource: MediaStreamAudioSourceNode | null = null;
  private mic: MediaStream | null = null;
  private mixed: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  /** Separate meters, so a silent meeting stream is noticed even while the mic picks up sound. */
  private meetingAnalyser: AnalyserNode | null = null;
  private micAnalyser: AnalyserNode | null = null;
  private levelBuffer: Float32Array<ArrayBuffer> | null = null;
  /** What was shared: a Chrome tab ("browser"), an app window or the entire screen ("monitor"). */
  surface: Surface;

  private full: MediaRecorder | null = null;
  private fullParts: Blob[] = [];
  private chunk: { rec: MediaRecorder; index: number; startMs: number; endMs?: number } | null = null;
  private chunkIndex = 0;
  private chunkDone: Promise<void>[] = [];

  private t0 = 0;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private stopPromise: Promise<RecordingResult> | null = null;

  constructor(private cb: Callbacks) {}

  elapsed() {
    return this.t0 ? performance.now() - this.t0 : 0;
  }

  /** 0..1 loudness of the mixed signal, for the level meter. */
  level() {
    return this.rms(this.analyser);
  }

  /** 0..1 loudness of the shared meeting audio and of the microphone, measured separately. */
  sourceLevels() {
    return { meeting: this.shareActive ? this.rms(this.meetingAnalyser) : 0, mic: this.rms(this.micAnalyser) };
  }

  private rms(analyser: AnalyserNode | null) {
    if (!analyser || !this.levelBuffer) return 0;
    analyser.getFloatTimeDomainData(this.levelBuffer);
    let sum = 0;
    for (const v of this.levelBuffer) sum += v * v;
    return Math.min(1, Math.sqrt(sum / this.levelBuffer.length) * 5);
  }

  /** Asks Chrome which tab to share; fails if the user did not turn on "Also share tab audio". */
  private async requestDisplay(includeVideo: boolean) {
    const options = {
      // Chrome always shares a picture; without video recording, 1 fps keeps that nearly free.
      video: includeVideo ? { frameRate: { ideal: 15, max: 30 } } : { frameRate: 1 },
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      preferCurrentTab: false,
      selfBrowserSurface: "exclude",
      surfaceSwitching: "include",
      systemAudio: "include",
    };
    const display = await navigator.mediaDevices.getDisplayMedia(options as unknown as DisplayMediaStreamOptions);
    if (display.getAudioTracks().length === 0) {
      const surface = (display.getVideoTracks()[0]?.getSettings() as { displaySurface?: Surface }).displaySurface;
      display.getTracks().forEach((t) => t.stop());
      throw new NoTabAudioError(surface);
    }
    return display;
  }

  /** Feeds a shared tab's audio into the recording and watches for the share ending. */
  private attachShare(display: MediaStream) {
    const tabAudio = display.getAudioTracks();
    this.display = display;
    this.sourceLabel = display.getVideoTracks()[0]?.label || tabAudio[0].label || "Shared tab";
    this.surface = (display.getVideoTracks()[0]?.getSettings() as { displaySurface?: Surface }).displaySurface;
    if (this.ctx && this.destination && this.analyser) {
      this.tabSource = this.ctx.createMediaStreamSource(new MediaStream(tabAudio));
      this.tabSource.connect(this.destination);
      this.tabSource.connect(this.analyser);
      if (this.meetingAnalyser) this.tabSource.connect(this.meetingAnalyser);
    }
    this.shareActive = true;
    const onEnded = () => {
      if (this.display !== display || !this.shareActive || this.stopPromise) return;
      this.shareActive = false;
      this.tabSource?.disconnect();
      this.tabSource = null;
      this.cb.onShareEnded();
    };
    for (const track of display.getTracks()) track.addEventListener("ended", onEnded, { once: true });
  }

  /**
   * Shares a tab again after sharing was lost, continuing the same recording. Must be called
   * from a click. Screen video (if on) is not resumed; audio continues in the same file.
   */
  async reshare() {
    const display = await this.requestDisplay(false);
    this.display?.getTracks().forEach((t) => t.stop());
    this.attachShare(display);
  }

  /** Name of the microphone actually used, e.g. "Headset Microphone (WH-1000XM4)". */
  micLabel = "";

  /** Opens the chosen microphone; falls back to the system default if it is unplugged. */
  private async openMic(deviceId?: string) {
    const processing = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
    if (deviceId) {
      try {
        return await navigator.mediaDevices.getUserMedia({ audio: { ...processing, deviceId: { exact: deviceId } } });
      } catch {
        // The chosen device is gone (headset unplugged): use the default instead.
      }
    }
    return navigator.mediaDevices.getUserMedia({ audio: processing });
  }

  async start(includeMic: boolean, includeVideo = false, micDeviceId?: string) {
    // Created before any await so it is tied to the click and not left suspended.
    const ctx = new AudioContext();
    this.ctx = ctx;

    try {
      const display = await this.requestDisplay(includeVideo);
      this.display = display;

      if (includeMic) {
        try {
          this.mic = await this.openMic(micDeviceId);
          this.micLabel = this.mic.getAudioTracks()[0]?.label ?? "";
          this.micActive = true;
        } catch {
          // Recording the tab alone is still useful; the UI shows the mic as off.
          this.micActive = false;
        }
      }

      await ctx.resume();
      const destination = ctx.createMediaStreamDestination();
      this.destination = destination;
      const newAnalyser = () => Object.assign(ctx.createAnalyser(), { fftSize: 1024 });
      const analyser = newAnalyser();
      this.analyser = analyser;
      this.meetingAnalyser = newAnalyser();
      this.micAnalyser = newAnalyser();
      this.levelBuffer = new Float32Array(analyser.fftSize);

      if (this.mic) {
        const micSource = ctx.createMediaStreamSource(this.mic);
        micSource.connect(destination);
        micSource.connect(analyser);
        micSource.connect(this.micAnalyser);
      }
      // The tab is connected separately so it can be swapped if sharing is lost and resumed.
      this.attachShare(display);
      this.mixed = destination.stream;

      this.mimeType = pickMimeType(["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]);
      if (!this.mimeType) throw new Error("This browser cannot record audio. Please use Chrome or Edge.");
      const picture = display.getVideoTracks()[0];
      if (includeVideo && picture) {
        this.videoMimeType = pickMimeType(["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]);
        this.videoActive = Boolean(this.videoMimeType);
      }

      this.t0 = performance.now();
      this.full = new MediaRecorder(this.mixed, { mimeType: this.mimeType, audioBitsPerSecond: 48000 });
      this.full.ondataavailable = (e) => {
        if (!e.data.size) return;
        this.fullParts.push(e.data);
        this.cb.onPart?.({ kind: "audio", seq: this.fullParts.length - 1, blob: e.data, mimeType: this.mimeType });
      };
      this.full.start(1000);
      if (this.videoActive) {
        this.video = new MediaRecorder(new MediaStream([picture, ...this.mixed.getAudioTracks()]), {
          mimeType: this.videoMimeType,
          videoBitsPerSecond: VIDEO_BITS_PER_SECOND,
          audioBitsPerSecond: 64000,
        });
        this.video.ondataavailable = (e) => {
          if (!e.data.size) return;
          this.videoParts.push(e.data);
          this.cb.onPart?.({ kind: "video", seq: this.videoParts.length - 1, blob: e.data, mimeType: this.videoMimeType });
        };
        this.video.start(1000);
      }
      this.startChunk();

      this.timers.push(setInterval(() => this.rotateChunk(), CHUNK_MS));
      this.timers.push(setTimeout(() => this.cb.onAutoStop("max"), MAX_RECORDING_MS));
    } catch (err) {
      this.releaseDevices();
      throw err;
    }
  }

  stop(): Promise<RecordingResult> {
    this.stopPromise ??= (async () => {
      const durationMs = this.elapsed();
      this.timers.forEach((t) => clearTimeout(t));
      this.timers = [];

      const stopped = (rec: MediaRecorder | null) =>
        new Promise<void>((resolve) => {
          if (!rec || rec.state === "inactive") return resolve();
          rec.addEventListener("stop", () => resolve(), { once: true });
          rec.stop();
        });
      const fullStopped = stopped(this.full);
      const videoStopped = stopped(this.video);
      this.endChunk(durationMs);

      await Promise.all([fullStopped, videoStopped, ...this.chunkDone]);
      this.releaseDevices();
      return {
        blob: new Blob(this.fullParts, { type: this.mimeType }),
        mimeType: this.mimeType,
        durationMs,
        video: this.videoParts.length
          ? { blob: new Blob(this.videoParts, { type: this.videoMimeType }), mimeType: this.videoMimeType }
          : undefined,
      };
    })();
    return this.stopPromise;
  }

  private startChunk() {
    const rec = new MediaRecorder(this.mixed!, { mimeType: this.mimeType, audioBitsPerSecond: 32000 });
    const current = { rec, index: this.chunkIndex++, startMs: this.elapsed(), endMs: undefined as number | undefined };
    const parts: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
    this.chunkDone.push(
      new Promise<void>((resolve) => {
        rec.onstop = () => {
          const endMs = current.endMs ?? this.elapsed();
          this.cb.onChunk({
            index: current.index,
            blob: new Blob(parts, { type: this.mimeType }),
            mimeType: this.mimeType,
            startMs: current.startMs,
            durationMs: endMs - current.startMs,
          });
          resolve();
        };
      }),
    );
    rec.start();
    this.chunk = current;
  }

  private endChunk(atMs: number) {
    const current = this.chunk;
    if (!current || current.rec.state === "inactive") return;
    current.endMs = atMs;
    current.rec.stop();
  }

  private rotateChunk() {
    const previous = this.chunk;
    const at = this.elapsed();
    this.startChunk();
    if (previous) {
      previous.endMs = at;
      previous.rec.stop();
    }
  }

  private releaseDevices() {
    this.display?.getTracks().forEach((t) => t.stop());
    this.mic?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close().catch(() => {});
    this.display = this.mic = null;
    this.ctx = null;
    this.analyser = null;
  }
}
