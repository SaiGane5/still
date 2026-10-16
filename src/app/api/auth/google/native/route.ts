import { NextResponse } from "next/server";
import { authenticate } from "@/server/auth";
import { beginNativeGoogleAuth, googleConfigured } from "@/server/google-oauth";
import { errorResponse } from "@/server/http";
import { ensureSchema } from "@/server/migrate";

/**
 * Capacitor: build a Google OAuth URL with the WebView guest embedded in signed state.
 * The system browser opens that URL; cookies stay in Custom Tabs until the deep-link handoff.
 */
export async function POST(req: Request): Promise<Response> {
  try {
    await ensureSchema();
    if (!googleConfigured()) {
      return NextResponse.json(
        { error: { code: "misconfigured", message: "Google sign-in is not configured" } },
        { status: 503 },
      );
    }
    // Ensure a guest session exists so we can merge tasks after sign-in.
    const auth = await authenticate(req);
    const { url } = beginNativeGoogleAuth(req, auth.userId);
    const res = NextResponse.json({ url });
    if (auth.setCookie) res.headers.append("Set-Cookie", auth.setCookie);
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}
