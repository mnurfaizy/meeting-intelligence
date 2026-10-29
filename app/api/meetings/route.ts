import { HttpError, errorResponse } from "@/lib/gemini";
import { createMeeting, getMeeting, listMeetings } from "@/lib/server/db";
import type { Meeting } from "@/lib/types";

export const runtime = "nodejs";

export async function GET() {
  try {
    return Response.json(await listMeetings());
  } catch (err) {
    return errorResponse(err);
  }
}

/** Creates a meeting. Idempotent on id, so a retried browser migration does not duplicate rows. */
export async function POST(req: Request) {
  try {
    const meeting = (await req.json()) as Meeting;
    if (!meeting?.id || !meeting.source || !meeting.status) throw new HttpError(400, "Invalid meeting.");
    if (!(await getMeeting(meeting.id))) await createMeeting(meeting);
    return Response.json(await getMeeting(meeting.id));
  } catch (err) {
    return errorResponse(err);
  }
}
