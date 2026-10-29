"use client";

import { deleteLocalAudio, getLegacyMeetings, removeLegacyMeeting } from "./db";
import { emitChange } from "./events";
import type { ChatMessage, Meeting, MeetingListItem } from "./types";

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
