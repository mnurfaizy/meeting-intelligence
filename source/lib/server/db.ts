import { createClient, type InStatement, type Row, type TransactionMode } from "@libsql/client";
import type { ChatMessage, Meeting, MeetingListItem, Segment } from "../types";

/**
 * Turso (libSQL) when TURSO_DATABASE_URL is set; otherwise a local SQLite file, so the app
 * runs without an account during development. Same SQL either way.
 */
const raw = createClient({
  url: process.env.TURSO_DATABASE_URL?.trim() || "file:local.db",
  authToken: process.env.TURSO_AUTH_TOKEN?.trim() || undefined,
});

/** True when the connection never opened, so nothing reached the database and a retry cannot double-write. */
/** Walks an error and its causes (fetch wraps the real network error) looking for a match. */
function matches(err: unknown, codes: RegExp, text: RegExp) {
  for (let e: unknown = err, depth = 0; e && depth < 4; e = (e as { cause?: unknown }).cause, depth++) {
    if (codes.test((e as { code?: string }).code ?? "") || text.test(String(e))) return true;
  }
  return false;
}

/** The connection never opened, so nothing reached the database. */
const isConnectError = (err: unknown) => matches(err, /UND_ERR_CONNECT_TIMEOUT|ECONNREFUSED|ENOTFOUND|EAI_AGAIN/, /ConnectTimeoutError/);

/** The connection dropped mid-request; the statement may or may not have been applied. */
const isNetworkError = (err: unknown) =>
  isConnectError(err) ||
  matches(err, /ECONNRESET|ETIMEDOUT|EPIPE|UND_ERR_SOCKET|UND_ERR_HEADERS_TIMEOUT|UND_ERR_BODY_TIMEOUT/, /fetch failed|other side closed|socket hang up/i);

/**
 * Retries brief network failures to Turso. `idempotent` statements (updates, replace-all,
 * insert-if-missing) are also retried after a dropped connection; others only when the
 * connection never opened, so they can never be applied twice.
 */
async function withDbRetry<T>(fn: () => Promise<T>, idempotent: boolean, attempts = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      const retryable = idempotent ? isNetworkError(err) : isConnectError(err);
      if (i >= attempts || !retryable) throw err;
      console.warn(`Database request failed (attempt ${i}/${attempts}), retrying:`, String(err));
      await new Promise((r) => setTimeout(r, 1000 * i));
    }
  }
}

const client = {
  execute: (stmt: InStatement, { idempotent = true } = {}) => withDbRetry(() => raw.execute(stmt), idempotent),
  batch: (stmts: InStatement[], mode?: TransactionMode, { idempotent = true } = {}) =>
    withDbRetry(() => raw.batch(stmts, mode), idempotent),
};

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
    summary_error TEXT,
    audio_file TEXT,
    audio_mime TEXT,
    video_file TEXT,
    video_mime TEXT
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

/** Columns added after the first release; created on databases that predate them. */
const ADDED_COLUMNS: [table: string, column: string, type: string][] = [
  ["meetings", "audio_file", "TEXT"],
  ["meetings", "audio_mime", "TEXT"],
  ["meetings", "video_file", "TEXT"],
  ["meetings", "video_mime", "TEXT"],
];

async function migrate() {
  await client.batch(SCHEMA, "write");
  for (const [table, column, type] of ADDED_COLUMNS) {
    const { rows } = await client.execute(`PRAGMA table_info(${table})`);
    if (!rows.some((r) => r.name === column)) await client.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

let ready: Promise<unknown> | null = null;
function db() {
  ready ??= migrate().catch((err) => {
    ready = null; // let the next request retry
    throw err;
  });
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
  audioFile: "audio_file",
  audioMime: "audio_mime",
  videoFile: "video_file",
  videoMime: "video_mime",
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
    audioFile: opt(r.audio_file),
    audioMime: opt(r.audio_mime),
    videoFile: opt(r.video_file),
    videoMime: opt(r.video_mime),
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
    // Includes plain chat inserts, so only retry when the connection never opened.
    { idempotent: false },
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
  // Plain inserts: retrying after a dropped connection could add the same message twice.
  await (await db()).batch(messageInserts(id, messages), "write", { idempotent: false });
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
