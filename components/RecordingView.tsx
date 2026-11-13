"use client";

import { Check, Mic, MicOff, MonitorSpeaker, Square, TriangleAlert, Video, VideoOff } from "lucide-react";
import { useEffect, useState } from "react";
import { fmtClock } from "@/lib/format";
import { useChunks } from "@/lib/hooks";
import { CHUNK_MS } from "@/lib/recorder";
import type { RecordingState } from "@/lib/useRecording";
import { Spinner } from "./ui";

const BARS = 48;

/** Below this the meeting stream counts as silent. */
const HEARD = 0.02;
/** How long the meeting audio may stay silent (while sharing) before we warn. */
const SILENT_WARN_MS = 12_000;

export function RecordingView({
  recording,
  elapsed,
  level,
  sourceLevels,
  surface,
  onStop,
}: {
  recording: RecordingState;
  elapsed: () => number;
  level: () => number;
  sourceLevels: () => { meeting: number; mic: number };
  surface: () => "browser" | "window" | "monitor" | undefined;
  onStop: () => void;
}) {
  const chunks = useChunks(recording.meetingId);
  const [levels, setLevels] = useState<number[]>(() => Array(BARS).fill(0));
  const [ms, setMs] = useState(0);
  const [sources, setSources] = useState({ meeting: 0, mic: 0 });
  // When the meeting stream was last heard (or when sharing began), to spot a silent share.
  const [lastHeard, setLastHeard] = useState(() => elapsed());

  useEffect(() => {
    let frame = 0;
    let last = 0;
    const loop = (t: number) => {
      if (t - last > 80) {
        last = t;
        const now = elapsed();
        const s = sourceLevels();
        setLevels((prev) => [...prev.slice(1), level()]);
        setSources(s);
        setMs(now);
        if (s.meeting > HEARD) setLastHeard(now);
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [elapsed, level, sourceLevels]);

  // Sharing again restarts the silence timer.
  useEffect(() => {
    if (!recording.shareLost) setLastHeard(elapsed());
  }, [recording.shareLost, elapsed]);

  const currentPart = Math.floor(ms / CHUNK_MS) + 1;
  const silent = ms > 8000 && levels.every((l) => l < 0.02);
  const meetingSilent = !recording.shareLost && !silent && ms - lastHeard > SILENT_WARN_MS;
  const shared = surface();

  return (
    <section className="flex min-h-[480px] flex-1 flex-col items-center justify-center px-6 py-10">
      <span className="badge badge-danger">
        <span className="rec-pulse" />
        {recording.stopping ? "Saving recording" : "Recording"}
      </span>
      <div className="mt-4 text-[56px] leading-none font-bold tracking-[-1.5px] tabular-nums">{fmtClock(ms / 1000)}</div>

      <div className="mt-8 flex h-20 w-full max-w-xl items-center justify-center gap-[3px]" aria-hidden>
        {levels.map((l, i) => (
          <span key={i} className="w-1.5 rounded-full bg-primary transition-[height] duration-75" style={{ height: `${Math.max(6, l * 100)}%`, opacity: 0.3 + (i / BARS) * 0.7 }} />
        ))}
      </div>

      <div className="mt-6 grid w-full max-w-xl gap-2">
        <Meter label="Meeting audio" value={sources.meeting} off={recording.shareLost} />
        <Meter label="Your mic" value={sources.mic} off={!recording.micActive} />
      </div>

      {silent && (
        <p className="mt-4 flex max-w-xl items-center gap-3 rounded-[var(--radius-md)] bg-warning-soft px-4 py-3 text-[13px] font-semibold text-[#7a5410]">
          <TriangleAlert size={16} className="shrink-0 text-warning" /> No sound detected yet. Is the meeting playing audio?
        </p>
      )}
      {meetingSilent && (
        <div className="mt-4 flex max-w-xl gap-3 rounded-[var(--radius-md)] bg-warning-soft px-4 py-3 text-[13px] leading-relaxed text-[#7a5410]">
          <TriangleAlert size={16} className="mt-0.5 shrink-0 text-warning" />
          <div>
            <p className="font-bold">No sound is coming from the shared {shared === "monitor" ? "screen" : "tab"} — only your mic is being recorded.</p>
            {shared === "monitor" ? (
              <p className="mt-1">
                Windows only shares sound from its <b>default output device</b>. In Zoom/Teams, set the speaker to the same device Windows uses (Settings › System › Sound › Output), or make
                your headset the Windows default. If that doesn&apos;t help, stop and share again with <b>“Also share system audio”</b> turned on.
              </p>
            ) : (
              <p className="mt-1">
                Make sure the meeting is playing in the shared tab and the tab isn&apos;t muted. If the meeting runs in a desktop app, stop and share <b>Entire screen</b> with{" "}
                <b>“Also share system audio”</b> instead.
              </p>
            )}
          </div>
        </div>
      )}

      <div className="card mt-8 w-full max-w-xl">
        <Row
          icon={<MonitorSpeaker size={18} />}
          label="Tab audio"
          value={recording.shareLost ? "Not captured — tab sharing stopped" : recording.sourceLabel}
          warn={recording.shareLost}
        />
        <Row
          icon={recording.micActive ? <Mic size={18} /> : <MicOff size={18} />}
          label="Microphone"
          value={recording.micActive ? recording.micLabel || "On — your voice is included" : "Off"}
        />
        <Row
          icon={recording.videoActive ? <Video size={18} /> : <VideoOff size={18} />}
          label="Screen video"
          value={recording.videoActive ? "On — saved to your recordings folder" : "Off"}
        />
      </div>

      <ol className="mt-5 flex w-full max-w-xl flex-wrap gap-2">
        {chunks.map((c) => (
          <li key={c.id} className="badge badge-success" title="Saved in this browser as a backup">
            <Check size={12} strokeWidth={3} />
            Part {c.index + 1} saved
          </li>
        ))}
        <li className="badge">
          <span className="size-1.5 rounded-full bg-danger" /> Part {currentPart} recording
        </li>
      </ol>

      <button type="button" onClick={onStop} disabled={recording.stopping} className="btn btn-danger mt-10 px-7 py-3">
        {recording.stopping ? <Spinner /> : <Square size={14} fill="currentColor" />}
        {recording.stopping ? "Saving…" : "Stop & Transcribe"}
      </button>
      <p className="mt-4 max-w-md text-center text-xs leading-relaxed text-ink-2">
        Keep this tab open while recording. When you stop, the whole recording is transcribed in one go so speakers stay consistent. Every 10 minutes a backup part is saved in case the tab closes.
      </p>
    </section>
  );
}

function Meter({ label, value, off }: { label: string; value: number; off?: boolean }) {
  return (
    <div className="flex items-center gap-3 text-[13px]">
      <span className="w-28 shrink-0 font-semibold text-ink-2">{label}</span>
      <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-sunken">
        <span className="block h-full rounded-full bg-primary transition-[width] duration-75" style={{ width: off ? 0 : `${Math.min(100, value * 140)}%` }} />
      </span>
      <span className="w-14 text-right text-xs text-muted">{off ? "off" : value > HEARD ? "sound" : "silent"}</span>
    </div>
  );
}

function Row({ icon, label, value, warn }: { icon: React.ReactNode; label: string; value: string; warn?: boolean }) {
  return (
    <div className={`flex items-center gap-3 border-t border-line px-5 py-3.5 first:border-t-0 ${warn ? "bg-danger-soft" : ""}`}>
      <span className={warn ? "text-danger" : "text-primary"}>{icon}</span>
      <span className="w-24 shrink-0 font-semibold text-ink-2">{label}</span>
      <span className={`truncate font-bold ${warn ? "text-danger" : ""}`}>{value}</span>
    </div>
  );
}
