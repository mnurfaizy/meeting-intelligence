import { createTranscript, uploadAudio } from "@/lib/assemblyai";
import { requireSession } from "@/lib/auth";
import { HttpError, errorResponse } from "@/lib/gemini";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Receives the raw audio file and starts an AssemblyAI transcription job. */
export async function POST(req: Request) {
  // This route skips the proxy (it would cut uploads at 10 MB), so it checks the login itself.
  const denied = await requireSession(req);
  if (denied) return denied;
  try {
    if (!req.body) throw new HttpError(400, "No audio received.");
    const uploadUrl = await uploadAudio(req.body);
    const id = await createTranscript(uploadUrl);
    return Response.json({ id });
  } catch (err) {
    return errorResponse(err);
  }
}
