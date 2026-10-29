import { createPartFromUri, type GoogleGenAI, type Part } from "@google/genai";
import { MODEL, HttpError, errorResponse, getClient, withRetry } from "@/lib/gemini";
import { parseClock } from "@/lib/format";
import type { Segment } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Gemini accepts up to ~20 MB inline per request; bigger files go through the Files API. */
const INLINE_LIMIT = 14 * 1024 * 1024;

const SCHEMA = {
  type: "object",
  properties: {
    segments: {
      type: "array",
      items: {
        type: "object",
        properties: {
          start: { type: "string", description: "Timestamp from the start of THIS audio file, MM:SS or H:MM:SS" },
          speaker: { type: "string" },
          text: { type: "string" },
        },
        required: ["start", "speaker", "text"],
        propertyOrdering: ["start", "speaker", "text"],
      },
    },
  },
  required: ["segments"],
};

function prompt(context: string) {
  return `Transcribe this meeting audio verbatim.

Rules:
- Keep the original spoken language exactly as spoken (often Indonesian mixed with English). Do NOT translate.
- Label speakers "Speaker 1", "Speaker 2", ... in order of first appearance. If a speaker's name is clearly said (e.g. they introduce themselves or are addressed by name), use that name instead.
- Start a new segment whenever the speaker changes, and split long monologues every 1-3 sentences.
- "start" is the time the segment begins, measured from the beginning of THIS audio file.
- Light clean-up only: drop pure filler sounds (eh, hmm) but never change meaning.
- If there is no speech at all, return an empty "segments" array.
${
  context
    ? `
This audio continues an earlier part of the same meeting. Keep speaker labels consistent with it. The end of the earlier part was:
<previous>
${context}
</previous>`
    : ""
}`;
}

function normalizeMime(mime: string) {
  const base = mime.split(";")[0].trim().toLowerCase();
  if (base === "audio/x-m4a") return "audio/mp4";
  return base || "audio/webm";
}

async function toPart(ai: GoogleGenAI, file: Blob, mimeType: string) {
  if (file.size <= INLINE_LIMIT) {
    const data = Buffer.from(await file.arrayBuffer()).toString("base64");
    return { part: { inlineData: { mimeType, data } } as Part };
  }
  let uploaded = await ai.files.upload({ file: new Blob([await file.arrayBuffer()], { type: mimeType }), config: { mimeType } });
  while (String(uploaded.state) === "PROCESSING") {
    await new Promise((r) => setTimeout(r, 2000));
    uploaded = await ai.files.get({ name: uploaded.name! });
  }
  if (String(uploaded.state) === "FAILED") throw new HttpError(422, "Gemini could not process this audio file.");
  return {
    part: createPartFromUri(uploaded.uri!, uploaded.mimeType!),
    cleanup: () => ai.files.delete({ name: uploaded.name! }).catch(() => {}),
  };
}

async function transcribe(ai: GoogleGenAI, file: Blob, mimeType: string, context: string) {
  const { part, cleanup } = await toPart(ai, file, mimeType);
  try {
    const res = await withRetry(() =>
      ai.models.generateContent({
        model: MODEL,
        contents: [{ role: "user", parts: [part, { text: prompt(context) }] }],
        config: { responseMimeType: "application/json", responseJsonSchema: SCHEMA, temperature: 0.2 },
      }),
    );
    return JSON.parse(res.text || "{}") as { segments?: { start: string; speaker: string; text: string }[] };
  } finally {
    await cleanup?.();
  }
}

export async function POST(req: Request) {
  try {
    const ai = getClient();
    const form = await req.formData();
    const file = form.get("audio");
    if (!(file instanceof Blob) || file.size === 0) throw new HttpError(400, "No audio received.");

    const mimeType = normalizeMime(String(form.get("mimeType") || file.type));
    const offsetSec = Number(form.get("offsetSec") || 0);
    const context = String(form.get("context") || "");

    let data;
    try {
      data = await transcribe(ai, file, mimeType, context);
    } catch (err) {
      // Chrome records WebM; if the audio/* label is rejected, the same bytes work as video/webm.
      if (mimeType !== "audio/webm" || !/mime|unsupported|invalid/i.test(String(err))) throw err;
      data = await transcribe(ai, file, "video/webm", context);
    }

    const segments: Segment[] = (data.segments ?? [])
      .filter((s) => s.text?.trim())
      .map((s) => ({
        start: offsetSec + parseClock(s.start),
        speaker: s.speaker?.trim() || "Speaker",
        text: s.text.trim(),
      }));
    return Response.json({ segments });
  } catch (err) {
    return errorResponse(err);
  }
}
