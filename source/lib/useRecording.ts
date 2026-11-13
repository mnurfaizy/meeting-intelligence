"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { deleteParts, putAudio, putChunk, putPart, putVideo, saveBrowserMeeting } from "./db";
import { createMeeting, updateMeeting } from "./store";
import { finalizeMeeting } from "./pipeline";
import { TabRecorder } from "./recorder";
import type { Meeting } from "./types";

export type RecordingState = {
  meetingId: string;
  sourceLabel: string;
  micActive: boolean;
  /** Name of the microphone in use, so a wrong device (laptop mic vs headset) is noticed. */
  micLabel: string;
  videoActive: boolean;
  /** Tab sharing ended while recording; the tab's audio is not being captured until reshared. */
  shareLost: boolean;
  stopping: boolean;
};

/** Desktop notification, so a problem is noticed while the user is in the meeting's tab. */
function notify(title: string, body: string) {
  try {
    if (typeof Notification !== "undefined" && Notification.permission === "granted") new Notification(title, { body, requireInteraction: true });
  } catch {
    // Notifications are a nice-to-have; the banner and tab title still show the problem.
  }
}

function newMeeting(id: string, createdAt: number, fields: Pick<Meeting, "status" | "durationMs">): Meeting {
  return { id, title: "", createdAt, source: "recording", transcript: [], summaryStatus: "idle", chat: [], ...fields };
}

function describeStartError(err: unknown) {
  if (err instanceof DOMException && err.name === "NotAllowedError") {
    return "Screen sharing was cancelled, or the browser blocked it.";
  }
  return err instanceof Error ? err.message : String(err);
}

