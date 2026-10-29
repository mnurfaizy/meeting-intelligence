"use client";

import { getAudio, getChunks, getMeeting, updateMeeting } from "./db";
import { transcriptToText } from "./format";
import type { ChatMessage, Segment } from "./types";

// ---- API calls ------------------------------------------------------------

async function readError(res: Response, fallback: string) {
  const data = await res.json().catch(() => ({}));
  return new Error(data.error || `${fallback} (HTTP ${res.status})`);
}

/** Uploads audio and starts an AssemblyAI job; returns the job id. */
async function apiStartTranscription(blob: Blob) {
  const res = await fetch("/api/transcripts", {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: blob,
  });
  if (!res.ok) throw await readError(res, "Upload failed");
  return ((await res.json()) as { id: string }).id;
}

type JobResult = { segments: Segment[]; durationMs: number };

/** Polls a job until it finishes. AssemblyAI usually needs well under a minute per hour of audio. */
async function apiWaitForTranscript(id: string): Promise<JobResult> {
  for (;;) {
    const res = await fetch(`/api/transcripts/${encodeURIComponent(id)}`);
    if (!res.ok) throw await readError(res, "Transcription failed");
    const data = (await res.json()) as { status: string; error?: string } & Partial<JobResult>;
    if (data.status === "completed") return { segments: data.segments ?? [], durationMs: data.durationMs ?? 0 };
    if (data.status === "error") throw new Error(data.error || "Transcription failed.");
    await new Promise((r) => setTimeout(r, 3000));
  }
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

/** Work for one meeting runs strictly in order, so a retry never races a running job. */
const queues = new Map<string, Promise<void>>();

function enqueue(meetingId: string, task: () => Promise<void>) {
  const next = (queues.get(meetingId) ?? Promise.resolve()).then(task).catch((err) => console.error(err));
  queues.set(meetingId, next);
  return next;
}

/** Transcribes the full recording in one job, so speaker labels stay consistent throughout. */
async function transcribeFullAudio(meetingId: string, blob: Blob): Promise<JobResult> {
  let jobId = (await getMeeting(meetingId))?.transcriptionJobId;
  if (!jobId) {
    await updateMeeting(meetingId, { phase: "uploading" });
    jobId = await apiStartTranscription(blob);
    await updateMeeting(meetingId, { transcriptionJobId: jobId });
  }
  await updateMeeting(meetingId, { phase: "transcribing" });
  return apiWaitForTranscript(jobId);
}

/** Fallback when the tab closed mid-recording: transcribe the saved 10-minute parts one by one. */
async function transcribeSavedParts(meetingId: string): Promise<JobResult> {
  const chunks = await getChunks(meetingId);
  if (!chunks.length) throw new Error("No audio was captured for this meeting.");
  await updateMeeting(meetingId, { phase: "uploading" });
  const segments: Segment[] = [];
  for (const chunk of chunks) {
    const { segments: part } = await apiWaitForTranscript(await apiStartTranscription(chunk.blob));
    segments.push(...part.map((s) => ({ ...s, start: s.start + chunk.startMs / 1000 })));
  }
  return { segments, durationMs: chunks.reduce((sum, c) => sum + c.durationMs, 0) };
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

/** Transcribes the meeting, then writes the summary. Safe to call again after a reload. */
export function finalizeMeeting(meetingId: string) {
  return enqueue(meetingId, async () => {
    await updateMeeting(meetingId, { status: "processing", error: undefined });
    try {
      const audio = await getAudio(meetingId);
      const { segments, durationMs } = audio ? await transcribeFullAudio(meetingId, audio.blob) : await transcribeSavedParts(meetingId);
      await updateMeeting(meetingId, (m) => ({
        status: "ready",
        phase: undefined,
        transcript: segments,
        durationMs: m.durationMs || durationMs,
      }));
    } catch (err) {
      // Forget the job so "Try again" starts a fresh upload.
      await updateMeeting(meetingId, { status: "error", phase: undefined, transcriptionJobId: undefined, error: message(err) });
      return;
    }
    await summarize(meetingId);
  });
}

/** "Transcribe again": discard the previous job and start over. */
export async function retranscribeMeeting(meetingId: string) {
  await updateMeeting(meetingId, { transcriptionJobId: undefined });
  return finalizeMeeting(meetingId);
}

export function regenerateSummary(meetingId: string) {
  return enqueue(meetingId, () => summarize(meetingId));
}
