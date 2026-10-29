import { audioSize, deleteAudio, mimeForFile, readAudio, saveAudio } from "@/lib/server/audio";
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

/** Saves the meeting's recording into the audio folder (replacing any previous file). */
export async function PUT(req: Request, ctx: Ctx) {
  try {
    const meeting = await findMeeting(ctx);
    if (!req.body) throw new HttpError(400, "No audio received.");
    const mimeType = req.headers.get("content-type") || "application/octet-stream";
    const originalName = req.headers.get("x-file-name") ? decodeURIComponent(req.headers.get("x-file-name")!) : undefined;
    const fileName = await saveAudio(req.body, { meetingId: meeting.id, createdAt: meeting.createdAt, mimeType, originalName });
    if (meeting.audioFile && meeting.audioFile !== fileName) await deleteAudio(meeting.audioFile);
    await updateMeeting(meeting.id, { audioFile: fileName, audioMime: mimeType });
    return Response.json(await getMeeting(meeting.id));
  } catch (err) {
    return errorResponse(err);
  }
}

/** Streams the recording, with Range support so the audio player can seek. */
export async function GET(req: Request, ctx: Ctx) {
  try {
    const meeting = await findMeeting(ctx);
    if (!meeting.audioFile) throw new HttpError(404, "This meeting has no audio file.");
    const size = await audioSize(meeting.audioFile).catch(() => {
      throw new HttpError(404, "The audio file is missing from the recordings folder.");
    });
    const type = meeting.audioMime?.split(";")[0] || mimeForFile(meeting.audioFile);
    const headers = { "Content-Type": type, "Accept-Ranges": "bytes", "Cache-Control": "no-store" };

    const match = req.headers.get("range")?.match(/bytes=(\d*)-(\d*)/);
    if (match && size > 0) {
      const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
      const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
      if (start >= size || start > end) {
        return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
      }
      return new Response(readAudio(meeting.audioFile, { start, end }), {
        status: 206,
        headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
      });
    }
    return new Response(readAudio(meeting.audioFile), { headers: { ...headers, "Content-Length": String(size) } });
  } catch (err) {
    return errorResponse(err);
  }
}
