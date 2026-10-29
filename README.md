# Meeting Intelligence

Record any meeting that runs in a browser tab (Google Meet, Zoom web, Teams…), then get a transcript, an AI summary, and an Assistant you can ask questions about the meeting.

## How it works

1. **Record** — the app asks Chrome to share a tab (`getDisplayMedia`) and captures that tab's audio, mixed with your microphone so your own voice is included.
2. **Transcribe** — the audio is cut into 10-minute parts. Each part is sent to Gemini as soon as it is finished, so most of the transcript is ready by the time you press Stop. Speakers are labelled, and every line has a clickable timestamp.
3. **Summarize** — once the transcript is complete, Gemini writes a title and a summary (overview, key points, decisions, action items, open questions).
4. **Ask** — the Assistant tab answers questions using only that meeting's transcript, with timestamps.

You can also **Import Recording** to transcribe an existing audio or video file.

Meetings, audio and chats are stored in your browser (IndexedDB). Nothing is stored on the server; audio is only sent to Gemini for transcription.

## Setup

Requirements: Node.js 20+ and a Gemini API key (free at https://aistudio.google.com/apikey).

```bash
npm install
cp .env.example .env.local   # then put your key in GEMINI_API_KEY
npm run dev
```

Open http://localhost:3000 in **Chrome or Edge on desktop**.

## Recording tips

- In the share dialog, choose the **Chrome Tab** that has the meeting and keep **"Also share tab audio"** turned on. Windows and full-screen sharing usually do not carry audio.
- Keep the Meeting Intelligence tab open while recording. Closing it loses the audio that has not been saved yet. Finished 10-minute parts are kept and resume transcribing when you come back.
- Clicking Chrome's own **Stop sharing** bar also stops the recording.
- Maximum recording length is 6 hours.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` | — | Required. Used for transcription, summary and chat. |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Gemini model for all three steps. |

## Project layout

```
app/page.tsx              main screen
app/api/transcribe        audio part -> transcript segments (Gemini)
app/api/summary           transcript -> title + Markdown summary
app/api/chat              streaming Q&A over one meeting
lib/recorder.ts           tab + mic capture, 10-minute chunking
lib/pipeline.ts           transcription queue, summary, chat client
lib/db.ts                 IndexedDB storage
components/               sidebar, meeting view, recording view
```

## Deploying

Each recorded 10-minute part is ~2.4 MB, which fits Vercel's 4.5 MB request limit. Large **imported** files are sent to the server in one request, so on Vercel keep imports under ~4 MB, or run the app on a server without that limit.
