export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Where recordings are kept. "server" (default): the server's recordings folder (AUDIO_DIR).
 * "device": a folder on the user's own computer, written by the browser — for hosts whose disk
 * is wiped on restart, such as Render's free plan.
 */
export function GET() {
  const storage = process.env.AUDIO_STORAGE?.trim().toLowerCase() === "device" ? "device" : "server";
  return Response.json({ storage });
}
