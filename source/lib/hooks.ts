"use client";

import { useEffect, useState } from "react";
import { getAudio, getChunks, getVideo } from "./db";
import { CHANGE_EVENT } from "./events";
import { getMeeting, listMeetings } from "./store";
import type { Chunk, Meeting, MeetingListItem } from "./types";

/** Re-runs `load` on every database write. */
function useLive<T>(load: () => Promise<T>, initial: T, deps: unknown[]) {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    let cancelled = false;
    // If the server is briefly unreachable (e.g. restarting), keep showing the last data.
    const refresh = () =>
      load()
        .then((v) => !cancelled && setValue(v))
        .catch((err) => console.warn("Could not refresh:", err));
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

export type MediaSource = { url: string; video: boolean };

/**
 * What the player should play: the screen video when there is one, otherwise the audio (an
 * imported video file counts as video). Files in the recordings folder win; until a recording
 * has been moved there, the copy kept in this browser is used. Null when there is nothing.
 */
export function useMediaSource(meeting: Pick<Meeting, "id" | "status" | "audioFile" | "audioMime" | "videoFile">): MediaSource | null {
  const { id, status, audioFile, audioMime, videoFile } = meeting;
  const onServer = Boolean(audioFile || videoFile);
  const [local, setLocal] = useState<MediaSource | null>(null);
  useEffect(() => {
    if (onServer) return;
    let objectUrl: string | null = null;
    let cancelled = false;
    (async () => {
      const video = await getVideo(id);
      const record = video ?? (await getAudio(id));
      if (cancelled) return;
      if (!record) return setLocal(null);
      objectUrl = URL.createObjectURL(record.blob);
      setLocal({ url: objectUrl, video: Boolean(video) || record.mimeType.startsWith("video/") });
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // Recordings are written once recording stops, which moves status away from "recording".
  }, [id, onServer, status === "recording"]);

  // The file name changes when a recording is replaced, which busts the browser cache.
  if (videoFile) return { url: `/api/meetings/${id}/audio?kind=video&f=${encodeURIComponent(videoFile)}`, video: true };
  if (audioFile) return { url: `/api/meetings/${id}/audio?f=${encodeURIComponent(audioFile)}`, video: Boolean(audioMime?.startsWith("video/")) };
  return onServer ? null : local;
}
