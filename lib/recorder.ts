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

export type RecordingResult = { blob: Blob; mimeType: string; durationMs: number };

type Callbacks = {
  onChunk: (chunk: RecordedChunk) => void;
  /** The user clicked "Stop sharing" in Chrome, or the 6-hour limit was hit. */
  onAutoStop: (reason: "ended" | "max") => void;
};

export class NoTabAudioError extends Error {
  constructor() {
    super(
      'No audio was shared. Pick a Chrome tab and make sure "Also share tab audio" is turned on.',
    );
  }
}

function pickMimeType() {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
}

/**
 * Records a shared browser tab's audio, mixed with the user's microphone.
 *
 * Two MediaRecorders run on the same mixed stream: one produces the full file for
 * playback, the other is restarted every CHUNK_MS so each slice is a valid file
 * that can be transcribed on its own.
 */
export class TabRecorder {
  mimeType = "";
  sourceLabel = "";
  micActive = false;

  private ctx: AudioContext | null = null;
  private display: MediaStream | null = null;
  private mic: MediaStream | null = null;
  private mixed: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private levelBuffer: Float32Array<ArrayBuffer> | null = null;

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
    if (!this.analyser || !this.levelBuffer) return 0;
    this.analyser.getFloatTimeDomainData(this.levelBuffer);
    let sum = 0;
    for (const v of this.levelBuffer) sum += v * v;
    return Math.min(1, Math.sqrt(sum / this.levelBuffer.length) * 5);
  }

  async start(includeMic: boolean) {
    // Created before any await so it is tied to the click and not left suspended.
    const ctx = new AudioContext();
    this.ctx = ctx;

    try {
      const options = {
        video: { frameRate: 1 },
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        preferCurrentTab: false,
        selfBrowserSurface: "exclude",
        surfaceSwitching: "include",
        systemAudio: "include",
      };
      const display = await navigator.mediaDevices.getDisplayMedia(
        options as unknown as DisplayMediaStreamOptions,
      );
      this.display = display;

      const tabAudio = display.getAudioTracks();
      if (tabAudio.length === 0) throw new NoTabAudioError();
      this.sourceLabel = display.getVideoTracks()[0]?.label || tabAudio[0].label || "Shared tab";

      if (includeMic) {
        try {
          this.mic = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          });
          this.micActive = true;
        } catch {
          // Recording the tab alone is still useful; the UI shows the mic as off.
          this.micActive = false;
        }
      }

      await ctx.resume();
      const destination = ctx.createMediaStreamDestination();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      this.analyser = analyser;
      this.levelBuffer = new Float32Array(analyser.fftSize);

      for (const stream of [new MediaStream(tabAudio), this.mic]) {
        if (!stream) continue;
        const source = ctx.createMediaStreamSource(stream);
        source.connect(destination);
        source.connect(analyser);
      }
      this.mixed = destination.stream;

      this.mimeType = pickMimeType();
      if (!this.mimeType) throw new Error("This browser cannot record audio. Please use Chrome or Edge.");

      // Ending the share from Chrome's own "Stop sharing" bar stops the recording.
      for (const track of display.getTracks()) {
        track.addEventListener("ended", () => this.cb.onAutoStop("ended"), { once: true });
      }

      this.t0 = performance.now();
      this.full = new MediaRecorder(this.mixed, { mimeType: this.mimeType, audioBitsPerSecond: 48000 });
      this.full.ondataavailable = (e) => e.data.size && this.fullParts.push(e.data);
      this.full.start(1000);
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

      const fullStopped = new Promise<void>((resolve) => {
        if (!this.full || this.full.state === "inactive") return resolve();
        this.full.addEventListener("stop", () => resolve(), { once: true });
        this.full.stop();
      });
      this.endChunk(durationMs);

      await Promise.all([fullStopped, ...this.chunkDone]);
      this.releaseDevices();
      return { blob: new Blob(this.fullParts, { type: this.mimeType }), mimeType: this.mimeType, durationMs };
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
