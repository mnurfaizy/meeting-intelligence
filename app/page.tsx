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
import { createMeeting, migrateBrowserMeetings, moveBrowserAudioToFolder } from "@/lib/store";
import { useRecording } from "@/lib/useRecording";

export default function Home() {
  const meetings = useMeetings();
  const [selected, setSelected] = useState<{ id: string; tab: "summary" | "assistant" } | null>(null);
  const meeting = useMeeting(selected?.id ?? null);
  const [includeMic, setIncludeMic] = useState(true);
  const [includeVideo, setIncludeVideo] = useState(false);
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
        await moveBrowserAudioToFolder(meetings);
      } catch (err) {
        showError(`Could not move saved data out of the browser: ${err instanceof Error ? err.message : err}`);
      }
      for (const m of meetings) {
        if ((m.status === "recording" || m.status === "processing") && (await hasLocalAudio(m.id))) void finalizeMeeting(m.id);
      }
    })();
  }, [meetings, showError]);

  const startRecording = async () => {
    setStarting(true);
    const id = await rec.start(includeMic, includeVideo);
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
    <div className="flex min-h-screen flex-col gap-4 p-3 lg:h-screen lg:flex-row lg:p-4">
      {collapsed ? (
        <button type="button" title="Show sidebar" aria-label="Show sidebar" onClick={() => setCollapsed(false)} className="icon-btn mt-4 hidden lg:inline-flex">
          <PanelLeftOpen size={20} />
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
          includeVideo={includeVideo}
          onIncludeVideoChange={setIncludeVideo}
          onImport={importFile}
          onCollapse={() => setCollapsed(true)}
        />
      )}

      <main className="main-panel flex min-h-[calc(100vh-24px)] min-w-0 flex-1 lg:min-h-0">
        {rec.state && (isRecordingThis || !selected) ? (
          <RecordingView recording={rec.state} elapsed={rec.elapsed} level={rec.level} onStop={rec.stop} />
        ) : shown ? (
          <MeetingView key={`${shown.id}:${selected?.tab}`} meeting={shown} initialTab={selected?.tab ?? "summary"} onDeleted={() => setSelected(null)} />
        ) : selected ? (
          <section className="flex flex-1 items-center justify-center">
            <Spinner size={32} />
          </section>
        ) : (
          <section className="flex flex-1 items-center justify-center p-6">
            <EmptyState icon={<AudioLines size={22} />} title="Record your next meeting">
              <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-left leading-relaxed">
                <li>
                  Open your meeting (Google Meet, Zoom web, Teams…) in another <b className="text-ink">Chrome tab</b>.
                </li>
                <li>
                  Click <b className="text-ink">Record New Meeting</b>, choose that tab, and keep <b className="text-ink">“Also share tab audio”</b> turned on.
                </li>
                <li>Click Stop when you are done — the transcript, summary and Assistant follow automatically.</li>
              </ol>
              <p className="mt-5 flex items-center justify-center gap-1.5 text-xs text-muted">
                <MonitorSpeaker size={14} /> Works best in Chrome or Edge on desktop.
              </p>
            </EmptyState>
          </section>
        )}
      </main>

      {toast && (
        <div className="toasts">
          <div role="alert" className="toast toast-error">
            <TriangleAlert size={16} className="shrink-0" />
            <span className="flex-1">{toast}</span>
            <button type="button" onClick={() => setToast(null)} className="icon-btn size-7 text-white/80 hover:bg-white/15! hover:text-white!" aria-label="Dismiss">
              <X size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
