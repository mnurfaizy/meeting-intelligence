"use client";

import { useEffect, useState } from "react";
import { CHANGE_EVENT, getAudio, getChunks, listMeetings } from "./db";
import type { Chunk, Meeting } from "./types";

/** Re-runs `load` on every database write. */
function useLive<T>(load: () => Promise<T>, initial: T, deps: unknown[]) {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    let cancelled = false;
    const refresh = () => load().then((v) => !cancelled && setValue(v));
    refresh();
    window.addEventListener(CHANGE_EVENT, refresh);
    return () => {
      cancelled = true;
      window.removeEventListener(CHANGE_EVENT, refresh);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return value;
}

export function useMeetings() {
  return useLive<Meeting[] | null>(listMeetings, null, []);
}

export function useChunks(meetingId: string | null) {
  return useLive<Chunk[]>(() => (meetingId ? getChunks(meetingId) : Promise.resolve([])), [], [meetingId]);
}

/** Object URL for a meeting's full recording, or null when there is none. */
export function useAudioUrl(meetingId: string, status: Meeting["status"]) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    getAudio(meetingId).then((audio) => {
      if (cancelled || !audio) return setUrl(null);
      objectUrl = URL.createObjectURL(audio.blob);
      setUrl(objectUrl);
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // The audio is written once recording stops, which moves status away from "recording".
  }, [meetingId, status === "recording"]);
  return url;
}
