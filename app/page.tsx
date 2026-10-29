"use client";

import { AudioLines, MonitorSpeaker, PanelLeftOpen, TriangleAlert, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { MeetingView } from "@/components/MeetingView";
import { RecordingView } from "@/components/RecordingView";
import { Sidebar } from "@/components/Sidebar";
import { EmptyState } from "@/components/ui";
import { putAudio, putChunk, putMeeting } from "@/lib/db";
import { useMeetings } from "@/lib/hooks";
import { finalizeMeeting } from "@/lib/pipeline";
import { useRecording } from "@/lib/useRecording";

/** Imported files can report Infinity for WebM; 0 means "unknown" and is filled in later. */
function probeDuration(file: Blob) {
  return new Promise<number>((resolve) => {
    const audio = document.createElement("audio");
    const url = URL.createObjectURL(file);
    const done = (ms: number) => {
      URL.revokeObjectURL(url);
      resolve(ms);
    };
    audio.preload = "metadata";
    audio.onloadedmetadata = () => done(Number.isFinite(audio.duration) ? audio.duration * 1000 : 0);
    audio.onerror = () => done(0);
    audio.src = url;
  });
}

export default function Home() {
  const meetings = useMeetings();
  const [selected, setSelected] = useState<{ id: string; tab: "summary" | "assistant" } | null>(null);
  const [includeMic, setIncludeMic] = useState(true);
  const [starting, setStarting] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const showError = useCallback((message: string) => setToast(message), []);
  const rec = useRecording(showError);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(id);
  }, [toast]);

  // Resume meetings that were interrupted by a reload or a closed tab.
  const resumed = useRef(false);
  useEffect(() => {
    if (!meetings || resumed.current) return;
    resumed.current = true;
    for (const m of meetings) {
      if (m.status === "recording" || m.status === "processing") void finalizeMeeting(m.id);
    }
  }, [meetings]);

  const startRecording = async () => {
    setStarting(true);
    const id = await rec.start(includeMic);
    setStarting(false);
    if (id) setSelected({ id, tab: "summary" });
  };

  const importFile = async (file: File) => {
    const id = crypto.randomUUID();
    const mimeType = file.type || "audio/mpeg";
    const durationMs = await probeDuration(file);
    await putMeeting({
      id,
      title: file.name.replace(/\.[^.]+$/, ""),
      createdAt: Date.now(),
      durationMs,
      source: "import",
      status: "processing",
      transcript: [],
      summaryStatus: "idle",
      chat: [],
    });
    await putAudio({ meetingId: id, blob: file, mimeType });
    await putChunk({ id: `${id}:0`, meetingId: id, index: 0, startMs: 0, durationMs, blob: file, mimeType, status: "pending" });
    setSelected({ id, tab: "summary" });
    void finalizeMeeting(id);
  };

  const meeting = meetings?.find((m) => m.id === selected?.id) ?? null;
  const isRecordingThis = rec.state && meeting?.id === rec.state.meetingId;

  return (
    <div className="flex min-h-screen flex-col gap-3 p-3 lg:h-screen lg:flex-row">
      {collapsed ? (
        <button
          type="button"
          title="Show sidebar"
          onClick={() => setCollapsed(false)}
          className="hidden h-fit rounded-xl bg-panel p-3 text-gray-400 hover:text-gray-200 lg:block"
        >
          <PanelLeftOpen className="size-5" />
        </button>
      ) : (
        <Sidebar
          meetings={meetings}
          selectedId={selected?.id ?? null}
          onSelect={(id, tab) => setSelected({ id, tab: tab ?? "summary" })}
          recording={rec.state}
          starting={starting}
          elapsed={rec.elapsed}
          onRecord={startRecording}
          onStop={rec.stop}
          includeMic={includeMic}
          onIncludeMicChange={setIncludeMic}
          onImport={importFile}
          onCollapse={() => setCollapsed(true)}
        />
      )}

      <main className="flex min-h-0 min-w-0 flex-1">
        {rec.state && (isRecordingThis || !meeting) ? (
          <RecordingView recording={rec.state} elapsed={rec.elapsed} level={rec.level} onStop={rec.stop} />
        ) : meeting ? (
          <MeetingView key={`${meeting.id}:${selected?.tab}`} meeting={meeting} initialTab={selected?.tab ?? "summary"} onDeleted={() => setSelected(null)} />
        ) : (
          <section className="flex flex-1 items-center justify-center rounded-2xl bg-panel">
            <EmptyState icon={<AudioLines className="size-6" />} title="Record your next meeting">
              <ol className="mt-2 space-y-2 text-left">
                <li>
                  1. Open your meeting (Google Meet, Zoom web, Teams…) in another <b className="text-gray-300">Chrome tab</b>.
                </li>
                <li>
                  2. Click <b className="text-gray-300">Record New Meeting</b>, choose that tab, and keep{" "}
                  <b className="text-gray-300">“Also share tab audio”</b> turned on.
                </li>
                <li>3. Click Stop when you are done — the transcript, summary and Assistant follow automatically.</li>
              </ol>
              <p className="mt-4 flex items-center justify-center gap-1.5 text-xs text-gray-500">
                <MonitorSpeaker className="size-3.5" /> Works best in Chrome or Edge on desktop.
              </p>
            </EmptyState>
          </section>
        )}
      </main>

      {toast && (
        <div role="alert" className="fixed right-4 bottom-4 left-4 z-50 mx-auto flex max-w-lg items-start gap-3 rounded-xl border border-red-500/30 bg-[#2a1618] px-4 py-3 text-sm text-red-200 shadow-xl sm:left-auto">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-red-400" />
          <p className="flex-1">{toast}</p>
          <button type="button" onClick={() => setToast(null)} className="text-red-300/70 hover:text-red-200" aria-label="Dismiss">
            <X className="size-4" />
          </button>
        </div>
      )}
    </div>
  );
}
