import { NextResponse } from "next/server";
import { beginGoogleAuth, googleConfigured } from "@/server/google-oauth";
import { errorResponse } from "@/server/http";
import { ensureSchema } from "@/server/migrate";

/** Redirect the browser to Google's OAuth consent screen. */
export async function GET(req: Request): Promise<Response> {
  try {
    await ensureSchema();
    if (!googleConfigured()) {
      return NextResponse.redirect(new URL("/?auth=unavailable", req.url));
    }
    const { url, setCookie } = beginGoogleAuth(req);
    const res = NextResponse.redirect(url);
    res.headers.append("Set-Cookie", setCookie);
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}
