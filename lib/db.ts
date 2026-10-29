"use client";

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { AudioRecord, Chunk, Meeting } from "./types";

interface MeetingDB extends DBSchema {
  meetings: { key: string; value: Meeting };
  chunks: { key: string; value: Chunk; indexes: { byMeeting: string } };
  audio: { key: string; value: AudioRecord };
}

let dbPromise: Promise<IDBPDatabase<MeetingDB>> | null = null;

function db() {
  dbPromise ??= openDB<MeetingDB>("meeting-intelligence", 1, {
    upgrade(d) {
      d.createObjectStore("meetings", { keyPath: "id" });
      d.createObjectStore("chunks", { keyPath: "id" }).createIndex("byMeeting", "meetingId");
      d.createObjectStore("audio", { keyPath: "meetingId" });
    },
  });
  return dbPromise;
}

/** Fired on window after every write so hooks can re-read. */
export const CHANGE_EVENT = "mi:changed";

function changed() {
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export async function listMeetings() {
  const all = await (await db()).getAll("meetings");
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function getMeeting(id: string) {
  return (await db()).get("meetings", id);
}

export async function putMeeting(meeting: Meeting) {
  await (await db()).put("meetings", meeting);
  changed();
}

export async function updateMeeting(
  id: string,
  patch: Partial<Meeting> | ((m: Meeting) => Partial<Meeting>),
) {
  const tx = (await db()).transaction("meetings", "readwrite");
  const current = await tx.store.get(id);
  if (!current) {
    await tx.done;
    return undefined;
  }
  const next = { ...current, ...(typeof patch === "function" ? patch(current) : patch) };
  await tx.store.put(next);
  await tx.done;
  changed();
  return next;
}

export async function deleteMeeting(id: string) {
  const tx = (await db()).transaction(["meetings", "chunks", "audio"], "readwrite");
  await tx.objectStore("meetings").delete(id);
  const chunkKeys = await tx.objectStore("chunks").index("byMeeting").getAllKeys(id);
  for (const key of chunkKeys) await tx.objectStore("chunks").delete(key);
  await tx.objectStore("audio").delete(id);
  await tx.done;
  changed();
}

export async function getChunks(meetingId: string) {
  const chunks = await (await db()).getAllFromIndex("chunks", "byMeeting", meetingId);
  return chunks.sort((a, b) => a.index - b.index);
}

export async function putChunk(chunk: Chunk) {
  await (await db()).put("chunks", chunk);
  changed();
}

export async function putAudio(audio: AudioRecord) {
  await (await db()).put("audio", audio);
  changed();
}

export async function getAudio(meetingId: string) {
  return (await db()).get("audio", meetingId);
}
