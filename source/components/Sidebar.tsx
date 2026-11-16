"use client";

import { AudioLines, Clock, FolderOpen, MessageSquare, Mic, PanelLeftClose, Search, Square, TriangleAlert, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { allowFolder, chooseFolder, useFolderState, useStorageMode } from "@/lib/deviceFolder";
import { useMicrophones } from "@/lib/devices";
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
  /** Chosen microphone ("" = system default). */
  micDeviceId: string;
  onMicDeviceChange: (id: string) => void;
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
          {props.includeMic && (
            <MicPicker value={props.micDeviceId} onChange={props.onMicDeviceChange} disabled={!!recording} />
          )}
          <label className="flex items-center justify-between gap-3 border-t border-line px-4 py-3">
            <span>
              <span className="block font-bold">Record screen video</span>
              <span className="block text-xs text-ink-2">Saved to your recordings folder · ~450 MB/hour</span>
            </span>
            <Toggle checked={props.includeVideo} onChange={props.onIncludeVideoChange} disabled={!!recording} />
          </label>
          <RecordingsFolder />
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

/** Lets the user pick the headset mic instead of whatever Windows treats as default. */
function MicPicker({ value, onChange, disabled }: { value: string; onChange: (id: string) => void; disabled?: boolean }) {
  const { mics, unlockNames } = useMicrophones();
  // The pseudo-devices Chrome adds ("default", "communications") would duplicate real ones.
  const devices = mics.filter((m) => m.deviceId && m.deviceId !== "default" && m.deviceId !== "communications");
  const known = !value || devices.some((m) => m.deviceId === value);
  return (
    <div className="px-4 pb-3">
      <select
        value={known ? value : ""}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => void unlockNames()}
        onMouseDown={() => void unlockNames()}
        disabled={disabled}
        aria-label="Microphone"
        className="input h-9 w-full truncate pr-8 text-[13px] font-semibold"
      >
        <option value="">System default microphone</option>
        {devices.map((m, i) => (
          <option key={m.deviceId} value={m.deviceId}>
            {m.label || `Microphone ${i + 1}`}
          </option>
        ))}
      </select>
    </div>
  );
}

function ElapsedClock({ elapsed }: { elapsed: () => number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(id);
  }, []);
  return <span className="tabular-nums opacity-90">{fmtClock(elapsed() / 1000)}</span>;
}

/** Where recordings go when they are kept on this computer (only shown in that mode). */
function RecordingsFolder() {
  const mode = useStorageMode();
  const folder = useFolderState();
  const [error, setError] = useState<string | null>(null);
  if (mode !== "device" || !folder) return null;
  const run = (action: () => Promise<unknown>) => () => {
    setError(null);
    action().catch((err) => setError(err instanceof Error ? err.message : String(err)));
  };
  const { access, name } = folder;
  const detail =
    access === "unsupported"
      ? "Needs Chrome or Edge on a computer"
      : access === "none"
        ? "Choose where recordings are saved"
        : access === "prompt"
          ? `${name} · click Allow to use it`
          : name;
  return (
    <div className="border-t border-line px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 font-bold">
            Recordings folder
            {(access === "none" || access === "prompt") && <TriangleAlert size={14} className="text-warning" />}
          </span>
          <span className="block truncate text-xs text-ink-2" title={name}>
            {detail}
          </span>
        </span>
        {access === "prompt" ? (
          <button type="button" onClick={run(allowFolder)} className="btn btn-primary btn-sm shrink-0">
            Allow
          </button>
        ) : access !== "unsupported" ? (
          <button type="button" onClick={run(chooseFolder)} className={`btn btn-sm shrink-0 ${access === "none" ? "btn-primary" : "btn-outline"}`}>
            <FolderOpen size={14} />
            {access === "none" ? "Choose" : "Change"}
          </button>
        ) : null}
      </div>
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}
