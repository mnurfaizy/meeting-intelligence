import type { Segment } from "./types";

const pad = (n: number) => String(n).padStart(2, "0");

/** 75 -> "01:15", 3725 -> "1:02:05" */
export function fmtClock(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
}

/** "01:15" / "1:02:05" / "75" -> seconds */
export function parseClock(value: string) {
  const parts = String(value).trim().split(":").map(Number);
  if (parts.some(Number.isNaN)) return 0;
  return parts.reduce((acc, part) => acc * 60 + part, 0);
}

export function fmtDuration(ms: number) {
  const totalMinutes = Math.round(ms / 60000);
  if (totalMinutes < 1) return `${Math.max(1, Math.round(ms / 1000))} sec`;
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h ? `${h} hr ${m} min` : `${m} min`;
}

export function fmtDateGroup(ts: number) {
  return new Date(ts)
    .toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
    .toUpperCase();
}

export function fmtTime(ts: number) {
  return new Date(ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

export function fmtDateTime(ts: number) {
  return new Date(ts).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function transcriptToText(segments: Segment[]) {
  return segments.map((s) => `[${fmtClock(s.start)}] ${s.speaker}: ${s.text}`).join("\n");
}
