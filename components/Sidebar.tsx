"use client";

import { AudioLines, Clock, MessageSquare, Mic, PanelLeftClose, Search, Square, TriangleAlert, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { fmtClock, fmtDateGroup, fmtTime } from "@/lib/format";
import type { MeetingListItem } from "@/lib/types";
import type { RecordingState } from "@/lib/useRecording";
import { Spinner, Toggle } from "./ui";

type Props = {
  meetings: MeetingListItem[] | null;
  selectedId: string | null;
  onSelect: (id: string, tab?: "summary" | "assistant") => void;
  recording: RecordingState | null;
  starting: boolean;
  elapsed: () => number;
  onRecord: () => void;
  onStop: () => void;
  includeMic: boolean;
  onIncludeMicChange: (v: boolean) => void;
  includeVideo: boolean;
  onIncludeVideoChange: (v: boolean) => void;
  onImport: (file: File) => void;
  onCollapse: () => void;
};

export function Logo() {
  return (
    <span className="logo">
      <AudioLines size={20} strokeWidth={2.25} className="logo-icon" aria-hidden="true" />
      <span className="logo-text">meeting intelligence.</span>
    </span>
  );
}

export function Sidebar(props: Props) {
  const { meetings, recording } = props;
  const [list, setList] = useState<"meetings" | "chats">("meetings");
  const [query, setQuery] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (meetings ?? []).filter((m) => {
      if (list === "chats" && m.chatCount === 0) return false;
      if (!q) return true;
      return [m.title, m.summary ?? "", fmtTime(m.createdAt)].some((s) => s.toLowerCase().includes(q));
    });
  }, [meetings, list, query]);

  const groups = useMemo(() => {
    const byDate = new Map<string, MeetingListItem[]>();
    for (const m of visible) {
      const key = fmtDateGroup(m.createdAt);
      byDate.set(key, [...(byDate.get(key) ?? []), m]);
    }
    return [...byDate];
  }, [visible]);

  return (
    <aside className="flex w-full flex-col px-2 pt-5 lg:sticky lg:top-4 lg:h-[calc(100vh-32px)] lg:w-[288px] lg:shrink-0">
      <div className="flex items-center justify-between px-3 pb-1">
        <Logo />
        <button type="button" title="Collapse sidebar" aria-label="Collapse sidebar" onClick={props.onCollapse} className="icon-btn hidden lg:inline-flex">
          <PanelLeftClose size={18} />
        </button>
      </div>
      <p className="px-3 text-[13px] text-ink-2">AI-powered meeting recorder</p>

      <div className="mt-5 flex flex-col gap-3 px-1">
        {recording ? (
          <button type="button" onClick={props.onStop} disabled={recording.stopping} className="btn btn-danger btn-block">
            {recording.stopping ? <Spinner /> : <Square size={14} fill="currentColor" />}
            {recording.stopping ? "Saving…" : "Stop Recording"}
            {!recording.stopping && <ElapsedClock elapsed={props.elapsed} />}
          </button>
        ) : (
          <button type="button" onClick={props.onRecord} disabled={props.starting} className="btn btn-primary btn-block">
            {props.starting ? <Spinner /> : <Mic size={18} />}
            {props.starting ? "Choose a tab to record…" : "Record New Meeting"}
          </button>
        )}

        <div className="rounded-[var(--radius-md)] bg-white shadow-[var(--shadow-raised)]">
          <label className="flex items-center justify-between gap-3 px-4 py-3">
            <span>
              <span className="block font-bold">Include microphone</span>
              <span className="block text-xs text-ink-2">Records your own voice too</span>
            </span>
            <Toggle checked={props.includeMic} onChange={props.onIncludeMicChange} disabled={!!recording} />
          </label>
          <label className="flex items-center justify-between gap-3 border-t border-line px-4 py-3">
            <span>
              <span className="block font-bold">Record screen video</span>
              <span className="block text-xs text-ink-2">Saved to your recordings folder · ~450 MB/hour</span>
            </span>
            <Toggle checked={props.includeVideo} onChange={props.onIncludeVideoChange} disabled={!!recording} />
          </label>
        </div>

        <button type="button" onClick={() => fileInput.current?.click()} disabled={!!recording} className="btn btn-outline btn-block">
          <Upload size={16} />
          Import Recording
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="audio/*,video/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) props.onImport(file);
            e.target.value = "";
          }}
        />
      </div>

      <div className="mt-6 flex flex-col gap-3 px-1">
        <div className="segmented w-full">
          {(["meetings", "chats"] as const).map((key) => (
            <button key={key} type="button" onClick={() => setList(key)} className={`flex-1 ${list === key ? "on" : ""}`}>
              {key}
            </button>
          ))}
        </div>
        <label className="search-box">
          <Search size={16} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={list === "chats" ? "Search chats…" : "Search meetings…"} />
        </label>
      </div>

      <nav className="scroll-thin mt-2 min-h-0 flex-1 overflow-y-auto pb-4">
        {meetings === null ? (
          <div className="flex justify-center py-8">
            <Spinner size={24} />
          </div>
        ) : groups.length === 0 ? (
          <p className="px-3 py-8 text-center text-[13px] text-muted">
            {query ? "Nothing matches your search." : list === "chats" ? "No chats yet. Ask the Assistant about a meeting." : "No meetings yet. Record or import one to get started."}
          </p>
        ) : (
          groups.map(([date, items]) => (
            <div key={date} className="flex flex-col gap-0.5">
              <div className="sidebar-section">{date}</div>
              {items.map((m) => (
                <MeetingItem
                  key={m.id}
                  meeting={m}
                  active={m.id === props.selectedId}
                  showChat={list === "chats"}
                  onClick={() => props.onSelect(m.id, list === "chats" ? "assistant" : undefined)}
                />
              ))}
            </div>
          ))
        )}
      </nav>
    </aside>
  );
}

function MeetingItem({ meeting: m, active, showChat, onClick }: { meeting: MeetingListItem; active: boolean; showChat: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`sidebar-link items-start ${active ? "active" : ""}`}>
      <StatusIcon meeting={m} />
      <span className="min-w-0 flex-1">
        <span className="block truncate">{m.title || fmtTime(m.createdAt)}</span>
        {showChat && m.lastQuestion && (
          <span className="mt-0.5 flex items-center gap-1.5 text-xs font-medium text-muted">
            <MessageSquare size={12} className="shrink-0" />
            <span className="truncate">{m.lastQuestion}</span>
          </span>
        )}
      </span>
    </button>
  );
}

function StatusIcon({ meeting: m }: { meeting: MeetingListItem }) {
  if (m.status === "recording") return <span className="rec-pulse mt-1.5 shrink-0" title="Recording" />;
  if (m.status === "processing" || m.summaryStatus === "generating")
    return (
      <span className="mt-0.5 shrink-0">
        <Spinner size={14} />
      </span>
    );
  if (m.status === "error") return <TriangleAlert size={16} className="mt-0.5 shrink-0 text-danger" />;
  if (!m.title) return <Clock size={16} className="mt-0.5 shrink-0" />;
  return null;
}

function ElapsedClock({ elapsed }: { elapsed: () => number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(id);
  }, []);
  return <span className="tabular-nums opacity-90">{fmtClock(elapsed() / 1000)}</span>;
}
