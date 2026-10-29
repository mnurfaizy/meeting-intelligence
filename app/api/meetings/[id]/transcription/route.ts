import { createTranscript, uploadAudio } from "@/lib/assemblyai";
import { HttpError, errorResponse } from "@/lib/gemini";
import { readAudio } from "@/lib/server/audio";
import { getMeeting, updateMeeting } from "@/lib/server/db";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Sends the meeting's saved audio file to AssemblyAI and stores the job id. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const meeting = await getMeeting((await params).id);
    if (!meeting) throw new HttpError(404, "Meeting not found.");
    if (!meeting.audioFile) throw new HttpError(400, "This meeting has no audio file.");
    const uploadUrl = await uploadAudio(readAudio(meeting.audioFile));
    const id = await createTranscript(uploadUrl);
    await updateMeeting(meeting.id, { transcriptionJobId: id });
    return Response.json({ id });
  } catch (err) {
    return errorResponse(err);
  }
}
