import { audioSize, deleteAudio, mimeForFile, readAudio, saveAudio, type MediaKind } from "@/lib/server/audio";
import { getMeeting, updateMeeting } from "@/lib/server/db";
import { HttpError, errorResponse } from "@/lib/gemini";

export const runtime = "nodejs";
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

async function findMeeting(ctx: Ctx) {
  const meeting = await getMeeting((await ctx.params).id);
  if (!meeting) throw new HttpError(404, "Meeting not found.");
  return meeting;
}

/** `?kind=video` addresses the screen video; anything else the audio recording. */
function kindOf(req: Request): MediaKind {
  return new URL(req.url).searchParams.get("kind") === "video" ? "video" : "audio";
}

const fields = (kind: MediaKind) => (kind === "video" ? ({ file: "videoFile", mime: "videoMime" } as const) : ({ file: "audioFile", mime: "audioMime" } as const));

/** Saves the meeting's recording (or screen video) into the recordings folder, replacing any previous file. */
export async function PUT(req: Request, ctx: Ctx) {
  try {
    const meeting = await findMeeting(ctx);
    if (!req.body) throw new HttpError(400, "No file received.");
    const kind = kindOf(req);
    const { file, mime } = fields(kind);
    const mimeType = req.headers.get("content-type") || "application/octet-stream";
    const originalName = req.headers.get("x-file-name") ? decodeURIComponent(req.headers.get("x-file-name")!) : undefined;
    const fileName = await saveAudio(req.body, { meetingId: meeting.id, createdAt: meeting.createdAt, mimeType, originalName, kind });
    const previous = meeting[file];
    if (previous && previous !== fileName) await deleteAudio(previous);
    await updateMeeting(meeting.id, { [file]: fileName, [mime]: mimeType });
    const saved = await getMeeting(meeting.id);
    if (!saved) {
      // The meeting was deleted while the upload was running: don't leave an orphan file behind.
      await deleteAudio(fileName);
      throw new HttpError(404, "Meeting not found.");
    }
    return Response.json(saved);
  } catch (err) {
    return errorResponse(err);
  }
}

/** Streams the file, with Range support so the player can seek. */
export async function GET(req: Request, ctx: Ctx) {
  try {
    const meeting = await findMeeting(ctx);
    const { file, mime } = fields(kindOf(req));
    const fileName = meeting[file];
    if (!fileName) throw new HttpError(404, "This meeting has no such file.");
    const size = await audioSize(fileName).catch(() => {
      throw new HttpError(404, "The file is missing from the recordings folder.");
    });
    const type = meeting[mime]?.split(";")[0] || mimeForFile(fileName);
    const headers = { "Content-Type": type, "Accept-Ranges": "bytes", "Cache-Control": "no-store" };

    const match = req.headers.get("range")?.match(/bytes=(\d*)-(\d*)/);
    if (match && size > 0) {
      const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
      const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
      if (start >= size || start > end) {
        return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
      }
      return new Response(readAudio(fileName, { start, end }), {
        status: 206,
        headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
      });
    }
    return new Response(readAudio(fileName), { headers: { ...headers, "Content-Length": String(size) } });
  } catch (err) {
    return errorResponse(err);
  }
}
