import { buildChatContext } from "@/lib/chatContext";
import { HttpError, errorResponse } from "@/lib/gemini";
import { streamGroqChat } from "@/lib/groq";
import type { ChatMessage } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Input tokens per question. Groq's free plan allows 8K tokens per minute including the answer,
 * so ~3.5K leaves room for a couple of questions a minute. Raise it on a paid plan.
 */
const INPUT_BUDGET = Number(process.env.GROQ_MAX_INPUT_TOKENS) || 3500;

type Body = { title?: string; transcript?: string; summary?: string; messages?: ChatMessage[] };

export async function POST(req: Request) {
  try {
    const { title, transcript, summary, messages } = (await req.json()) as Body;
    if (!transcript?.trim()) throw new HttpError(400, "This meeting has no transcript yet.");
    if (!messages?.length) throw new HttpError(400, "No question was sent.");

    const { system, history } = buildChatContext({ title, summary, transcript, messages, budgetTokens: INPUT_BUDGET });
    const answer = await streamGroqChat([
      { role: "system", content: system },
      ...history.map((m) => ({ role: m.role === "model" ? ("assistant" as const) : ("user" as const), content: m.text })),
    ]);

    // Errors after the answer has started can only be reported inside the text itself.
    const encoder = new TextEncoder();
    const reader = answer.getReader();
    const safe = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) controller.close();
          else controller.enqueue(value);
        } catch (err) {
          console.error(err);
          controller.enqueue(encoder.encode(`\n\n_Error: ${err instanceof Error ? err.message : String(err)}_`));
          controller.close();
        }
      },
    });
    return new Response(safe, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  } catch (err) {
    return errorResponse(err);
  }
}
