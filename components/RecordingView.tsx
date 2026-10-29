"use client";

import { Check, Mic, MicOff, MonitorSpeaker, Square, TriangleAlert, Video, VideoOff } from "lucide-react";
import { useEffect, useState } from "react";
import { fmtClock } from "@/lib/format";
import { useChunks } from "@/lib/hooks";
import { CHUNK_MS } from "@/lib/recorder";
import type { RecordingState } from "@/lib/useRecording";
import { Spinner } from "./ui";

const BARS = 48;

export function RecordingView({
  recording,
  elapsed,
  level,
  onStop,
}: {
  recording: RecordingState;
  elapsed: () => number;
  level: () => number;
  onStop: () => void;
}) {
  const chunks = useChunks(recording.meetingId);
  const [levels, setLevels] = useState<number[]>(() => Array(BARS).fill(0));
  const [ms, setMs] = useState(0);

  useEffect(() => {
    let frame = 0;
    let last = 0;
    const loop = (t: number) => {
      if (t - last > 80) {
        last = t;
        setLevels((prev) => [...prev.slice(1), level()]);
        setMs(elapsed());
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [elapsed, level]);

  const currentPart = Math.floor(ms / CHUNK_MS) + 1;
  const silent = ms > 8000 && levels.every((l) => l < 0.02);

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

      {silent && (
        <p className="mt-4 flex items-center gap-3 rounded-[var(--radius-md)] bg-warning-soft px-4 py-3 text-[13px] font-semibold text-[#7a5410]">
          <TriangleAlert size={16} className="text-warning" /> No sound detected yet. Is the meeting tab playing audio?
        </p>
      )}

      <div className="card mt-8 w-full max-w-xl">
        <Row icon={<MonitorSpeaker size={18} />} label="Tab audio" value={recording.sourceLabel} />
        <Row
          icon={recording.micActive ? <Mic size={18} /> : <MicOff size={18} />}
          label="Microphone"
          value={recording.micActive ? "On — your voice is included" : "Off"}
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

function Row({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 border-t border-line px-5 py-3.5 first:border-t-0">
      <span className="text-primary">{icon}</span>
      <span className="w-24 shrink-0 font-semibold text-ink-2">{label}</span>
      <span className="truncate font-bold">{value}</span>
    </div>
  );
}
