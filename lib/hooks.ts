"use client";

import { useEffect, useState } from "react";
import { getAudio, getChunks } from "./db";
import { CHANGE_EVENT } from "./events";
import { getMeeting, listMeetings } from "./store";
import type { Chunk, Meeting, MeetingListItem } from "./types";

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
  return useLive<MeetingListItem[] | null>(listMeetings, null, []);
}

/** Full meeting (with transcript and chat); null while loading or when none is selected. */
export function useMeeting(id: string | null) {
  return useLive<Meeting | null>(async () => (id ? ((await getMeeting(id)) ?? null) : null), null, [id]);
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
