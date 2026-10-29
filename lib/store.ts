"use client";

import { deleteLocalAudio, getAudio, getLegacyMeetings, removeLegacyMeeting } from "./db";
import { emitChange } from "./events";
import type { AudioRecord, ChatMessage, Meeting, MeetingListItem } from "./types";

/** Meetings, transcripts and chats live in the database behind /api/meetings. */

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    cache: "no-store",
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Request failed (HTTP ${res.status})`);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

/** JSON drops `undefined`, so send `null` to clear a field. */
const withNulls = (patch: object) =>
  Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, v === undefined ? null : v]));

export function listMeetings() {
  return request<MeetingListItem[]>("/api/meetings");
}

export function getMeeting(id: string) {
  return request<Meeting>(`/api/meetings/${id}`).catch(() => undefined);
}

export async function createMeeting(meeting: Meeting) {
  const saved = await request<Meeting>("/api/meetings", { method: "POST", body: JSON.stringify(meeting) });
  emitChange();
  return saved;
}

export type MeetingUpdate = Partial<Omit<Meeting, "id" | "chat">>;

export async function updateMeeting(id: string, patch: MeetingUpdate | ((m: Meeting) => MeetingUpdate)) {
  let changes = patch;
  if (typeof changes === "function") {
    const current = await getMeeting(id);
    if (!current) return undefined;
    changes = changes(current);
  }
  const saved = await request<Meeting>(`/api/meetings/${id}`, { method: "PATCH", body: JSON.stringify(withNulls(changes)) });
  emitChange();
  return saved;
}

/** The stored blob with its MIME type set, so the server picks the right file extension. */
export function asTypedBlob(audio: AudioRecord) {
  return audio.blob.type ? audio.blob : new Blob([audio.blob], { type: audio.mimeType });
}

/** Saves a recording into the server's recordings folder. */
export async function uploadMeetingAudio(id: string, blob: Blob, fileName?: string) {
  const res = await fetch(`/api/meetings/${id}/audio`, {
    method: "PUT",
    headers: {
      "Content-Type": blob.type || "application/octet-stream",
      ...(fileName ? { "X-File-Name": encodeURIComponent(fileName) } : {}),
    },
    body: blob,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Could not save the audio file (HTTP ${res.status})`);
  }
  emitChange();
  return (await res.json()) as Meeting;
}

/** Starts transcription of the meeting's saved audio file; returns the job id. */
export async function startServerTranscription(id: string) {
  return (await request<{ id: string }>(`/api/meetings/${id}/transcription`, { method: "POST" })).id;
}

export async function appendMessages(id: string, messages: ChatMessage[]) {
  await request(`/api/meetings/${id}/messages`, { method: "POST", body: JSON.stringify({ messages }) });
  emitChange();
}

export async function deleteMeeting(id: string) {
  await request(`/api/meetings/${id}`, { method: "DELETE" });
  await deleteLocalAudio(id);
  emitChange();
}

/**
 * One-time move of meetings saved by the browser-only version into the database.
 * Audio stays in the browser. Returns how many meetings were moved.
 */
export async function migrateBrowserMeetings() {
  const legacy = await getLegacyMeetings();
  for (const meeting of legacy) {
    await request("/api/meetings", { method: "POST", body: JSON.stringify(meeting) });
    await removeLegacyMeeting(meeting.id);
  }
  if (legacy.length) emitChange();
  return legacy.length;
}

/**
 * Moves recordings that are still stored in this browser into the recordings folder.
 * Meetings that are mid-transcription are skipped; finalizeMeeting moves those itself.
 */
export async function moveBrowserAudioToFolder(meetings: MeetingListItem[]) {
  let moved = 0;
  for (const m of meetings) {
    if (m.audioFile || m.status === "recording" || m.status === "processing") continue;
    const local = await getAudio(m.id);
    if (!local) continue;
    await uploadMeetingAudio(m.id, asTypedBlob(local), local.blob instanceof File ? local.blob.name : undefined);
    await deleteLocalAudio(m.id);
    moved++;
  }
  return moved;
}
