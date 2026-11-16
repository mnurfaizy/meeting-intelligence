import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { MIME_BY_EXT, extensionFor, fileNameFor, type MediaKind } from "../fileNames";
import { HttpError } from "../gemini";

/** Folder where recordings are kept as plain files. Point it at a Google Drive folder to back them up. */
// The turbopackIgnore comments keep the build from bundling the whole project to "trace" this runtime folder.
export const AUDIO_DIR = path.resolve(
  /*turbopackIgnore: true*/ process.env.AUDIO_DIR?.trim() || path.join(/*turbopackIgnore: true*/ process.cwd(), "recordings"),
);

export type { MediaKind };

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

/** Runs ffmpeg with the given arguments; rejects with a readable error if it is missing or fails. */
function runFfmpeg(args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const ffmpeg = spawn(/*turbopackIgnore: true*/ process.env.FFMPEG_PATH?.trim() || "ffmpeg", ["-y", "-loglevel", "error", ...args], {
      windowsHide: true,
    });
    let stderr = "";
    ffmpeg.stderr.on("data", (d) => (stderr += d));
    ffmpeg.on("error", (err: NodeJS.ErrnoException) =>
      reject(err.code === "ENOENT" ? new HttpError(415, "ffmpeg was not found. Install ffmpeg or set FFMPEG_PATH.") : err),
    );
    ffmpeg.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg failed: ${stderr.trim().slice(0, 300)}`))));
  });
}

/**
 * Browser recordings (MediaRecorder WebM) have no duration or seek index, so players must read
 * most of the file before they can show the length or seek — slow for a 100 MB video. Remuxing
 * (copying the streams, no re-encoding, ~1-2 s) adds both. Leaves the file as is if it fails.
 */
export async function addSeekIndex(fileName: string) {
  if (path.extname(fileName).toLowerCase() !== ".webm") return false;
  const source = audioPath(fileName);
  const temp = `${source}.indexed.part`;
  try {
    await runFfmpeg(["-i", source, "-c", "copy", "-f", "webm", temp]);
    await rename(/*turbopackIgnore: true*/ temp, source);
    return true;
  } catch (err) {
    await rm(/*turbopackIgnore: true*/ temp, { force: true });
    console.warn(`Could not add a seek index to ${fileName}:`, String(err));
    return false;
  }
}

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
    await runFfmpeg(["-i", audioPath(fileName), "-vn", "-c:a", "libopus", "-b:a", "64k", "-f", "webm", temp]).catch(async (err) => {
      await rm(/*turbopackIgnore: true*/ temp, { force: true });
      throw err instanceof HttpError
        ? new HttpError(415, "This audio format can't be played in the browser, and ffmpeg (needed to convert it) was not found.")
        : err;
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
