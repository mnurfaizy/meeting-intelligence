/** Recording file names, shared by the server's recordings folder and the folder on your laptop. */

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

export const MIME_BY_EXT = Object.fromEntries(Object.entries(EXTENSIONS).map(([mime, ext]) => [ext, mime]));

export type MediaKind = "audio" | "video";

export function extensionFor(mimeType: string, originalName?: string) {
  const fromName = originalName?.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase();
  return fromName || EXTENSIONS[mimeType.split(";")[0].trim().toLowerCase()] || "bin";
}

/**
 * e.g. "2026-10-29_1407_3f2a9c1b.webm" and, for screen video, "2026-10-29_1407_3f2a9c1b-video.webm".
 * Sorted by name, the folder is sorted by date.
 */
export function fileNameFor(meetingId: string, createdAt: number, ext: string, kind: MediaKind) {
  const d = new Date(createdAt);
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
  return `${stamp}_${meetingId.slice(0, 8)}${kind === "video" ? "-video" : ""}.${ext}`;
}
