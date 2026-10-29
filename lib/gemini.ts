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

export function errorResponse(err: unknown) {
  console.error(err);
  const status = err instanceof HttpError ? err.status : 500;
  const message = err instanceof Error ? err.message : String(err);
  return Response.json({ error: message }, { status });
}
