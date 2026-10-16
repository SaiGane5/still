import { NextResponse } from "next/server";
import { authenticate } from "@/server/auth";
import { getProfile, googleConfigured } from "@/server/google-oauth";
import { errorResponse } from "@/server/http";
import { ensureSchema } from "@/server/migrate";

/** Current session profile (guest or Google-linked). */
export async function GET(req: Request): Promise<Response> {
  try {
    await ensureSchema();
    const auth = await authenticate(req);
    const user = await getProfile(auth.userId);
    const res = NextResponse.json(
      { user, googleEnabled: googleConfigured() },
      { headers: { "Cache-Control": "no-store" } },
    );
    if (auth.setCookie) res.headers.append("Set-Cookie", auth.setCookie);
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}
