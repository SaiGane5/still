import { NextResponse } from "next/server";
import { finishGoogleAuth } from "@/server/google-oauth";
import { errorResponse } from "@/server/http";
import { ensureSchema } from "@/server/migrate";

/** Google redirects here with ?code=&state= after consent. */
export async function GET(req: Request): Promise<Response> {
  try {
    await ensureSchema();
    const url = new URL(req.url);
    const { redirectTo, setCookies } = await finishGoogleAuth(
      req,
      url.searchParams.get("code"),
      url.searchParams.get("state"),
      url.searchParams.get("error"),
    );
    const res = NextResponse.redirect(redirectTo);
    for (const c of setCookies) res.headers.append("Set-Cookie", c);
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}
