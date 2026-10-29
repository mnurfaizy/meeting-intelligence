import { HttpError, errorResponse } from "@/lib/gemini";
import { deleteAudio } from "@/lib/server/audio";
import { deleteMeeting, getMeeting, updateMeeting, type MeetingPatch } from "@/lib/server/db";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  try {
    const meeting = await getMeeting((await params).id);
    if (!meeting) throw new HttpError(404, "Meeting not found.");
    return Response.json(meeting);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    await updateMeeting(id, (await req.json()) as MeetingPatch);
    const meeting = await getMeeting(id);
    if (!meeting) throw new HttpError(404, "Meeting not found.");
    return Response.json(meeting);
  } catch (err) {
    return errorResponse(err);
  }
}

/** Deletes the meeting, its transcript and chat, and its file in the recordings folder. */
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const meeting = await getMeeting(id);
    await deleteMeeting(id);
    if (meeting?.audioFile) await deleteAudio(meeting.audioFile);
    if (meeting?.videoFile) await deleteAudio(meeting.videoFile);
    return new Response(null, { status: 204 });
  } catch (err) {
    return errorResponse(err);
  }
}
