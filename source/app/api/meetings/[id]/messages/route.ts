import { HttpError, errorResponse } from "@/lib/gemini";
import { appendMessages } from "@/lib/server/db";
import type { ChatMessage } from "@/lib/types";

export const runtime = "nodejs";

/** Appends Assistant chat messages to a meeting. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { messages } = (await req.json()) as { messages?: ChatMessage[] };
    if (!messages?.length) throw new HttpError(400, "No messages.");
    await appendMessages((await params).id, messages);
    return new Response(null, { status: 204 });
  } catch (err) {
    return errorResponse(err);
  }
}
