import { MODEL, HttpError, errorResponse, getClient } from "@/lib/gemini";
import type { ChatMessage } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

type Body = { title?: string; transcript?: string; summary?: string; messages?: ChatMessage[] };

export async function POST(req: Request) {
  try {
    const { title, transcript, summary, messages } = (await req.json()) as Body;
    if (!transcript?.trim()) throw new HttpError(400, "This meeting has no transcript yet.");
    if (!messages?.length) throw new HttpError(400, "No question was sent.");

    const ai = getClient();
    const stream = await ai.models.generateContentStream({
      model: MODEL,
      contents: messages.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
      config: {
        temperature: 0.4,
        systemInstruction: `You are the assistant for one recorded meeting${title ? ` titled "${title}"` : ""}.
Answer using only the meeting transcript and summary below.
- Reply in the same language the user writes in.
- When you refer to something said in the meeting, cite its timestamp like [12:34].
- If the answer is not in the transcript, say so plainly instead of guessing.
- Keep answers concise and use Markdown when it helps (lists, bold).

${summary ? `<summary>\n${summary}\n</summary>\n\n` : ""}<transcript>
${transcript}
</transcript>`,
      },
    });

    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            if (chunk.text) controller.enqueue(encoder.encode(chunk.text));
          }
        } catch (err) {
          console.error(err);
          controller.enqueue(encoder.encode(`\n\n_Error: ${err instanceof Error ? err.message : String(err)}_`));
        }
        controller.close();
      },
    });
    return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  } catch (err) {
    return errorResponse(err);
  }
}