export function useRecording(onError: (message: string) => void) {
  const [state, setState] = useState<RecordingState | null>(null);
  const recorderRef = useRef<TabRecorder | null>(null);
  const readers = useRecorderReaders(recorderRef);
  const meetingIdRef = useRef<string | null>(null);
  const pendingSaves = useRef<Promise<unknown>[]>([]);
  const stoppingRef = useRef(false);
  /** The meeting could not be created in the database at start (server down); retried at stop. */
  const meetingCreatedRef = useRef(true);
  const createdAtRef = useRef(0);

  const stop = useCallback(async () => {
    const recorder = recorderRef.current;
    const meetingId = meetingIdRef.current;
    if (!recorder || !meetingId || stoppingRef.current) return;
    stoppingRef.current = true;
    setState((s) => s && { ...s, stopping: true });
    try {
      // First keep the recording safe in this browser; that never needs the server.
      const result = await recorder.stop();
      await Promise.all(pendingSaves.current);
      if (result.blob.size > 0) {
        await putAudio({ meetingId, blob: result.blob, mimeType: result.mimeType });
      }
      if (result.video?.blob.size) {
        await putVideo({ meetingId, blob: result.video.blob, mimeType: result.video.mimeType });
      }
      // The complete files are stored now; the second-by-second parts are no longer needed.
      await deleteParts(meetingId).catch(() => {});
      const record = newMeeting(meetingId, createdAtRef.current, { status: "processing", durationMs: result.durationMs });
      try {
        if (meetingCreatedRef.current) await updateMeeting(meetingId, { status: "processing", durationMs: result.durationMs });
        else await createMeeting(record);
        void finalizeMeeting(meetingId);
      } catch {
        // Keep the meeting itself in the browser too, so it reaches the database once the server is back.
        if (!meetingCreatedRef.current) await saveBrowserMeeting(record).catch(() => {});
        // The app retries interrupted meetings every 30 s, so this one is picked up automatically.
        onError(
          "The recording is saved in this browser, but the server could not be reached. It will be uploaded and transcribed automatically once the server is running again — keep this tab open.",
        );
      }
    } catch (err) {
      onError(describeStartError(err));
    } finally {
      recorderRef.current = null;
      meetingIdRef.current = null;
      pendingSaves.current = [];
      stoppingRef.current = false;
      setState(null);
    }
  }, [onError]);

  const stopRef = useRef(stop);
  stopRef.current = stop;

  const start = useCallback(
    async (includeMic: boolean, includeVideo: boolean, micDeviceId?: string) => {
      if (recorderRef.current) return null;
      const meetingId = crypto.randomUUID();
      const recorder = new TabRecorder({
        // Saved as a safety net in case the tab closes before the full recording is stored.
        onChunk: (chunk) => {
          pendingSaves.current.push(putChunk({ ...chunk, id: `${meetingId}:${chunk.index}`, meetingId, status: "pending" }));
        },
        // Every second is written to the browser too, so a reload or crash loses at most seconds.
        onPart: (part) => {
          putPart({ ...part, meetingId }).catch((err) => console.warn("Could not save a recording part:", err));
        },
        // Never stop on our own when sharing ends: keep recording and make the user notice.
        onShareEnded: () => {
          setState((s) => s && { ...s, shareLost: true });
          notify(
            "Meeting Intelligence: tab sharing stopped",
            "The meeting's audio is no longer being captured (your microphone still is). Open Meeting Intelligence and click “Share tab again”.",
          );
        },
        onAutoStop: () => void stopRef.current(),
      });

      try {
        await recorder.start(includeMic, includeVideo, micDeviceId);
      } catch (err) {
        onError(describeStartError(err));
        return null;
      }

      recorderRef.current = recorder;
      meetingIdRef.current = meetingId;
      createdAtRef.current = Date.now();
      setState({
        meetingId,
        sourceLabel: recorder.sourceLabel,
        micActive: recorder.micActive,
        micLabel: recorder.micLabel,
        videoActive: recorder.videoActive,
        shareLost: false,
        stopping: false,
      });
      // Ask once, so a lost share can be announced even while the user is in another tab.
      if (typeof Notification !== "undefined" && Notification.permission === "default") void Notification.requestPermission();
      // Recording already runs locally; if the server is down the meeting is created at stop instead.
      try {
        await createMeeting(newMeeting(meetingId, createdAtRef.current, { status: "recording", durationMs: 0 }));
        meetingCreatedRef.current = true;
      } catch {
        meetingCreatedRef.current = false;
      }
      return meetingId;
    },
    [onError],
  );

  /** Shares a tab again after sharing was lost; the recording continues in the same file. */
  const reshare = useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    try {
      await recorder.reshare();
      setState((s) => s && { ...s, shareLost: false, sourceLabel: recorder.sourceLabel });
    } catch (err) {
      onError(describeStartError(err));
    }
  }, [onError]);

  // Closing the tab mid-recording would lose the audio that is still in memory.
  useEffect(() => {
    if (!state) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [state]);

  // A warning in the tab title is visible from the meeting's tab, unlike the page itself.
  const shareLost = Boolean(state?.shareLost);
  useEffect(() => {
    if (!shareLost) return;
    const original = document.title;
    document.title = "⚠ Sharing stopped — Meeting Intelligence";
    return () => {
      document.title = original;
    };
  }, [shareLost]);

  return {
    state,
    start,
    stop,
    reshare,
    ...readers,
  };
}

/**
 * Read-only views of the live recorder. Stable functions (they read the ref), so components can
 * list them as effect dependencies without the effect restarting on every render.
 */
function useRecorderReaders(recorderRef: { current: TabRecorder | null }) {
  const [readers] = useState(() => ({
    elapsed: () => recorderRef.current?.elapsed() ?? 0,
    level: () => recorderRef.current?.level() ?? 0,
    sourceLevels: () => recorderRef.current?.sourceLevels() ?? { meeting: 0, mic: 0 },
    /** What was shared: "browser" (a tab), "window" or "monitor" (entire screen). */
    surface: () => recorderRef.current?.surface,
  }));
  return readers;
}
