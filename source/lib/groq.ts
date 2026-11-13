import { HttpError } from "./gemini";

const BASE = "https://api.groq.com/openai/v1";

/** Groq's flagship production model (not a preview, so it will not be pulled at short notice). */
export const GROQ_MODEL = process.env.GROQ_MODEL?.trim() || "openai/gpt-oss-120b";

/**
 * Room for the model's (hidden) reasoning plus the answer. Kept modest because it counts
 * toward Groq's per-minute token limit (8K on the free plan).
 */
const MAX_COMPLETION_TOKENS = 1200;

export type GroqMessage = { role: "system" | "user" | "assistant"; content: string };

function apiKey() {
  const key = process.env.GROQ_API_KEY?.trim();
  if (!key) throw new HttpError(500, "GROQ_API_KEY is not set. Add it to .env.local and restart the dev server.");
  return key;
}

function describe(status: number, detail: string) {
  if (status === 401) return "Groq rejected the API key. Check GROQ_API_KEY in .env.local.";
  if (status === 413 || /too large|reduce your message/i.test(detail)) {
    return "This question needs more context than your Groq plan allows per minute. Lower GROQ_MAX_INPUT_TOKENS or upgrade the Groq plan.";
  }
  if (status === 429) return "Groq's per-minute limit was reached. Wait a moment and ask again.";
  return `Groq could not answer: ${detail}`;
}

/** Seconds to wait before retrying, from Groq's retry-after header. */
function retryAfter(res: Response) {
  const seconds = Number(res.headers.get("retry-after"));
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 2;
}

/**
 * Starts a streamed chat completion and returns the answer as a plain text stream.
 * Per-minute rate limits are retried (up to ~30 s) before any text has been sent.
 */
export async function streamGroqChat(messages: GroqMessage[]): Promise<ReadableStream<Uint8Array>> {
  let res: Response | null = null;
  for (let attempt = 1; ; attempt++) {
    res = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey()}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages,
        stream: true,
        temperature: 0.4,
        max_completion_tokens: MAX_COMPLETION_TOKENS,
        // Answering from a transcript needs little reasoning; "low" keeps tokens and latency down.
        reasoning_effort: "low",
        include_reasoning: false,
      }),
    });
    if (res.ok) break;
    const wait = retryAfter(res);
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= 3 || wait > 30) {
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      throw new HttpError(res.status, describe(res.status, body.error?.message ?? res.statusText));
    }
    await res.body?.cancel();
    await new Promise((r) => setTimeout(r, wait * 1000));
  }

  // Server-sent events: "data: {json}" lines, ending with "data: [DONE]".
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  const encoder = new TextEncoder();
  let buffer = "";
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      for (;;) {
        const newline = buffer.indexOf("\n");
        if (newline >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (data === "[DONE]") return controller.close();
          const event = JSON.parse(data) as { choices?: { delta?: { content?: string } }[]; error?: { message?: string } };
          if (event.error) throw new Error(event.error.message ?? "Groq stream error");
          // gpt-oss tends to cite as 【12:34】; keep the app's [12:34] style.
          const text = event.choices?.[0]?.delta?.content?.replace(/【/g, "[").replace(/】/g, "]");
          if (text) return controller.enqueue(encoder.encode(text));
          continue;
        }
        const { done, value } = await reader.read();
        if (done) return controller.close();
        buffer += value;
      }
    },
    cancel() {
      void reader.cancel();
    },
  });
}
