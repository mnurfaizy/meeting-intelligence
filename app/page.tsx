"use client";

import { AudioLines, MonitorSpeaker, PanelLeftOpen, TriangleAlert, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { MeetingView } from "@/components/MeetingView";
import { RecordingView } from "@/components/RecordingView";
import { Sidebar } from "@/components/Sidebar";
import { EmptyState, Spinner } from "@/components/ui";
import { getAudio, hasLocalAudio, putAudio } from "@/lib/db";
import { useMeeting, useMeetings } from "@/lib/hooks";
import { finalizeMeeting, isMeetingBusy } from "@/lib/pipeline";
import { createMeeting, listMeetings, migrateBrowserMeetings, moveBrowserAudioToFolder } from "@/lib/store";
import type { MeetingListItem } from "@/lib/types";
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

  // Picks up meetings whose saving/transcription was interrupted (reload, closed tab, server down
  // when Stop was pressed). Never touches the meeting being recorded in this tab.
  const recordingIdRef = useRef<string | undefined>(undefined);
  recordingIdRef.current = rec.state?.meetingId;
  const resumeInterrupted = useCallback(async (list: MeetingListItem[], { firstLoad = false } = {}) => {
    for (const m of list) {
      if (m.status !== "recording" && m.status !== "processing") continue;
      if (m.id === recordingIdRef.current || isMeetingBusy(m.id)) continue;
      // Only on first load can a "recording" meeting with nothing but backup parts be a crash:
      // later it may still be recording in another tab.
      const canResume =
        Boolean(m.audioFile) || Boolean(await getAudio(m.id)) || (firstLoad && (await hasLocalAudio(m.id)));
      if (canResume) void finalizeMeeting(m.id);
    }
  }, []);

  // On first load: move meetings from the browser-only version into the database, then resume.
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
      await resumeInterrupted(meetings, { firstLoad: true });
    })();
  }, [meetings, showError, resumeInterrupted]);

  // Retry every 30 s and when the connection returns, so a recording stopped while the server was
  // down gets saved as soon as it is back, without reloading the page.
  useEffect(() => {
    const retry = () =>
      migrateBrowserMeetings()
        .then(() => listMeetings())
        .then((list) => resumeInterrupted(list))
        .catch(() => {});
    const timer = setInterval(retry, 30_000);
    window.addEventListener("online", retry);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", retry);
    };
  }, [resumeInterrupted]);

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

      {rec.state?.shareLost && (
        <div role="alert" className="fixed top-4 left-1/2 z-[2000] flex w-[min(640px,calc(100vw-32px))] -translate-x-1/2 flex-wrap items-center gap-3 rounded-[var(--radius-lg)] bg-danger px-5 py-4 text-white shadow-[var(--shadow-overlay)]">
          <TriangleAlert size={20} className="shrink-0" />
          <div className="min-w-[220px] flex-1">
            <p className="font-bold">Tab sharing stopped — the meeting audio is not being recorded</p>
            <p className="text-[13px] text-white/85">
              The recording is still running{rec.state.micActive ? " with your microphone" : ""}. Share the meeting tab again to keep capturing everyone.
            </p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => void rec.reshare()} className="btn btn-sm bg-white text-danger hover:bg-white/90">
              Share tab again
            </button>
            <button type="button" onClick={() => void rec.stop()} className="btn btn-sm bg-white/15 text-white hover:bg-white/25">
              Stop &amp; save
            </button>
          </div>
        </div>
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
