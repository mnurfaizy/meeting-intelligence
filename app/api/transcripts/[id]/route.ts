import { getTranscript, toSegments } from "@/lib/assemblyai";
import { errorResponse } from "@/lib/gemini";

export const runtime = "nodejs";

/** Polled by the browser until the transcription job finishes. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const t = await getTranscript(id);
    if (t.status === "error") return Response.json({ status: "error", error: t.error || "Transcription failed." });
    if (t.status !== "completed") return Response.json({ status: t.status });
    return Response.json({
      status: "completed",
      segments: toSegments(t.utterances ?? []),
      durationMs: (t.audio_duration ?? 0) * 1000,
      language: t.language_code,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
