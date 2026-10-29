import { HttpError } from "./gemini";
import type { Segment } from "./types";

const BASE = "https://api.assemblyai.com/v2";

function apiKey() {
  const key = process.env.ASSEMBLYAI_API_KEY?.trim();
  if (!key) {
    throw new HttpError(500, "ASSEMBLYAI_API_KEY is not set. Add it to .env.local and restart the dev server.");
  }
  return key;
}

async function check(res: Response, action: string) {
  if (res.ok) return res;
  const body = await res.json().catch(() => ({}));
  const detail = (body as { error?: string }).error ?? res.statusText;
  if (res.status === 401) throw new HttpError(401, "AssemblyAI rejected the API key. Check ASSEMBLYAI_API_KEY in .env.local.");
  throw new HttpError(res.status, `AssemblyAI could not ${action}: ${detail}`);
}

/** Streams the request body straight to AssemblyAI without buffering it in memory. */
export async function uploadAudio(body: ReadableStream<Uint8Array>) {
  const res = await fetch(`${BASE}/upload`, {
    method: "POST",
    headers: { authorization: apiKey(), "content-type": "application/octet-stream" },
    body,
    duplex: "half",
  } as RequestInit);
  await check(res, "receive the audio");
  return ((await res.json()) as { upload_url: string }).upload_url;
}

export async function createTranscript(audioUrl: string) {
  const res = await fetch(`${BASE}/transcript`, {
    method: "POST",
    headers: { authorization: apiKey(), "content-type": "application/json" },
    body: JSON.stringify({
      audio_url: audioUrl,
      speaker_labels: true,
      language_detection: true,
    }),
  });
  await check(res, "start the transcription");
  return ((await res.json()) as { id: string }).id;
}

type Word = { text: string; start: number; end: number; speaker?: string | null };
type Utterance = { speaker: string; start: number; text: string; words: Word[] };
type Transcript = {
  status: "queued" | "processing" | "completed" | "error";
  error?: string;
  audio_duration?: number | null;
  language_code?: string;
  utterances?: Utterance[] | null;
};

export async function getTranscript(id: string) {
  const res = await fetch(`${BASE}/transcript/${encodeURIComponent(id)}`, {
    headers: { authorization: apiKey() },
    cache: "no-store",
  });
  await check(res, "find the transcription");
  return (await res.json()) as Transcript;
}

/**
 * AssemblyAI returns one utterance per speaker turn, which can run for minutes.
 * Split each turn at sentence ends so every line gets its own clickable timestamp.
 */
export function toSegments(utterances: Utterance[]): Segment[] {
  const order: string[] = [];
  const label = (speaker: string) => {
    if (!order.includes(speaker)) order.push(speaker);
    return `Speaker ${order.indexOf(speaker) + 1}`;
  };

  const segments: Segment[] = [];
  for (const u of utterances) {
    const speaker = label(u.speaker);
    if (!u.words?.length) {
      segments.push({ start: u.start / 1000, speaker, text: u.text });
      continue;
    }
    let words: Word[] = [];
    const flush = () => {
      if (!words.length) return;
      segments.push({ start: words[0].start / 1000, speaker, text: words.map((w) => w.text).join(" ") });
      words = [];
    };
    for (const word of u.words) {
      words.push(word);
      // End a line at a sentence boundary once it has a reasonable length.
      if (/[.?!]$/.test(word.text) && words.length >= 6) flush();
    }
    flush();
  }
  return segments;
}
