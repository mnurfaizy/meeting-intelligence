"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { putAudio, putChunk, putMeeting, updateMeeting } from "./db";
import { finalizeMeeting, transcribePending } from "./pipeline";
import { TabRecorder } from "./recorder";

export type RecordingState = {
  meetingId: string;
  sourceLabel: string;
  micActive: boolean;
  stopping: boolean;
};

function describeStartError(err: unknown) {
  if (err instanceof DOMException && err.name === "NotAllowedError") {
    return "Screen sharing was cancelled, or the browser blocked it.";
  }
  return err instanceof Error ? err.message : String(err);
}

export function useRecording(onError: (message: string) => void) {
  const [state, setState] = useState<RecordingState | null>(null);
  const recorderRef = useRef<TabRecorder | null>(null);
  const meetingIdRef = useRef<string | null>(null);
  const pendingSaves = useRef<Promise<unknown>[]>([]);
  const stoppingRef = useRef(false);

  const stop = useCallback(async () => {
    const recorder = recorderRef.current;
    const meetingId = meetingIdRef.current;
    if (!recorder || !meetingId || stoppingRef.current) return;
    stoppingRef.current = true;
    setState((s) => s && { ...s, stopping: true });
    try {
      const result = await recorder.stop();
      await Promise.all(pendingSaves.current);
      if (result.blob.size > 0) {
        await putAudio({ meetingId, blob: result.blob, mimeType: result.mimeType });
      }
      await updateMeeting(meetingId, { status: "processing", durationMs: result.durationMs });
      void finalizeMeeting(meetingId);
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
    async (includeMic: boolean) => {
      if (recorderRef.current) return null;
      const meetingId = crypto.randomUUID();
      const recorder = new TabRecorder({
        onChunk: (chunk) => {
          const saved = putChunk({ ...chunk, id: `${meetingId}:${chunk.index}`, meetingId, status: "pending" });
          pendingSaves.current.push(saved);
          // Transcribe each 10-minute slice while the meeting is still going.
          void saved.then(() => transcribePending(meetingId));
        },
        onAutoStop: () => void stopRef.current(),
      });

      try {
        await recorder.start(includeMic);
      } catch (err) {
        onError(describeStartError(err));
        return null;
      }

      recorderRef.current = recorder;
      meetingIdRef.current = meetingId;
      await putMeeting({
        id: meetingId,
        title: "",
        createdAt: Date.now(),
        durationMs: 0,
        source: "recording",
        status: "recording",
        transcript: [],
        summaryStatus: "idle",
        chat: [],
      });
      setState({ meetingId, sourceLabel: recorder.sourceLabel, micActive: recorder.micActive, stopping: false });
      return meetingId;
    },
    [onError],
  );

  // Closing the tab mid-recording would lose the audio that is still in memory.
  useEffect(() => {
    if (!state) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [state]);

  return {
    state,
    start,
    stop,
    elapsed: () => recorderRef.current?.elapsed() ?? 0,
    level: () => recorderRef.current?.level() ?? 0,
  };
}
