export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Used by Render to check the service is up. */
export function GET() {
  return Response.json({ ok: true });
}
