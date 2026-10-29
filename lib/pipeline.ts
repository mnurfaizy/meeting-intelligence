"use client";

import { getChunks, getMeeting, putChunk, updateMeeting } from "./db";
import { fmtClock, transcriptToText } from "./format";
import type { ChatMessage, Segment } from "./types";

// ---- API calls ------------------------------------------------------------

async function readError(res: Response, fallback: string) {
  const data = await res.json().catch(() => ({}));
  return new Error(data.error || `${fallback} (HTTP ${res.status})`);
}

async function apiTranscribe(blob: Blob, mimeType: string, offsetSec: number, context: string) {
  const form = new FormData();
  form.append("audio", blob, "audio");
  form.append("mimeType", mimeType);
  form.append("offsetSec", String(offsetSec));
  if (context) form.append("context", context);
  const res = await fetch("/api/transcribe", { method: "POST", body: form });
  if (!res.ok) throw await readError(res, "Transcription failed");
  return ((await res.json()) as { segments: Segment[] }).segments;
}

async function apiSummary(transcript: string) {
  const res = await fetch("/api/summary", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transcript }),
  });
  if (!res.ok) throw await readError(res, "Summary failed");
  return (await res.json()) as { title: string; summary: string };
}

/** Streams the assistant's reply, calling onText with the full text so far. */
export async function streamChat(
  body: { title: string; transcript: string; summary?: string; messages: ChatMessage[] },
  onText: (text: string) => void,
) {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) throw await readError(res, "Assistant failed");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
    onText(text);
  }
  return text;
}

// ---- Pipeline -------------------------------------------------------------

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Work for one meeting runs strictly in order, so chunk N can use chunk N-1 as context. */
const queues = new Map<string, Promise<void>>();

function enqueue(meetingId: string, task: () => Promise<void>) {
  const next = (queues.get(meetingId) ?? Promise.resolve()).then(task).catch((err) => console.error(err));
  queues.set(meetingId, next);
  return next;
}

/** Last few lines of the previous chunk, so speaker labels stay consistent. */
function contextFrom(segments: Segment[] | undefined) {
  return (segments ?? [])
    .slice(-8)
    .map((s) => `[${fmtClock(s.start)}] ${s.speaker}: ${s.text}`)
    .join("\n");
}

async function transcribeChunks(meetingId: string, retryErrors: boolean) {
  const chunks = await getChunks(meetingId);
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (chunk.status === "done" || (chunk.status === "error" && !retryErrors)) continue;

    await putChunk({ ...chunk, status: "transcribing", error: undefined });
    try {
      const segments = await apiTranscribe(chunk.blob, chunk.mimeType, chunk.startMs / 1000, contextFrom(chunks[i - 1]?.segments));
      chunks[i] = { ...chunk, status: "done", segments, error: undefined };
    } catch (err) {
      chunks[i] = { ...chunk, status: "error", error: message(err) };
    }
    await putChunk(chunks[i]);
  }
  return chunks;
}

async function summarize(meetingId: string) {
  const meeting = await getMeeting(meetingId);
  if (!meeting?.transcript.length) return;
  await updateMeeting(meetingId, { summaryStatus: "generating", summaryError: undefined });
  try {
    const { title, summary } = await apiSummary(transcriptToText(meeting.transcript));
    await updateMeeting(meetingId, (m) => ({
      summary,
      summaryStatus: "done",
      title: m.titleEdited || !title ? m.title : title,
    }));
  } catch (err) {
    await updateMeeting(meetingId, { summaryStatus: "error", summaryError: message(err) });
  }
}

/** Called whenever a new chunk is saved during recording. */
export function transcribePending(meetingId: string) {
  return enqueue(meetingId, async () => {
    await transcribeChunks(meetingId, false);
  });
}

/** Transcribes whatever is left, merges the transcript and writes the summary. */
export function finalizeMeeting(meetingId: string) {
  return enqueue(meetingId, async () => {
    await updateMeeting(meetingId, { status: "processing", error: undefined });
    const chunks = await transcribeChunks(meetingId, true);
    const failed = chunks.find((c) => c.status !== "done");
    if (!chunks.length || failed) {
      await updateMeeting(meetingId, {
        status: "error",
        error: failed?.error ?? "No audio was captured for this meeting.",
      });
      return;
    }
    const transcript = chunks.flatMap((c) => c.segments ?? []);
    await updateMeeting(meetingId, (m) => ({
      status: "ready",
      transcript,
      durationMs: m.durationMs || chunks.reduce((sum, c) => sum + c.durationMs, 0),
    }));
    await summarize(meetingId);
  });
}

/** "Regenerate transcript": throw away all chunk results and start over. */
export async function retranscribeMeeting(meetingId: string) {
  await enqueue(meetingId, async () => {
    for (const chunk of await getChunks(meetingId)) {
      await putChunk({ ...chunk, status: "pending", segments: undefined, error: undefined });
    }
  });
  return finalizeMeeting(meetingId);
}

export function regenerateSummary(meetingId: string) {
  return enqueue(meetingId, () => summarize(meetingId));
}
