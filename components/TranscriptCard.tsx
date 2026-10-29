"use client";

import { Download, FileText, RefreshCw, TriangleAlert } from "lucide-react";
import { fmtClock, transcriptToText } from "@/lib/format";
import { retranscribeMeeting } from "@/lib/pipeline";
import type { Chunk, Meeting, Segment } from "@/lib/types";
import { CopyButton, EmptyState, IconButton, Spinner, downloadText } from "./ui";

const SPEAKER_COLORS = ["text-teal-300", "text-amber-300", "text-sky-300", "text-rose-300", "text-violet-300", "text-lime-300"];

export function TranscriptCard({ meeting, chunks, onSeek }: { meeting: Meeting; chunks: Chunk[]; onSeek: (sec: number) => void }) {
  // While processing, show whatever parts are already done.
  const segments = meeting.status === "ready" ? meeting.transcript : chunks.flatMap((c) => (c.status === "done" ? c.segments ?? [] : []));
  const text = transcriptToText(segments);
  const busy = meeting.status === "processing" || meeting.status === "recording";

  return (
    <section className="flex min-h-[360px] flex-1 flex-col overflow-hidden rounded-2xl bg-panel">
      <header className="flex items-center justify-between border-b border-line px-5 py-3.5">
        <h2 className="flex items-center gap-2 font-semibold text-gray-100">
          <FileText className="size-4.5 text-amber-400" />
          Transcript
        </h2>
        <div className="flex">
          <CopyButton text={text} disabled={!segments.length} />
          <IconButton title="Download .txt" disabled={!segments.length} onClick={() => downloadText(`${meeting.title || "transcript"}.txt`, text)}>
            <Download className="size-4" />
          </IconButton>
          <IconButton title="Transcribe again" disabled={busy || !chunks.length} onClick={() => void retranscribeMeeting(meeting.id)}>
            <RefreshCw className="size-4" />
          </IconButton>
        </div>
      </header>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {meeting.status === "error" ? (
          <EmptyState icon={<TriangleAlert className="size-8" />} title="The recording could not be transcribed" tone="error">
            <p>{meeting.error || "Something went wrong. Please try again."}</p>
            {chunks.length > 0 && (
              <button
                type="button"
                onClick={() => void retranscribeMeeting(meeting.id)}
                className="mt-4 rounded-lg bg-accent px-4 py-2 font-medium text-white hover:bg-accent-hover"
              >
                Try again
              </button>
            )}
          </EmptyState>
        ) : segments.length ? (
          <>
            {busy && <Progress chunks={chunks} />}
            <TranscriptLines segments={segments} onSeek={onSeek} />
          </>
        ) : busy ? (
          <EmptyState icon={<Spinner className="size-6" />} title={meeting.status === "recording" ? "Recording in progress" : "Transcribing…"}>
            {meeting.status === "recording" ? "Each 10-minute part is transcribed while you record." : <ProgressText chunks={chunks} />}
          </EmptyState>
        ) : (
          <EmptyState icon={<FileText className="size-6" />} title="No speech detected">
            The recording did not contain any speech that could be transcribed.
          </EmptyState>
        )}
      </div>
    </section>
  );
}

function ProgressText({ chunks }: { chunks: Chunk[] }) {
  const done = chunks.filter((c) => c.status === "done").length;
  if (chunks.length <= 1) return <>This usually takes under a minute.</>;
  return (
    <>
      Part {Math.min(done + 1, chunks.length)} of {chunks.length}…
    </>
  );
}

function Progress({ chunks }: { chunks: Chunk[] }) {
  return (
    <div className="sticky top-0 flex items-center gap-2 border-b border-line bg-panel/95 px-5 py-2 text-sm text-gray-400 backdrop-blur">
      <Spinner className="size-3.5 text-accent-hover" />
      Transcribing… <ProgressText chunks={chunks} />
    </div>
  );
}

function TranscriptLines({ segments, onSeek }: { segments: Segment[]; onSeek: (sec: number) => void }) {
  const speakers = [...new Set(segments.map((s) => s.speaker))];
  return (
    <ol className="space-y-3 px-5 py-4">
      {segments.map((s, i) => {
        const sameSpeaker = i > 0 && segments[i - 1].speaker === s.speaker;
        return (
          <li key={i} className={sameSpeaker ? "-mt-1.5" : ""}>
            {!sameSpeaker && (
              <div className={`mb-0.5 text-sm font-medium ${SPEAKER_COLORS[speakers.indexOf(s.speaker) % SPEAKER_COLORS.length]}`}>{s.speaker}</div>
            )}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => onSeek(s.start)}
                title="Play from here"
                className="mt-0.5 shrink-0 font-mono text-xs text-gray-500 tabular-nums hover:text-accent-hover"
              >
                {fmtClock(s.start)}
              </button>
              <p className="text-[0.925rem] leading-relaxed text-gray-300">{s.text}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
