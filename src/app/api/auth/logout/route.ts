import { NextResponse } from "next/server";
import { logoutCookies } from "@/server/google-oauth";
import { errorResponse } from "@/server/http";

/** Clear the session cookie. Next API call mints a fresh guest. */
export async function POST(req: Request): Promise<Response> {
  try {
    const origin = req.headers.get("origin");
    if (origin) {
      try {
        if (new URL(origin).host !== (req.headers.get("host") ?? new URL(req.url).host)) {
          return NextResponse.json({ error: { code: "forbidden", message: "Cross-origin request blocked" } }, { status: 403 });
        }
      } catch {
        return NextResponse.json({ error: { code: "forbidden", message: "Cross-origin request blocked" } }, { status: 403 });
      }
    }
    const res = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    for (const c of logoutCookies()) res.headers.append("Set-Cookie", c);
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}
