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
  onImport: (file: File) => void;
  onCollapse: () => void;
};

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
    <aside className="flex h-full w-full flex-col overflow-hidden rounded-2xl bg-panel lg:w-[340px] lg:shrink-0">
      <div className="flex items-start justify-between px-5 pt-5 pb-4">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="grid size-8 place-items-center rounded-lg bg-gradient-to-br from-accent to-amber-400 text-white">
              <AudioLines className="size-4.5" />
            </span>
            <h1 className="text-lg font-semibold text-gray-100">Meeting Intelligence</h1>
          </div>
          <p className="mt-1.5 text-sm text-gray-400">AI-powered meeting recorder</p>
        </div>
        <button
          type="button"
          title="Collapse sidebar"
          onClick={props.onCollapse}
          className="hidden rounded-md p-1.5 text-gray-500 hover:bg-white/5 hover:text-gray-300 lg:block"
        >
          <PanelLeftClose className="size-4.5" />
        </button>
      </div>

      <div className="space-y-3 border-y border-line px-4 py-4">
        <div className="rounded-xl bg-panel-2/60 p-2">
          {recording ? (
            <button
              type="button"
              onClick={props.onStop}
              disabled={recording.stopping}
              className="flex w-full items-center justify-center gap-2.5 rounded-lg bg-red-600 py-3 font-medium text-white transition-colors hover:bg-red-500 disabled:opacity-70"
            >
              {recording.stopping ? <Spinner /> : <Square className="size-4 fill-current" />}
              {recording.stopping ? "Saving…" : "Stop Recording"}
              {!recording.stopping && <ElapsedClock elapsed={props.elapsed} />}
            </button>
          ) : (
            <button
              type="button"
              onClick={props.onRecord}
              disabled={props.starting}
              className="flex w-full items-center justify-center gap-2.5 rounded-lg bg-accent py-3 font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-70"
            >
              {props.starting ? <Spinner /> : <Mic className="size-4.5" />}
              {props.starting ? "Choose a tab to record…" : "Record New Meeting"}
            </button>
          )}

          <label className="mt-1 flex items-center justify-between gap-3 px-3 py-3">
            <span>
              <span className="block text-[0.95rem] text-gray-100">Include Microphone</span>
              <span className="block text-sm text-gray-400">Records your own voice too</span>
            </span>
            <Toggle checked={props.includeMic} onChange={props.onIncludeMicChange} disabled={!!recording} />
          </label>
        </div>

        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          disabled={!!recording}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-line py-2.5 text-gray-300 transition-colors hover:bg-white/5 disabled:opacity-40"
        >
          <Upload className="size-4" />
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

      <div className="px-4 pt-4">
        <div className="grid grid-cols-2 rounded-lg bg-panel-2/60 p-1 text-sm">
          {(["meetings", "chats"] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setList(key)}
              className={`rounded-md py-1.5 capitalize transition-colors ${list === key ? "bg-panel font-medium text-gray-100" : "text-gray-400 hover:text-gray-200"}`}
            >
              {key}
            </button>
          ))}
        </div>
        <div className="relative mt-3">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-gray-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={list === "chats" ? "Search chats…" : "Search meetings…"}
            className="w-full rounded-lg border border-line bg-transparent py-2 pr-3 pl-9 text-sm text-gray-200 placeholder:text-gray-500 focus:border-accent focus:outline-none"
          />
        </div>
      </div>

      <nav className="scroll-thin mt-2 min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {meetings === null ? (
          <div className="flex justify-center py-8 text-gray-500">
            <Spinner />
          </div>
        ) : groups.length === 0 ? (
          <p className="px-2 py-8 text-center text-sm text-gray-500">
            {query ? "Nothing matches your search." : list === "chats" ? "No chats yet. Ask the Assistant about a meeting." : "No meetings yet. Record or import one to get started."}
          </p>
        ) : (
          groups.map(([date, items]) => (
            <div key={date}>
              <div className="my-3 flex items-center gap-3 text-xs tracking-wider text-gray-500">
                <span className="h-px flex-1 bg-line" />
                {date}
                <span className="h-px flex-1 bg-line" />
              </div>
              <ul className="space-y-0.5">
                {items.map((m) => (
                  <li key={m.id}>
                    <MeetingItem
                      meeting={m}
                      active={m.id === props.selectedId}
                      showChat={list === "chats"}
                      onClick={() => props.onSelect(m.id, list === "chats" ? "assistant" : undefined)}
                    />
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </nav>
    </aside>
  );
}

function MeetingItem({ meeting: m, active, showChat, onClick }: { meeting: MeetingListItem; active: boolean; showChat: boolean; onClick: () => void }) {
  const lastQuestion = m.lastQuestion;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-start gap-2 rounded-lg px-3 py-2.5 text-left text-[0.95rem] transition-colors ${active ? "bg-[#163b3c] text-gray-100 ring-1 ring-accent/40" : "text-gray-300 hover:bg-white/5"}`}
    >
      <StatusIcon meeting={m} />
      <span className="min-w-0 flex-1">
        <span className="block truncate">{m.title || fmtTime(m.createdAt)}</span>
        {showChat && lastQuestion && (
          <span className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-gray-500">
            <MessageSquare className="size-3 shrink-0" />
            <span className="truncate">{lastQuestion}</span>
          </span>
        )}
      </span>
    </button>
  );
}

function StatusIcon({ meeting: m }: { meeting: MeetingListItem }) {
  if (m.status === "recording") return <span className="mt-1.5 size-2 shrink-0 animate-pulse rounded-full bg-red-500" title="Recording" />;
  if (m.status === "processing" || m.summaryStatus === "generating")
    return <Spinner className="mt-1 size-3.5 shrink-0 text-accent-hover" />;
  if (m.status === "error") return <TriangleAlert className="mt-1 size-3.5 shrink-0 text-red-400" />;
  if (!m.title) return <Clock className="mt-1 size-3.5 shrink-0 text-gray-500" />;
  return null;
}

function ElapsedClock({ elapsed }: { elapsed: () => number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(id);
  }, []);
  return <span className="font-mono text-sm tabular-nums opacity-90">{fmtClock(elapsed() / 1000)}</span>;
}
