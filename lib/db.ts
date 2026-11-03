"use client";

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { emitChange } from "./events";
import type { AudioRecord, Chunk, Meeting } from "./types";

/**
 * Browser-only storage for audio, which is too large for the database. Meetings, transcripts
 * and chats live in the database (see store.ts); the "meetings" store here only holds data
 * from before the database existed, until it is migrated.
 */
interface LocalDB extends DBSchema {
  meetings: { key: string; value: Meeting };
  chunks: { key: string; value: Chunk; indexes: { byMeeting: string } };
  audio: { key: string; value: AudioRecord };
  /** Screen video recordings, until they are moved into the recordings folder. */
  video: { key: string; value: AudioRecord };
  /** Second-by-second parts of a recording in progress; joined, they rebuild it after a crash. */
  parts: { key: string; value: RecordingPart; indexes: { byMeeting: string } };
}

export type RecordingPart = { id: string; meetingId: string; kind: "audio" | "video"; seq: number; blob: Blob; mimeType: string };

let dbPromise: Promise<IDBPDatabase<LocalDB>> | null = null;

function db() {
  dbPromise ??= openDB<LocalDB>("meeting-intelligence", 3, {
    upgrade(d, oldVersion) {
      if (oldVersion < 1) {
        d.createObjectStore("meetings", { keyPath: "id" });
        d.createObjectStore("chunks", { keyPath: "id" }).createIndex("byMeeting", "meetingId");
        d.createObjectStore("audio", { keyPath: "meetingId" });
      }
      if (oldVersion < 2) d.createObjectStore("video", { keyPath: "meetingId" });
      if (oldVersion < 3) d.createObjectStore("parts", { keyPath: "id" }).createIndex("byMeeting", "meetingId");
    },
    // Another tab opened a newer version: step aside so its upgrade is not stuck behind us.
    blocking(_current, _next, event) {
      (event.target as IDBDatabase).close();
      dbPromise = null;
    },
  });
  return dbPromise;
}

export async function putPart(part: Omit<RecordingPart, "id">) {
  await (await db()).put("parts", { ...part, id: `${part.meetingId}:${part.kind}:${String(part.seq).padStart(6, "0")}` });
}

/** Joins the saved parts of one recording back into a single playable file, or null if there are none. */
export async function assembleParts(meetingId: string, kind: "audio" | "video") {
  const parts = (await (await db()).getAllFromIndex("parts", "byMeeting", meetingId)).filter((p) => p.kind === kind).sort((a, b) => a.seq - b.seq);
  if (!parts.length || parts[0].seq !== 0) return null; // without the first part there is no file header
  return { blob: new Blob(parts.map((p) => p.blob), { type: parts[0].mimeType }), mimeType: parts[0].mimeType };
}

export async function deleteParts(meetingId: string) {
  const tx = (await db()).transaction("parts", "readwrite");
  for (const key of await tx.store.index("byMeeting").getAllKeys(meetingId)) await tx.store.delete(key);
  await tx.done;
}

export async function putVideo(video: AudioRecord) {
  await (await db()).put("video", video);
  emitChange();
}

export async function getVideo(meetingId: string) {
  return (await db()).get("video", meetingId);
}

export async function deleteLocalVideo(meetingId: string) {
  await (await db()).delete("video", meetingId);
}

export async function getChunks(meetingId: string) {
  const chunks = await (await db()).getAllFromIndex("chunks", "byMeeting", meetingId);
  return chunks.sort((a, b) => a.index - b.index);
}

export async function putChunk(chunk: Chunk) {
  await (await db()).put("chunks", chunk);
  emitChange();
}

export async function putAudio(audio: AudioRecord) {
  await (await db()).put("audio", audio);
  emitChange();
}

export async function getAudio(meetingId: string) {
  return (await db()).get("audio", meetingId);
}

/** True when this browser holds audio for the meeting, so it can (re)transcribe it. */
export async function hasLocalAudio(meetingId: string) {
  if ((await getAudio(meetingId)) || (await getChunks(meetingId)).length) return true;
  return (await (await db()).countFromIndex("parts", "byMeeting", meetingId)) > 0;
}

export async function deleteLocalAudio(meetingId: string) {
  const tx = (await db()).transaction(["chunks", "audio"], "readwrite");
  for (const key of await tx.objectStore("chunks").index("byMeeting").getAllKeys(meetingId)) {
    await tx.objectStore("chunks").delete(key);
  }
  await tx.objectStore("audio").delete(meetingId);
  await tx.done;
  await deleteParts(meetingId);
}

/** Meetings saved by the browser-only version of the app, waiting to be moved to the database. */
export async function getLegacyMeetings() {
  return (await db()).getAll("meetings");
}

/** Keeps a meeting in the browser when the server is unreachable; moved to the database later. */
export async function saveBrowserMeeting(meeting: Meeting) {
  await (await db()).put("meetings", meeting);
}

export async function removeLegacyMeeting(id: string) {
  await (await db()).delete("meetings", id);
}
