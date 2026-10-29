import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";

/** Folder where recordings are kept as plain files. Point it at a Google Drive folder to back them up. */
// The turbopackIgnore comments keep the build from bundling the whole project to "trace" this runtime folder.
export const AUDIO_DIR = path.resolve(
  /*turbopackIgnore: true*/ process.env.AUDIO_DIR?.trim() || path.join(/*turbopackIgnore: true*/ process.cwd(), "recordings"),
);

const EXTENSIONS: Record<string, string> = {
  "audio/webm": "webm",
  "video/webm": "webm",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/m4a": "m4a",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/ogg": "ogg",
  "audio/flac": "flac",
  "audio/aac": "aac",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
};

const MIME_BY_EXT = Object.fromEntries(Object.entries(EXTENSIONS).map(([mime, ext]) => [ext, mime]));

function extensionFor(mimeType: string, originalName?: string) {
  const fromName = originalName?.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase();
  return fromName || EXTENSIONS[mimeType.split(";")[0].trim().toLowerCase()] || "bin";
}

/** e.g. "2026-10-29_1407_3f2a9c1b.webm" — sorts by date and never changes when a meeting is renamed. */
function fileNameFor(meetingId: string, createdAt: number, ext: string) {
  const d = new Date(createdAt);
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
  return `${stamp}_${meetingId.slice(0, 8)}.${ext}`;
}

/** Only bare file names inside AUDIO_DIR are ever read or deleted. */
export function audioPath(fileName: string) {
  const full = path.join(/*turbopackIgnore: true*/ AUDIO_DIR, path.basename(fileName));
  if (path.dirname(/*turbopackIgnore: true*/ full) !== AUDIO_DIR) throw new Error("Invalid audio file name.");
  return full;
}

export function mimeForFile(fileName: string) {
  return MIME_BY_EXT[path.extname(fileName).slice(1).toLowerCase()] ?? "application/octet-stream";
}

/** Streams an upload to disk; writes to a temp file first so a failed upload never leaves a half file. */
export async function saveAudio(
  body: ReadableStream<Uint8Array>,
  opts: { meetingId: string; createdAt: number; mimeType: string; originalName?: string },
) {
  await mkdir(/*turbopackIgnore: true*/ AUDIO_DIR, { recursive: true });
  const fileName = fileNameFor(opts.meetingId, opts.createdAt, extensionFor(opts.mimeType, opts.originalName));
  const target = audioPath(fileName);
  const temp = `${target}.part`;
  try {
    await pipeline(Readable.fromWeb(body as WebReadableStream<Uint8Array>), createWriteStream(/*turbopackIgnore: true*/ temp));
    await rename(/*turbopackIgnore: true*/ temp, target);
  } catch (err) {
    await rm(/*turbopackIgnore: true*/ temp, { force: true });
    throw err;
  }
  return fileName;
}

export async function audioSize(fileName: string) {
  return (await stat(/*turbopackIgnore: true*/ audioPath(fileName))).size;
}

export function readAudio(fileName: string, range?: { start: number; end: number }) {
  return Readable.toWeb(createReadStream(/*turbopackIgnore: true*/ audioPath(fileName), range)) as ReadableStream<Uint8Array>;
}

export async function deleteAudio(fileName: string) {
  await rm(/*turbopackIgnore: true*/ audioPath(fileName), { force: true });
}
