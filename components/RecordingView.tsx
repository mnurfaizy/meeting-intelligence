"use client";

import { Check, Mic, MicOff, MonitorSpeaker, Square, TriangleAlert } from "lucide-react";
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
    <section className="flex min-h-[480px] flex-1 flex-col items-center justify-center rounded-2xl bg-panel px-6 py-10">
      <div className="flex items-center gap-2.5 text-sm font-medium tracking-wide text-red-400 uppercase">
        <span className="size-2.5 animate-pulse rounded-full bg-red-500" />
        {recording.stopping ? "Saving recording" : "Recording"}
      </div>
      <div className="mt-3 font-mono text-6xl font-light text-gray-100 tabular-nums">{fmtClock(ms / 1000)}</div>

      <div className="mt-8 flex h-20 w-full max-w-xl items-center justify-center gap-[3px]" aria-hidden>
        {levels.map((l, i) => (
          <span key={i} className="w-1.5 rounded-full bg-accent transition-[height] duration-75" style={{ height: `${Math.max(6, l * 100)}%`, opacity: 0.35 + (i / BARS) * 0.65 }} />
        ))}
      </div>

      {silent && (
        <p className="mt-4 flex items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
          <TriangleAlert className="size-4" /> No sound detected yet. Is the meeting tab playing audio?
        </p>
      )}

      <div className="mt-8 grid w-full max-w-xl gap-2 text-sm">
        <Row icon={<MonitorSpeaker className="size-4" />} label="Tab audio" value={recording.sourceLabel} />
        <Row
          icon={recording.micActive ? <Mic className="size-4" /> : <MicOff className="size-4" />}
          label="Microphone"
          value={recording.micActive ? "On — your voice is included" : "Off"}
        />
      </div>

      <ol className="mt-6 flex w-full max-w-xl flex-wrap gap-2">
        {chunks.map((c) => (
          <li key={c.id} className="flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-xs text-gray-400">
            {c.status === "done" ? (
              <Check className="size-3.5 text-accent-hover" />
            ) : c.status === "error" ? (
              <TriangleAlert className="size-3.5 text-red-400" />
            ) : (
              <Spinner className="size-3.5" />
            )}
            Part {c.index + 1}
          </li>
        ))}
        <li className="flex items-center gap-1.5 rounded-full border border-dashed border-line px-3 py-1 text-xs text-gray-500">
          <span className="size-1.5 rounded-full bg-red-500" /> Part {currentPart} recording
        </li>
      </ol>

      <button
        type="button"
        onClick={onStop}
        disabled={recording.stopping}
        className="mt-10 flex items-center gap-2.5 rounded-full bg-red-600 px-7 py-3 font-medium text-white hover:bg-red-500 disabled:opacity-60"
      >
        {recording.stopping ? <Spinner /> : <Square className="size-4 fill-current" />}
        {recording.stopping ? "Saving…" : "Stop & Transcribe"}
      </button>
      <p className="mt-4 max-w-md text-center text-xs leading-relaxed text-gray-500">
        Keep this tab open while recording. Audio is transcribed in 10-minute parts in the background, so the transcript is ready soon after you stop.
      </p>
    </section>
  );
}

function Row({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg bg-panel-2/60 px-4 py-2.5">
      <span className="text-gray-400">{icon}</span>
      <span className="w-24 shrink-0 text-gray-400">{label}</span>
      <span className="truncate text-gray-200">{value}</span>
    </div>
  );
}
