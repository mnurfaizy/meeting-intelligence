import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { HttpError } from "../gemini";

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
  "video/x-matroska": "mkv",
  "audio/x-ms-wma": "wma",
};

const MIME_BY_EXT = Object.fromEntries(Object.entries(EXTENSIONS).map(([mime, ext]) => [ext, mime]));

function extensionFor(mimeType: string, originalName?: string) {
  const fromName = originalName?.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase();
  return fromName || EXTENSIONS[mimeType.split(";")[0].trim().toLowerCase()] || "bin";
}

export type MediaKind = "audio" | "video";

/**
 * e.g. "2026-10-29_1407_3f2a9c1b.webm" and, for screen video, "2026-10-29_1407_3f2a9c1b-video.webm".
 * Sorts by date and never changes when a meeting is renamed.
 */
function fileNameFor(meetingId: string, createdAt: number, ext: string, kind: MediaKind) {
  const d = new Date(createdAt);
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
  return `${stamp}_${meetingId.slice(0, 8)}${kind === "video" ? "-video" : ""}.${ext}`;
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
  opts: { meetingId: string; createdAt: number; mimeType: string; originalName?: string; kind: MediaKind },
) {
  await mkdir(/*turbopackIgnore: true*/ AUDIO_DIR, { recursive: true });
  const fileName = fileNameFor(opts.meetingId, opts.createdAt, extensionFor(opts.mimeType, opts.originalName), opts.kind);
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

export async function fileSize(fullPath: string) {
  return (await stat(/*turbopackIgnore: true*/ fullPath)).size;
}

export function readFile(fullPath: string, range?: { start: number; end: number }) {
  return Readable.toWeb(createReadStream(/*turbopackIgnore: true*/ fullPath, range)) as ReadableStream<Uint8Array>;
}

export function readAudio(fileName: string, range?: { start: number; end: number }) {
  return readFile(audioPath(fileName), range);
}

// ---- Playback copies ---------------------------------------------------------

/** Formats Chrome/Edge can play directly. Anything else gets a converted copy for the player. */
const BROWSER_PLAYABLE = new Set(["webm", "ogg", "oga", "opus", "mp3", "m4a", "mp4", "wav", "flac", "aac", "mkv", "mov"]);

export const needsPlaybackCopy = (fileName: string) => !BROWSER_PLAYABLE.has(path.extname(fileName).slice(1).toLowerCase());

/** Converted copies live in a hidden subfolder, next to the originals they were made from. */
const playbackPath = (fileName: string) =>
  path.join(/*turbopackIgnore: true*/ AUDIO_DIR, ".playback", `${path.parse(path.basename(fileName)).name}.webm`);

const conversions = new Map<string, Promise<string>>();

/**
 * Returns the path of a browser-playable Opus/WebM copy of `fileName` (WMA, AMR, …), making it
 * with ffmpeg the first time. Concurrent callers share one conversion. The original is untouched.
 */
export function ensurePlaybackCopy(fileName: string): Promise<string> {
  const target = playbackPath(fileName);
  const running = conversions.get(target);
  if (running) return running;

  const job = (async () => {
    if (await fileSize(target).catch(() => 0)) return target;
    await mkdir(/*turbopackIgnore: true*/ path.dirname(target), { recursive: true });
    const temp = `${target}.part`;
    await new Promise<void>((resolve, reject) => {
      const args = ["-y", "-loglevel", "error", "-i", audioPath(fileName), "-vn", "-c:a", "libopus", "-b:a", "64k", "-f", "webm", temp];
      const ffmpeg = spawn(/*turbopackIgnore: true*/ process.env.FFMPEG_PATH?.trim() || "ffmpeg", args, { windowsHide: true });
      let stderr = "";
      ffmpeg.stderr.on("data", (d) => (stderr += d));
      ffmpeg.on("error", (err: NodeJS.ErrnoException) =>
        reject(
          err.code === "ENOENT"
            ? new HttpError(415, "This audio format can't be played in the browser, and ffmpeg (needed to convert it) was not found. Install ffmpeg or set FFMPEG_PATH.")
            : err,
        ),
      );
      ffmpeg.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg could not convert the file: ${stderr.trim().slice(0, 300)}`))));
    }).catch(async (err) => {
      await rm(/*turbopackIgnore: true*/ temp, { force: true });
      throw err;
    });
    await rename(/*turbopackIgnore: true*/ temp, target);
    return target;
  })().finally(() => conversions.delete(target));

  conversions.set(target, job);
  return job;
}

export async function deleteAudio(fileName: string) {
  await rm(/*turbopackIgnore: true*/ audioPath(fileName), { force: true });
  await rm(/*turbopackIgnore: true*/ playbackPath(fileName), { force: true });
}
