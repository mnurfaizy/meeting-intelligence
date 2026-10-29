"use client";

import { Download, Pencil, RefreshCw, Sparkles, Trash2, TriangleAlert } from "lucide-react";
import { useRef, useState } from "react";
import { deleteMeeting, updateMeeting } from "@/lib/store";
import { fmtDateTime, fmtDuration } from "@/lib/format";
import { useAudioUrl } from "@/lib/hooks";
import { regenerateSummary } from "@/lib/pipeline";
import type { Meeting } from "@/lib/types";
import { AssistantPanel } from "./AssistantPanel";
import { Markdown } from "./Markdown";
import { TranscriptCard } from "./TranscriptCard";
import { CopyButton, EmptyState, IconButton, Spinner, downloadText } from "./ui";

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
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
      <MeetingHeader meeting={meeting} onDeleted={onDeleted} />
      <div className="flex min-h-0 flex-1 flex-col gap-3 xl:flex-row">
        <section className="flex min-h-[480px] min-w-0 flex-1 flex-col overflow-hidden rounded-2xl bg-panel">
          <header className="flex items-center justify-between border-b border-line px-4 py-3">
            <div className="flex gap-1">
              {(["summary", "assistant"] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTab(key)}
                  className={`rounded-lg px-3 py-1.5 text-sm capitalize transition-colors ${tab === key ? "bg-panel-2 font-medium text-gray-100" : "text-gray-500 hover:text-gray-300"}`}
                >
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
                  <Download className="size-4" />
                </IconButton>
                <IconButton
                  title="Regenerate summary"
                  disabled={meeting.status !== "ready" || !meeting.transcript.length || meeting.summaryStatus === "generating"}
                  onClick={() => void regenerateSummary(meeting.id)}
                >
                  <RefreshCw className="size-4" />
                </IconButton>
              </div>
            )}
          </header>
          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
            {tab === "summary" ? <SummaryBody meeting={meeting} /> : <AssistantPanel meeting={meeting} />}
          </div>
        </section>

        <div className="flex min-h-0 flex-col gap-3 xl:w-[460px] 2xl:w-[540px]">
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

  const save = async () => {
    setEditing(false);
    const title = draft.trim();
    if (title && title !== meeting.title) await updateMeeting(meeting.id, { title, titleEdited: true });
  };

  return (
    <div className="flex items-center gap-3 px-1">
      <div className="min-w-0 flex-1">
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
            className="w-full max-w-xl rounded-md border border-accent bg-transparent px-2 py-0.5 text-lg font-semibold text-gray-100 focus:outline-none"
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              setDraft(meeting.title);
              setEditing(true);
            }}
            className="group flex max-w-full items-center gap-2 text-left text-lg font-semibold text-gray-100"
            title="Rename"
          >
            <span className="truncate">{meeting.title || "Untitled meeting"}</span>
            <Pencil className="size-3.5 shrink-0 text-gray-500 opacity-0 transition-opacity group-hover:opacity-100" />
          </button>
        )}
        <p className="mt-0.5 text-sm text-gray-500">
          {fmtDateTime(meeting.createdAt)}
          {meeting.durationMs > 0 && ` · ${fmtDuration(meeting.durationMs)}`}
          {meeting.source === "import" && " · Imported"}
        </p>
      </div>
      <IconButton
        title="Delete meeting"
        disabled={meeting.status === "recording"}
        onClick={async () => {
          if (!confirm(`Delete "${meeting.title || "this meeting"}"? This cannot be undone.`)) return;
          await deleteMeeting(meeting.id);
          onDeleted();
        }}
      >
        <Trash2 className="size-4" />
      </IconButton>
    </div>
  );
}

function SummaryBody({ meeting }: { meeting: Meeting }) {
  if (meeting.summaryStatus === "generating") {
    return (
      <EmptyState icon={<Spinner className="size-6" />} title="Writing the summary…">
        This takes a few seconds.
      </EmptyState>
    );
  }
  if (meeting.summaryStatus === "error") {
    return (
      <EmptyState icon={<TriangleAlert className="size-8" />} title="The summary could not be generated" tone="error">
        <p>{meeting.summaryError}</p>
        <button
          type="button"
          onClick={() => void regenerateSummary(meeting.id)}
          className="mt-4 rounded-lg bg-accent px-4 py-2 font-medium text-white hover:bg-accent-hover"
        >
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
    <EmptyState icon={<Sparkles className="size-6" />} title="No summary yet">
      {meeting.status === "ready" && meeting.transcript.length === 0
        ? "There was no speech to summarize."
        : "It will appear here once the recording has been transcribed."}
    </EmptyState>
  );
}

function AudioCard({ meeting, audioRef }: { meeting: Meeting; audioRef: React.RefObject<HTMLAudioElement | null> }) {
  const url = useAudioUrl(meeting.id, meeting.status);
  return (
    <section className="rounded-2xl bg-panel p-4">
      <span className="inline-block rounded-lg bg-panel-2 px-3 py-1 text-sm font-medium text-gray-100">Audio</span>
      <div className="mt-3">
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
          <p className="rounded-xl bg-panel-2/60 px-4 py-3 text-sm text-gray-500">
            {meeting.status === "recording"
              ? "Audio will be available when the recording stops."
              : "The audio is stored only in the browser where this meeting was recorded or imported."}
          </p>
        )}
      </div>
    </section>
  );
}
