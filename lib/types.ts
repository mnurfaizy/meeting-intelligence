/** A transcript line. `start` is seconds from the beginning of the meeting. */
export type Segment = { start: number; speaker: string; text: string };

export type ChunkStatus = "pending" | "transcribing" | "done" | "error";
export type MeetingStatus = "recording" | "processing" | "ready" | "error";
export type SummaryStatus = "idle" | "generating" | "done" | "error";

export type ChatMessage = { role: "user" | "model"; text: string; at: number };

export interface Meeting {
  id: string;
  title: string;
  /** True once the user renamed the meeting, so AI titles stop overwriting it. */
  titleEdited?: boolean;
  createdAt: number;
  durationMs: number;
  source: "recording" | "import";
  status: MeetingStatus;
  error?: string;
  transcript: Segment[];
  summary?: string;
  summaryStatus: SummaryStatus;
  summaryError?: string;
  chat: ChatMessage[];
}

/** A slice of audio (10 minutes for recordings) that is transcribed on its own. */
export interface Chunk {
  id: string;
  meetingId: string;
  index: number;
  startMs: number;
  durationMs: number;
  blob: Blob;
  mimeType: string;
  status: ChunkStatus;
  segments?: Segment[];
  error?: string;
}

export interface AudioRecord {
  meetingId: string;
  blob: Blob;
  mimeType: string;
}
