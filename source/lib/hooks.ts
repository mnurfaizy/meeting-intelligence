"use client";

import { useEffect, useState } from "react";
import { getAudio, getChunks, getVideo } from "./db";
import { readFromFolder, useFolderState, useStorageMode } from "./deviceFolder";
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

/** What the player shows: a playable source, or why there is none. */
export type MediaState =
  | { status: "ready"; url: string; video: boolean }
  | { status: "loading" | "none" }
  /** The file is in the folder on this computer, which isn't chosen / allowed / supported here, or lacks it. */
  | { status: "needs-folder" | "needs-access" | "unsupported" | "missing"; file: string };

/**
 * What the player should play: the screen video when there is one, otherwise the audio (an
 * imported video file counts as video). A copy still kept in this browser wins; otherwise the
 * file in the recordings folder — the server's, or the one on this computer.
 */
export function useMediaSource(meeting: Pick<Meeting, "id" | "status" | "audioFile" | "audioMime" | "videoFile">): MediaState {
  const { id, status, audioFile, audioMime, videoFile } = meeting;
  const mode = useStorageMode();
  const folder = useFolderState();
  const [state, setState] = useState<MediaState>({ status: "loading" });
  const recording = status === "recording";

  useEffect(() => {
    if (!mode || (mode === "device" && !folder)) return;
    let objectUrl: string | null = null;
    let cancelled = false;
    const show = (next: MediaState) => !cancelled && setState(next);
    const showBlob = (blob: Blob, video: boolean) => {
      if (cancelled) return;
      objectUrl = URL.createObjectURL(blob);
      setState({ status: "ready", url: objectUrl, video });
    };
    (async () => {
      const video = await getVideo(id);
      const record = video ?? (await getAudio(id));
      if (record) return showBlob(record.blob, Boolean(video) || record.mimeType.startsWith("video/"));
      if (!videoFile && !audioFile) return show({ status: "none" });

      // The file name changes when a recording is replaced, which busts the browser cache.
      if (mode === "server") {
        if (videoFile) return show({ status: "ready", url: `/api/meetings/${id}/audio?kind=video&f=${encodeURIComponent(videoFile)}`, video: true });
        return show({ status: "ready", url: `/api/meetings/${id}/audio?f=${encodeURIComponent(audioFile!)}`, video: Boolean(audioMime?.startsWith("video/")) });
      }

      const wanted = (videoFile ?? audioFile)!;
      if (folder!.access === "unsupported") return show({ status: "unsupported", file: wanted });
      if (folder!.access === "none") return show({ status: "needs-folder", file: wanted });
      if (folder!.access === "prompt") return show({ status: "needs-access", file: wanted });
      const videoBlob = videoFile ? await readFromFolder(videoFile) : undefined;
      if (videoBlob) return showBlob(videoBlob, true);
      const audioBlob = audioFile ? await readFromFolder(audioFile) : undefined;
      if (audioBlob) return showBlob(audioBlob, Boolean(audioMime?.startsWith("video/")));
      show({ status: "missing", file: wanted });
    })().catch((err) => {
      console.warn("Could not load the recording:", err);
      show({ status: "missing", file: (videoFile ?? audioFile) || "" });
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // Recordings are written once recording stops, which moves status away from "recording".
  }, [id, recording, audioFile, audioMime, videoFile, mode, folder?.access, folder?.name]);

  return state;
}
