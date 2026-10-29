import { GoogleGenAI } from "@google/genai";

export const MODEL = process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function getClient() {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new HttpError(
      500,
      "GEMINI_API_KEY is not set. Add it to .env.local and restart the dev server.",
    );
  }
  return new GoogleGenAI({ apiKey });
}

/** Network blips, rate limits and "model overloaded" are worth another try. */
function isTransient(err: unknown) {
  const text = `${String(err)} ${String((err as { cause?: unknown })?.cause ?? "")}`;
  const status = (err as { status?: number })?.status;
  return (
    status === 429 ||
    (typeof status === "number" && status >= 500) ||
    /fetch failed|ECONNRESET|ETIMEDOUT|UND_ERR|socket hang up|overloaded|UNAVAILABLE|RESOURCE_EXHAUSTED/i.test(text)
  );
}

export async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i >= attempts || !isTransient(err)) throw err;
      console.warn(`Gemini call failed (attempt ${i}/${attempts}), retrying:`, String(err));
      await new Promise((r) => setTimeout(r, 1500 * 2 ** (i - 1)));
    }
  }
}

export function errorResponse(err: unknown) {
  console.error(err);
  const status = err instanceof HttpError ? err.status : 500;
  const message = err instanceof Error ? err.message : String(err);
  return Response.json({ error: message }, { status });
}
