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

/** A daily quota will not recover in a few seconds, so retrying only burns time. */
const isDailyQuota = (err: unknown) => /PerDay|per day/i.test(String(err));

/** Network blips, per-minute rate limits and "model overloaded" are worth another try. */
function isTransient(err: unknown) {
  const text = `${String(err)} ${String((err as { cause?: unknown })?.cause ?? "")}`;
  const status = (err as { status?: number })?.status;
  if (isDailyQuota(err)) return false;
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

/** Gemini errors arrive as raw JSON; turn the common ones into something a person can act on. */
function friendlyMessage(err: unknown) {
  const raw = err instanceof Error ? err.message : String(err);
  if (/RESOURCE_EXHAUSTED|"code":\s*429/.test(raw)) {
    // e.g. "Please retry in 4h58m52.08s" -> "4h 58m"
    const [, h, m, s] = raw.match(/retry in (?:(\d+)h)?(?:(\d+)m)?(?:([\d.]+)s)?/i) ?? [];
    const wait = h ? `${h}h ${m ?? 0}m` : m ? `${m} min` : s ? `${Math.ceil(Number(s))} sec` : "";
    const when = wait ? ` Try again in about ${wait}.` : "";
    return isDailyQuota(err)
      ? `Gemini's daily free-tier limit for ${MODEL} has been reached.${when} To keep going now, enable billing for this API key in Google AI Studio, or set GEMINI_MODEL to a different model.`
      : "Gemini is receiving too many requests right now. Please try again in a minute.";
  }
  if (/UNAVAILABLE|overloaded|high demand/i.test(raw)) return "Gemini is overloaded right now. Please try again in a minute.";
  return raw;
}

export function errorResponse(err: unknown) {
  console.error(err);
  const status = err instanceof HttpError ? err.status : ((err as { status?: number })?.status ?? 500);
  return Response.json({ error: friendlyMessage(err) }, { status });
}
