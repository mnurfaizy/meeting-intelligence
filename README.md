# Meeting Intelligence

Record any meeting that runs in a browser tab (Google Meet, Zoom web, Teams…), then get a transcript, an AI summary, and an Assistant you can ask questions about the meeting.

## How it works

1. **Record** — the app asks Chrome to share a tab (`getDisplayMedia`) and captures that tab's audio, mixed with your microphone so your own voice is included.
2. **Transcribe** — when you stop, the whole recording is sent to **AssemblyAI** in one job, with speaker labels and automatic language detection. Because the file is transcribed in one piece, speakers stay consistent from start to finish. Every line has a clickable timestamp.
3. **Summarize** — **Gemini** writes a title and a summary (overview, key points, decisions, action items, open questions).
4. **Ask** — the Assistant tab answers questions using only that meeting's transcript, with timestamps (**Groq**, `openai/gpt-oss-120b`). For long meetings it sends the summary plus the transcript lines most relevant to the question, so it fits Groq's free-plan limit of 8K tokens per minute.

You can also **Import Recording** to transcribe an existing audio or video file (m4a, mp3, wav, mp4, webm…). The file is sent as-is.

## Where data is stored

| Data | Stored in |
| --- | --- |
| Meetings, transcript lines, summaries, Assistant chats | **Turso** (libSQL) — or a local `local.db` SQLite file when Turso is not configured |
| Audio files | Plain files in the **recordings folder** (`AUDIO_DIR`, default `./recordings`), e.g. `2026-10-29_1021_5542c12e.webm` |
| Screen video (optional) | Same folder, e.g. `2026-10-29_1021_5542c12e-video.webm` |
| Playback copies | `recordings/.playback/` — Opus/WebM copies of formats browsers can't play (WMA, AMR, …), made once with ffmpeg; originals are untouched |
| 10-minute backup parts while recording | The browser (IndexedDB), deleted once the full recording is saved |

Recordings are first kept in the browser, then moved into the recordings folder when you stop (or import); if that fails, they stay in the browser and are moved on the next try. Recordings made by the earlier browser-only version are moved into the folder automatically. Deleting a meeting also deletes its audio file.

Audio is also sent to AssemblyAI for transcription; transcript text goes to Gemini for the summary and to Groq for the Assistant.

The database has three tables, easy to query or export with any SQLite tool:

- `meetings` — one row per meeting (title, dates, duration, status, summary)
- `transcript_segments` — one row per transcript line (`meeting_id`, `start_sec`, `speaker`, `text`)
- `chat_messages` — one row per Assistant message (`meeting_id`, `role`, `text`)

Meetings saved by the earlier browser-only version are moved into the database automatically the first time the app is opened.

## Setup

Requirements: Node.js 20+ and API keys for AssemblyAI, Gemini and Groq.

```bash
npm install
cp .env.example .env.local   # then fill in ASSEMBLYAI_API_KEY, GEMINI_API_KEY and GROQ_API_KEY
npm run dev
```

Open http://localhost:3000 in **Chrome or Edge on desktop**.

## Recording tips

- In the share dialog, choose the **Chrome Tab** that has the meeting and keep **"Also share tab audio"** turned on. Windows and full-screen sharing usually do not carry audio.
- Keep the Meeting Intelligence tab open while recording. Every 10 minutes a backup part is saved in the browser; if the tab closes mid-recording, the meeting is transcribed from those parts when you come back (speaker labels may then differ between parts).
- Turn on **Record screen video** to also save the tab's picture (about 450 MB per hour). The meeting then shows a video player, and transcription still uses the small audio-only file.
- Clicking Chrome's own **Stop sharing** bar also stops the recording.
- Maximum recording length is 6 hours.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `ASSEMBLYAI_API_KEY` | — | Required. Transcription. |
| `GEMINI_API_KEY` | — | Required. Meeting summary and title. |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Gemini model for the summary. |
| `GROQ_API_KEY` | — | Required. Assistant chat. |
| `GROQ_MODEL` | `openai/gpt-oss-120b` | Groq model for the Assistant. |
| `GROQ_MAX_INPUT_TOKENS` | `3500` | Context sent per question. Raise on a paid Groq plan to send whole transcripts. |
| `TURSO_DATABASE_URL` | `file:local.db` | Turso database URL (`libsql://…`). Empty uses a local SQLite file. |
| `TURSO_AUTH_TOKEN` | — | Turso auth token. |
| `AUDIO_DIR` | `./recordings` | Folder for recordings. A Google Drive for Desktop folder backs them up automatically. |

## Project layout

```
app/page.tsx                 main screen
app/api/transcripts          upload audio -> start an AssemblyAI job
app/api/transcripts/[id]     poll a job, return transcript segments
app/api/summary              transcript -> title + Markdown summary (Gemini)
app/api/chat                 streaming Q&A over one meeting (Groq)
lib/chatContext.ts           fits summary + relevant transcript lines into the token budget
app/api/meetings             list / create / read / update / delete meetings
app/api/meetings/[id]/audio  save / stream (with seeking) a meeting's audio file
app/api/meetings/[id]/transcription  send the saved audio file to AssemblyAI
lib/server/db.ts             database schema and queries (Turso / libSQL)
lib/server/audio.ts          recordings folder
lib/store.ts                 browser client for /api/meetings
lib/recorder.ts              tab + mic capture, 10-minute backup parts
lib/pipeline.ts              transcription, summary and chat client
lib/db.ts                    IndexedDB storage for audio
components/                  sidebar, meeting view, recording view
```

## Deploying

Audio is streamed through `/api/transcripts` to AssemblyAI. Vercel limits request bodies to 4.5 MB, which is less than most recordings, so on Vercel the upload needs to go through storage first (planned). Running the app with `npm run build && npm start` on your own machine or server has no such limit.
