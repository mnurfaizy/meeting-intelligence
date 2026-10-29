"use client";

import { AudioLines, MonitorSpeaker, PanelLeftOpen, TriangleAlert, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { MeetingView } from "@/components/MeetingView";
import { RecordingView } from "@/components/RecordingView";
import { Sidebar } from "@/components/Sidebar";
import { EmptyState, Spinner } from "@/components/ui";
import { hasLocalAudio, putAudio } from "@/lib/db";
import { useMeeting, useMeetings } from "@/lib/hooks";
import { finalizeMeeting } from "@/lib/pipeline";
import { createMeeting, migrateBrowserMeetings } from "@/lib/store";
import { useRecording } from "@/lib/useRecording";

export default function Home() {
  const meetings = useMeetings();
  const [selected, setSelected] = useState<{ id: string; tab: "summary" | "assistant" } | null>(null);
  const meeting = useMeeting(selected?.id ?? null);
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

  // On first load: move meetings from the browser-only version into the database, then resume
  // meetings interrupted by a reload or a closed tab. Only this browser has their audio, so
  // meetings recorded elsewhere are left alone.
  const resumed = useRef(false);
  useEffect(() => {
    if (!meetings || resumed.current) return;
    resumed.current = true;
    void (async () => {
      try {
        await migrateBrowserMeetings();
      } catch (err) {
        showError(`Could not move saved meetings to the database: ${err instanceof Error ? err.message : err}`);
      }
      for (const m of meetings) {
        if ((m.status === "recording" || m.status === "processing") && (await hasLocalAudio(m.id))) void finalizeMeeting(m.id);
      }
    })();
  }, [meetings, showError]);

  const startRecording = async () => {
    setStarting(true);
    const id = await rec.start(includeMic);
    setStarting(false);
    if (id) setSelected({ id, tab: "summary" });
  };

  const importFile = async (file: File) => {
    const id = crypto.randomUUID();
    try {
      // AssemblyAI accepts the original file as-is (m4a, mp3, mp4, webm…), so no conversion is needed.
      await putAudio({ meetingId: id, blob: file, mimeType: file.type || "audio/mpeg" });
      await createMeeting({
        id,
        title: file.name.replace(/\.[^.]+$/, ""),
        createdAt: Date.now(),
        durationMs: 0,
        source: "import",
        status: "processing",
        transcript: [],
        summaryStatus: "idle",
        chat: [],
      });
    } catch (err) {
      showError(`Could not save the meeting: ${err instanceof Error ? err.message : err}`);
      return;
    }
    setSelected({ id, tab: "summary" });
    void finalizeMeeting(id);
  };

  const isRecordingThis = rec.state && selected?.id === rec.state.meetingId;
  // The previous meeting stays in state until the newly selected one has loaded.
  const shown = meeting?.id === selected?.id ? meeting : null;

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
        {rec.state && (isRecordingThis || !selected) ? (
          <RecordingView recording={rec.state} elapsed={rec.elapsed} level={rec.level} onStop={rec.stop} />
        ) : shown ? (
          <MeetingView key={`${shown.id}:${selected?.tab}`} meeting={shown} initialTab={selected?.tab ?? "summary"} onDeleted={() => setSelected(null)} />
        ) : selected ? (
          <section className="flex flex-1 items-center justify-center rounded-2xl bg-panel text-gray-500">
            <Spinner className="size-6" />
          </section>
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
