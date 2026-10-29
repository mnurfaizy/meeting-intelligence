import { createClient, type InStatement, type Row } from "@libsql/client";
import type { ChatMessage, Meeting, MeetingListItem, Segment } from "../types";

/**
 * Turso (libSQL) when TURSO_DATABASE_URL is set; otherwise a local SQLite file, so the app
 * runs without an account during development. Same SQL either way.
 */
const client = createClient({
  url: process.env.TURSO_DATABASE_URL?.trim() || "file:local.db",
  authToken: process.env.TURSO_AUTH_TOKEN?.trim() || undefined,
});

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS meetings (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '',
    title_edited INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL,
    status TEXT NOT NULL,
    phase TEXT,
    transcription_job_id TEXT,
    error TEXT,
    summary TEXT,
    summary_status TEXT NOT NULL DEFAULT 'idle',
    summary_error TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS meetings_created_at ON meetings (created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS transcript_segments (
    meeting_id TEXT NOT NULL REFERENCES meetings (id),
    idx INTEGER NOT NULL,
    start_sec REAL NOT NULL,
    speaker TEXT NOT NULL,
    text TEXT NOT NULL,
    PRIMARY KEY (meeting_id, idx)
  )`,
  `CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    meeting_id TEXT NOT NULL REFERENCES meetings (id),
    role TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS chat_messages_meeting ON chat_messages (meeting_id, id)`,
];

let ready: Promise<unknown> | null = null;
function db() {
  ready ??= client.batch(SCHEMA, "write");
  return ready.then(() => client);
}

// ---- Row mapping ------------------------------------------------------------

/** Meeting fields stored as columns, and the column each maps to. */
const COLUMNS = {
  title: "title",
  titleEdited: "title_edited",
  createdAt: "created_at",
  durationMs: "duration_ms",
  source: "source",
  status: "status",
  phase: "phase",
  transcriptionJobId: "transcription_job_id",
  error: "error",
  summary: "summary",
  summaryStatus: "summary_status",
  summaryError: "summary_error",
} as const;

type ColumnField = keyof typeof COLUMNS;

const opt = <T>(v: unknown) => (v === null || v === undefined ? undefined : (v as T));

function toListItem(r: Row): MeetingListItem {
  return {
    id: String(r.id),
    title: String(r.title),
    titleEdited: Boolean(r.title_edited),
    createdAt: Number(r.created_at),
    durationMs: Number(r.duration_ms),
    source: r.source as Meeting["source"],
    status: r.status as Meeting["status"],
    phase: opt(r.phase),
    transcriptionJobId: opt(r.transcription_job_id),
    error: opt(r.error),
    summary: opt(r.summary),
    summaryStatus: r.summary_status as Meeting["summaryStatus"],
    summaryError: opt(r.summary_error),
    chatCount: Number(r.chat_count ?? 0),
    lastQuestion: opt(r.last_question),
  };
}

function toDbValue(field: ColumnField, value: unknown) {
  // A boolean column: missing means false, never NULL.
  if (field === "titleEdited") return value ? 1 : 0;
  if (value === undefined || value === null) return null;
  return value as string | number;
}

function segmentInserts(meetingId: string, segments: Segment[]): InStatement[] {
  return segments.map((s, i) => ({
    sql: "INSERT INTO transcript_segments (meeting_id, idx, start_sec, speaker, text) VALUES (?, ?, ?, ?, ?)",
    args: [meetingId, i, s.start, s.speaker, s.text],
  }));
}

function messageInserts(meetingId: string, messages: ChatMessage[]): InStatement[] {
  return messages.map((m) => ({
    sql: "INSERT INTO chat_messages (meeting_id, role, text, created_at) VALUES (?, ?, ?, ?)",
    args: [meetingId, m.role, m.text, m.at],
  }));
}

// ---- Queries --------------------------------------------------------------

const LIST_SQL = `
  SELECT m.*,
    (SELECT COUNT(*) FROM chat_messages c WHERE c.meeting_id = m.id) AS chat_count,
    (SELECT text FROM chat_messages c WHERE c.meeting_id = m.id AND c.role = 'user' ORDER BY c.id DESC LIMIT 1) AS last_question
  FROM meetings m`;

export async function listMeetings() {
  const { rows } = await (await db()).execute(`${LIST_SQL} ORDER BY m.created_at DESC`);
  return rows.map(toListItem);
}

export async function getMeeting(id: string): Promise<Meeting | null> {
  const c = await db();
  const [meeting, segments, messages] = await c.batch(
    [
      { sql: `${LIST_SQL} WHERE m.id = ?`, args: [id] },
      { sql: "SELECT start_sec, speaker, text FROM transcript_segments WHERE meeting_id = ? ORDER BY idx", args: [id] },
      { sql: "SELECT role, text, created_at FROM chat_messages WHERE meeting_id = ? ORDER BY id", args: [id] },
    ],
    "read",
  );
  if (!meeting.rows[0]) return null;
  const { chatCount: _count, lastQuestion: _last, ...base } = toListItem(meeting.rows[0]);
  return {
    ...base,
    transcript: segments.rows.map((r) => ({ start: Number(r.start_sec), speaker: String(r.speaker), text: String(r.text) })),
    chat: messages.rows.map((r) => ({ role: r.role as ChatMessage["role"], text: String(r.text), at: Number(r.created_at) })),
  };
}

/** Inserts a meeting, including transcript and chat when given (used by the browser migration). */
export async function createMeeting(m: Meeting) {
  const fields = Object.keys(COLUMNS) as ColumnField[];
  await (
    await db()
  ).batch(
    [
      {
        sql: `INSERT INTO meetings (id, updated_at, ${fields.map((f) => COLUMNS[f]).join(", ")})
              VALUES (?, ?, ${fields.map(() => "?").join(", ")})`,
        args: [m.id, Date.now(), ...fields.map((f) => toDbValue(f, m[f]))],
      },
      ...segmentInserts(m.id, m.transcript ?? []),
      ...messageInserts(m.id, m.chat ?? []),
    ],
    "write",
  );
}

export type MeetingPatch = Partial<Pick<Meeting, ColumnField>> & { transcript?: Segment[] };

/** Updates the given fields. `null` clears a field; `transcript` replaces all segments. */
export async function updateMeeting(id: string, patch: MeetingPatch) {
  const fields = (Object.keys(patch) as (keyof MeetingPatch)[]).filter((f): f is ColumnField => f in COLUMNS);
  const statements: InStatement[] = [
    {
      sql: `UPDATE meetings SET updated_at = ?${fields.map((f) => `, ${COLUMNS[f]} = ?`).join("")} WHERE id = ?`,
      args: [Date.now(), ...fields.map((f) => toDbValue(f, patch[f])), id],
    },
  ];
  if (patch.transcript) {
    statements.push({ sql: "DELETE FROM transcript_segments WHERE meeting_id = ?", args: [id] });
    statements.push(...segmentInserts(id, patch.transcript));
  }
  await (await db()).batch(statements, "write");
}

export async function appendMessages(id: string, messages: ChatMessage[]) {
  await (await db()).batch(messageInserts(id, messages), "write");
}

export async function deleteMeeting(id: string) {
  await (
    await db()
  ).batch(
    [
      { sql: "DELETE FROM chat_messages WHERE meeting_id = ?", args: [id] },
      { sql: "DELETE FROM transcript_segments WHERE meeting_id = ?", args: [id] },
      { sql: "DELETE FROM meetings WHERE id = ?", args: [id] },
    ],
    "write",
  );
}
