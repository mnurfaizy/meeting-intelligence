"use client";

import { Download, Pencil, RefreshCw, Sparkles, Trash2, TriangleAlert } from "lucide-react";
import { useRef, useState } from "react";
import { fmtDateTime, fmtDuration } from "@/lib/format";
import { useAudioUrl } from "@/lib/hooks";
import { regenerateSummary } from "@/lib/pipeline";
import { deleteMeeting, updateMeeting } from "@/lib/store";
import type { Meeting } from "@/lib/types";
import { AssistantPanel } from "./AssistantPanel";
import { Markdown } from "./Markdown";
import { TranscriptCard } from "./TranscriptCard";
import { Confirm, CopyButton, EmptyState, IconButton, Spinner, downloadText } from "./ui";

export function MeetingView({ meeting, initialTab, onDeleted }: { meeting: Meeting; initialTab: "summary" | "assistant"; onDeleted: () => void }) {
  const [tab, setTab] = useState(initialTab);
  const audioRef = useRef<HTMLAudioElement>(null);

  const seek = (sec: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = sec;
    void audio.play();
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col px-5 pt-7 pb-6 lg:px-8">
      <MeetingHeader meeting={meeting} onDeleted={onDeleted} />
      <div className="mt-6 flex min-h-0 flex-1 flex-col gap-5 xl:flex-row">
        <section className="card flex min-h-[480px] min-w-0 flex-1 flex-col">
          <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
            <div className="segmented">
              {(["summary", "assistant"] as const).map((key) => (
                <button key={key} type="button" onClick={() => setTab(key)} className={tab === key ? "on" : ""}>
                  {key}
                </button>
              ))}
            </div>
            {tab === "summary" && (
              <div className="flex">
                <CopyButton text={meeting.summary ?? ""} disabled={!meeting.summary} />
                <IconButton
                  title="Download .md"
                  disabled={!meeting.summary}
                  onClick={() => downloadText(`${meeting.title || "summary"}.md`, meeting.summary ?? "", "text/markdown")}
                >
                  <Download size={16} />
                </IconButton>
                <IconButton
                  title="Regenerate summary"
                  disabled={meeting.status !== "ready" || !meeting.transcript.length || meeting.summaryStatus === "generating"}
                  onClick={() => void regenerateSummary(meeting.id)}
                >
                  <RefreshCw size={16} />
                </IconButton>
              </div>
            )}
          </header>
          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
            {tab === "summary" ? <SummaryBody meeting={meeting} /> : <AssistantPanel meeting={meeting} />}
          </div>
        </section>

        <div className="flex min-h-0 flex-col gap-5 xl:w-[440px] 2xl:w-[520px]">
          <AudioCard meeting={meeting} audioRef={audioRef} />
          <TranscriptCard meeting={meeting} onSeek={seek} />
        </div>
      </div>
    </div>
  );
}

function MeetingHeader({ meeting, onDeleted }: { meeting: Meeting; onDeleted: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(meeting.title);
  const [confirming, setConfirming] = useState(false);

  const save = async () => {
    setEditing(false);
    const title = draft.trim();
    if (title && title !== meeting.title) await updateMeeting(meeting.id, { title, titleEdited: true });
  };

  return (
    <div className="flex items-start gap-4">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => {
              if (e.key === "Enter") void save();
              if (e.key === "Escape") setEditing(false);
            }}
            className="input max-w-2xl text-2xl font-bold tracking-[-0.4px]"
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              setDraft(meeting.title);
              setEditing(true);
            }}
            className="group flex max-w-full items-center gap-2 text-left"
            title="Rename"
          >
            <h1 className="truncate text-[26px] leading-tight font-bold tracking-[-0.6px] lg:text-[30px]">{meeting.title || "Untitled meeting"}</h1>
            <Pencil size={16} className="shrink-0 text-muted opacity-0 transition-opacity group-hover:opacity-100" />
          </button>
        )}
        <p className="flex flex-wrap items-center gap-2 text-ink-2">
          {fmtDateTime(meeting.createdAt)}
          {meeting.durationMs > 0 && <span className="badge">{fmtDuration(meeting.durationMs)}</span>}
          {meeting.source === "import" && <span className="badge badge-info">Imported</span>}
        </p>
      </div>
      <IconButton title="Delete meeting" danger disabled={meeting.status === "recording"} onClick={() => setConfirming(true)}>
        <Trash2 size={18} />
      </IconButton>
      {confirming && (
        <Confirm
          title="Delete meeting"
          message={
            <>
              Delete <b className="text-ink">{meeting.title || "this meeting"}</b> with its transcript, summary and chat? This cannot be undone.
            </>
          }
          onClose={() => setConfirming(false)}
          onConfirm={async () => {
            await deleteMeeting(meeting.id);
            onDeleted();
          }}
        />
      )}
    </div>
  );
}

function SummaryBody({ meeting }: { meeting: Meeting }) {
  if (meeting.summaryStatus === "generating") {
    return (
      <EmptyState icon={<Spinner size={22} />} title="Writing the summary…">
        This takes a few seconds.
      </EmptyState>
    );
  }
  if (meeting.summaryStatus === "error") {
    return (
      <EmptyState icon={<TriangleAlert size={22} />} title="The summary could not be generated" tone="error">
        <p>{meeting.summaryError}</p>
        <button type="button" onClick={() => void regenerateSummary(meeting.id)} className="btn btn-primary btn-sm mt-4">
          Try again
        </button>
      </EmptyState>
    );
  }
  if (meeting.summary) {
    return (
      <div className="mx-auto max-w-3xl px-7 py-6">
        <Markdown>{meeting.summary}</Markdown>
      </div>
    );
  }
  return (
    <EmptyState icon={<Sparkles size={22} />} title="No summary yet">
      {meeting.status === "ready" && meeting.transcript.length === 0
        ? "There was no speech to summarize."
        : "It will appear here once the recording has been transcribed."}
    </EmptyState>
  );
}

function AudioCard({ meeting, audioRef }: { meeting: Meeting; audioRef: React.RefObject<HTMLAudioElement | null> }) {
  const url = useAudioUrl(meeting.id, meeting.status);
  return (
    <section className="card p-4">
      <h2 className="mb-3 px-1 text-base font-bold">Audio</h2>
      {url ? (
        <audio
          ref={audioRef}
          src={url}
          controls
          preload="metadata"
          className="w-full"
          onLoadedMetadata={(e) => {
            // MediaRecorder WebM files have no duration header; seeking to the end makes Chrome compute it.
            const audio = e.currentTarget;
            if (Number.isFinite(audio.duration)) return;
            audio.currentTime = 1e9;
            audio.addEventListener("timeupdate", () => (audio.currentTime = 0), { once: true });
          }}
        />
      ) : (
        <p className="rounded-[var(--radius-md)] bg-surface-muted px-4 py-3 text-[13px] text-ink-2">
          {meeting.status === "recording"
            ? "Audio will be available when the recording stops."
            : "The audio is stored only in the browser where this meeting was recorded or imported."}
        </p>
      )}
    </section>
  );
}
