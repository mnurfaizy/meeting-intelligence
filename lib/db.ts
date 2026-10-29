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
}

let dbPromise: Promise<IDBPDatabase<LocalDB>> | null = null;

function db() {
  dbPromise ??= openDB<LocalDB>("meeting-intelligence", 1, {
    upgrade(d) {
      d.createObjectStore("meetings", { keyPath: "id" });
      d.createObjectStore("chunks", { keyPath: "id" }).createIndex("byMeeting", "meetingId");
      d.createObjectStore("audio", { keyPath: "meetingId" });
    },
  });
  return dbPromise;
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
  return Boolean((await getAudio(meetingId)) || (await getChunks(meetingId)).length);
}

export async function deleteLocalAudio(meetingId: string) {
  const tx = (await db()).transaction(["chunks", "audio"], "readwrite");
  for (const key of await tx.objectStore("chunks").index("byMeeting").getAllKeys(meetingId)) {
    await tx.objectStore("chunks").delete(key);
  }
  await tx.objectStore("audio").delete(meetingId);
  await tx.done;
}

/** Meetings saved by the browser-only version of the app, waiting to be moved to the database. */
export async function getLegacyMeetings() {
  return (await db()).getAll("meetings");
}

export async function removeLegacyMeeting(id: string) {
  await (await db()).delete("meetings", id);
}
