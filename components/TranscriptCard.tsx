"use client";

import { Download, FileText, RefreshCw, TriangleAlert } from "lucide-react";
import { fmtClock, transcriptToText } from "@/lib/format";
import { retranscribeMeeting } from "@/lib/pipeline";
import type { Meeting, Segment } from "@/lib/types";
import { CopyButton, EmptyState, IconButton, Spinner, downloadText } from "./ui";

const SPEAKER_COLORS = ["text-teal-300", "text-amber-300", "text-sky-300", "text-rose-300", "text-violet-300", "text-lime-300"];

export function TranscriptCard({ meeting, onSeek }: { meeting: Meeting; onSeek: (sec: number) => void }) {
  const segments = meeting.transcript;
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
          <IconButton title="Transcribe again" disabled={busy} onClick={() => void retranscribeMeeting(meeting.id)}>
            <RefreshCw className="size-4" />
          </IconButton>
        </div>
      </header>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {meeting.status === "error" ? (
          <EmptyState icon={<TriangleAlert className="size-8" />} title="The recording could not be transcribed" tone="error">
            <p>{meeting.error || "Something went wrong. Please try again."}</p>
            <button
              type="button"
              onClick={() => void retranscribeMeeting(meeting.id)}
              className="mt-4 rounded-lg bg-accent px-4 py-2 font-medium text-white hover:bg-accent-hover"
            >
              Try again
            </button>
          </EmptyState>
        ) : meeting.status === "recording" ? (
          <EmptyState icon={<Spinner className="size-6" />} title="Recording in progress">
            The transcript is created when you stop the recording.
          </EmptyState>
        ) : busy ? (
          <EmptyState icon={<Spinner className="size-6" />} title={meeting.phase === "uploading" ? "Uploading audio…" : "Transcribing…"}>
            {meeting.phase === "uploading"
              ? "Sending the recording to AssemblyAI."
              : "Detecting speakers and language. This usually takes under a minute per hour of audio."}
          </EmptyState>
        ) : segments.length ? (
          <TranscriptLines segments={segments} onSeek={onSeek} />
        ) : (
          <EmptyState icon={<FileText className="size-6" />} title="No speech detected">
            The recording did not contain any speech that could be transcribed.
          </EmptyState>
        )}
      </div>
    </section>
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
