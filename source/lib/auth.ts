/**
 * Single-password protection for when the app is deployed (APP_PASSWORD set). Without
 * APP_PASSWORD — e.g. running on your own laptop — everything stays open.
 *
 * The session cookie holds an HMAC of the password, so changing APP_PASSWORD signs everyone out.
 * Uses Web Crypto so it works in the proxy as well as in route handlers.
 */
export const SESSION_COOKIE = "mi_session";
export const SESSION_DAYS = 30;

export const authEnabled = () => Boolean(process.env.APP_PASSWORD?.trim());

export async function sessionToken() {
  const password = process.env.APP_PASSWORD?.trim() ?? "";
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("meeting-intelligence-session-v1"));
  return Array.from(new Uint8Array(signature), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Login check for routes the proxy skips. The proxy only passes the first 10 MB of a request
 * body on, so routes that receive recordings check the session themselves instead.
 * Returns a 401 response to send back, or null when the request may continue.
 */
export async function requireSession(req: Request) {
  if (!authEnabled()) return null;
  const cookie = req.headers.get("cookie")?.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`))?.[1] ?? "";
  if (cookie && safeEqual(cookie, await sessionToken())) return null;
  return Response.json({ error: "Please sign in again." }, { status: 401 });
}

/** Compares without stopping at the first difference, so timing reveals nothing. */
export function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
