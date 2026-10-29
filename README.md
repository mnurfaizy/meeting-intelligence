# Meeting Intelligence

Record any meeting that runs in a browser tab (Google Meet, Zoom web, Teams…), then get a transcript, an AI summary, and an Assistant you can ask questions about the meeting.

## How it works

1. **Record** — the app asks Chrome to share a tab (`getDisplayMedia`) and captures that tab's audio, mixed with your microphone so your own voice is included.
2. **Transcribe** — when you stop, the whole recording is sent to **AssemblyAI** in one job, with speaker labels and automatic language detection. Because the file is transcribed in one piece, speakers stay consistent from start to finish. Every line has a clickable timestamp.
3. **Summarize** — **Gemini** writes a title and a summary (overview, key points, decisions, action items, open questions).
4. **Ask** — the Assistant tab answers questions using only that meeting's transcript, with timestamps (Gemini).

You can also **Import Recording** to transcribe an existing audio or video file (m4a, mp3, wav, mp4, webm…). The file is sent as-is.

## Where data is stored

| Data | Stored in |
| --- | --- |
| Meetings, transcript lines, summaries, Assistant chats | **Turso** (libSQL) — or a local `local.db` SQLite file when Turso is not configured |
| Audio files and 10-minute backup parts | The browser that recorded/imported them (IndexedDB) |

Audio is also sent to AssemblyAI for transcription, and transcript text to Gemini for the summary and chat.

The database has three tables, easy to query or export with any SQLite tool:

- `meetings` — one row per meeting (title, dates, duration, status, summary)
- `transcript_segments` — one row per transcript line (`meeting_id`, `start_sec`, `speaker`, `text`)
- `chat_messages` — one row per Assistant message (`meeting_id`, `role`, `text`)

Meetings saved by the earlier browser-only version are moved into the database automatically the first time the app is opened.

## Setup

Requirements: Node.js 20+, an AssemblyAI API key and a Gemini API key.

```bash
npm install
cp .env.example .env.local   # then fill in ASSEMBLYAI_API_KEY and GEMINI_API_KEY
npm run dev
```

Open http://localhost:3000 in **Chrome or Edge on desktop**.

## Recording tips

- In the share dialog, choose the **Chrome Tab** that has the meeting and keep **"Also share tab audio"** turned on. Windows and full-screen sharing usually do not carry audio.
- Keep the Meeting Intelligence tab open while recording. Every 10 minutes a backup part is saved in the browser; if the tab closes mid-recording, the meeting is transcribed from those parts when you come back (speaker labels may then differ between parts).
- Clicking Chrome's own **Stop sharing** bar also stops the recording.
- Maximum recording length is 6 hours.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `ASSEMBLYAI_API_KEY` | — | Required. Transcription. |
| `GEMINI_API_KEY` | — | Required. Summary and Assistant chat. |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Gemini model for summary and chat. |
| `TURSO_DATABASE_URL` | `file:local.db` | Turso database URL (`libsql://…`). Empty uses a local SQLite file. |
| `TURSO_AUTH_TOKEN` | — | Turso auth token. |

## Project layout

```
app/page.tsx                 main screen
app/api/transcripts          upload audio -> start an AssemblyAI job
app/api/transcripts/[id]     poll a job, return transcript segments
app/api/summary              transcript -> title + Markdown summary (Gemini)
app/api/chat                 streaming Q&A over one meeting (Gemini)
app/api/meetings             list / create / read / update / delete meetings
lib/server/db.ts             database schema and queries (Turso / libSQL)
lib/store.ts                 browser client for /api/meetings
lib/recorder.ts              tab + mic capture, 10-minute backup parts
lib/pipeline.ts              transcription, summary and chat client
lib/db.ts                    IndexedDB storage for audio
components/                  sidebar, meeting view, recording view
```

## Deploying

Audio is streamed through `/api/transcripts` to AssemblyAI. Vercel limits request bodies to 4.5 MB, which is less than most recordings, so on Vercel the upload needs to go through storage first (planned). Running the app with `npm run build && npm start` on your own machine or server has no such limit.
