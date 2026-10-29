"use client";

import { Download, FileText, RefreshCw, TriangleAlert } from "lucide-react";
import { fmtClock, transcriptToText } from "@/lib/format";
import { retranscribeMeeting } from "@/lib/pipeline";
import type { Meeting, Segment } from "@/lib/types";
import { CopyButton, EmptyState, IconButton, Spinner, downloadText } from "./ui";

/** Same palette as project colors in time-tracker. */
const SPEAKER_COLORS = ["#3E8E5E", "#4F68D8", "#E0A23A", "#E06A5A", "#8C63D2", "#2A9D8F", "#D4618C", "#7E9A3C"];

export function TranscriptCard({ meeting, onSeek }: { meeting: Meeting; onSeek: (sec: number) => void }) {
  const segments = meeting.transcript;
  const text = transcriptToText(segments);
  const busy = meeting.status === "processing" || meeting.status === "recording";

  return (
    <section className="card flex min-h-[360px] flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-line py-2.5 pr-3 pl-5">
        <h2 className="flex items-center gap-2 text-base font-bold">
          <FileText size={18} className="text-primary" />
          Transcript
        </h2>
        <div className="flex">
          <CopyButton text={text} disabled={!segments.length} />
          <IconButton title="Download .txt" disabled={!segments.length} onClick={() => downloadText(`${meeting.title || "transcript"}.txt`, text)}>
            <Download size={16} />
          </IconButton>
          <IconButton title="Transcribe again" disabled={busy} onClick={() => void retranscribeMeeting(meeting.id)}>
            <RefreshCw size={16} />
          </IconButton>
        </div>
      </header>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {meeting.status === "error" ? (
          <EmptyState icon={<TriangleAlert size={22} />} title="The recording could not be transcribed" tone="error">
            <p>{meeting.error || "Something went wrong. Please try again."}</p>
            <button type="button" onClick={() => void retranscribeMeeting(meeting.id)} className="btn btn-primary btn-sm mt-4">
              Try again
            </button>
          </EmptyState>
        ) : meeting.status === "recording" ? (
          <EmptyState icon={<Spinner size={22} />} title="Recording in progress">
            The transcript is created when you stop the recording.
          </EmptyState>
        ) : busy ? (
          <EmptyState icon={<Spinner size={22} />} title={meeting.phase === "uploading" ? "Uploading audio…" : "Transcribing…"}>
            {meeting.phase === "uploading"
              ? "Sending the recording to AssemblyAI."
              : "Detecting speakers and language. This usually takes under a minute per hour of audio."}
          </EmptyState>
        ) : segments.length ? (
          <TranscriptLines segments={segments} onSeek={onSeek} />
        ) : (
          <EmptyState icon={<FileText size={22} />} title="No speech detected">
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
    <ol className="flex flex-col gap-3 px-5 py-4">
      {segments.map((s, i) => {
        const sameSpeaker = i > 0 && segments[i - 1].speaker === s.speaker;
        const color = SPEAKER_COLORS[speakers.indexOf(s.speaker) % SPEAKER_COLORS.length];
        return (
          <li key={i} className={sameSpeaker ? "-mt-1.5" : ""}>
            {!sameSpeaker && (
              <div className="mb-1 flex items-center text-[13px] font-bold" style={{ color }}>
                <span className="mr-2 inline-block size-2 rounded-full" style={{ background: color }} />
                {s.speaker}
              </div>
            )}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => onSeek(s.start)}
                title="Play from here"
                className="mt-0.5 shrink-0 rounded-[var(--radius-sm)] px-1 text-xs font-semibold text-muted tabular-nums hover:bg-primary-subtle hover:text-primary-text"
              >
                {fmtClock(s.start)}
              </button>
              <p className="leading-relaxed text-ink">{s.text}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
