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
  /** What a "processing" meeting is waiting on, for the UI. */
  phase?: "uploading" | "transcribing";
  /** AssemblyAI job id, kept so a reload resumes polling instead of uploading again. */
  transcriptionJobId?: string;
  /** Recording file name inside the server's AUDIO_DIR folder. */
  audioFile?: string;
  audioMime?: string;
  error?: string;
  transcript: Segment[];
  summary?: string;
  summaryStatus: SummaryStatus;
  summaryError?: string;
  chat: ChatMessage[];
}

/** What the sidebar needs: everything except the transcript and chat, plus chat stats. */
export type MeetingListItem = Omit<Meeting, "transcript" | "chat"> & {
  chatCount: number;
  lastQuestion?: string;
};

/**
 * A 10-minute slice saved while recording. Normally only a safety net: if the tab closes
 * before the full recording is saved, the meeting is transcribed from these instead.
 */
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
