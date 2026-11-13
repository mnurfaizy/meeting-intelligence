import { SESSION_COOKIE, SESSION_DAYS, authEnabled, safeEqual, sessionToken } from "@/lib/auth";

export const runtime = "nodejs";

/** Checks the password and sets the session cookie. */
export async function POST(req: Request) {
  if (!authEnabled()) return Response.json({ ok: true });
  const { password } = (await req.json().catch(() => ({}))) as { password?: string };
  // A small delay on every attempt slows down guessing.
  await new Promise((r) => setTimeout(r, 400));
  if (!password || !safeEqual(password.trim(), process.env.APP_PASSWORD!.trim())) {
    return Response.json({ error: "Wrong password." }, { status: 401 });
  }
  const secure = new URL(req.url).protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
  const cookie = [
    `${SESSION_COOKIE}=${await sessionToken()}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${SESSION_DAYS * 24 * 60 * 60}`,
    secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
  return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json", "Set-Cookie": cookie } });
}

/** Signs out. */
export async function DELETE() {
  return new Response(null, { status: 204, headers: { "Set-Cookie": `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` } });
}
