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

/**
 * URL of a meeting's full recording: the file in the server's recordings folder, or — until it
 * has been moved there — the copy kept in this browser. Null when there is none.
 */
export function useAudioUrl(meeting: Pick<Meeting, "id" | "status" | "audioFile">) {
  const { id, status, audioFile } = meeting;
  const [localUrl, setLocalUrl] = useState<string | null>(null);
  useEffect(() => {
    if (audioFile) return;
    let objectUrl: string | null = null;
    let cancelled = false;
    getAudio(id).then((audio) => {
      if (cancelled || !audio) return setLocalUrl(null);
      objectUrl = URL.createObjectURL(audio.blob);
      setLocalUrl(objectUrl);
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // The audio is written once recording stops, which moves status away from "recording".
  }, [id, audioFile, status === "recording"]);
  // The file name changes when a recording is replaced, which busts the browser cache.
  return audioFile ? `/api/meetings/${id}/audio?f=${encodeURIComponent(audioFile)}` : localUrl;
}
