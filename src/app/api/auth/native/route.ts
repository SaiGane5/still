import { NextResponse } from "next/server";
import { sessionCookie } from "@/server/auth";
import { publicOrigin, readNativeHandoff } from "@/server/google-oauth";
import { errorResponse } from "@/server/http";
import { ensureSchema } from "@/server/migrate";
import { getPool } from "@/server/db";

/**
 * Capacitor WebView lands here after Custom Tabs OAuth with ?t=<handoff>.
 * Sets the HttpOnly session cookie in the WebView cookie jar, then redirects home.
 */
export async function GET(req: Request): Promise<Response> {
  try {
    await ensureSchema();
    const url = new URL(req.url);
    const token = url.searchParams.get("t");
    const origin = publicOrigin(req);
    if (!token) {
      return NextResponse.redirect(`${origin}/?auth=error`);
    }
    const userId = readNativeHandoff(token);
    if (!userId) {
      return NextResponse.redirect(`${origin}/?auth=error`);
    }
    const { rowCount } = await getPool().query(`SELECT 1 FROM app_users WHERE id = $1`, [userId]);
    if (!rowCount) {
      return NextResponse.redirect(`${origin}/?auth=error`);
    }
    const res = NextResponse.redirect(`${origin}/?auth=ok`);
    res.headers.append("Set-Cookie", sessionCookie(userId));
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}
