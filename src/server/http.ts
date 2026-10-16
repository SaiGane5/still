import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { authenticate } from "./auth";
import { HttpError } from "./http-error";
import { ensureSchema } from "./migrate";
import { seedDemoTasks } from "./seed";

export type Ctx = { userId: string; req: Request; timezone: string };

export function timezoneOf(req: Request): string {
  const tz = req.headers.get("x-timezone") ?? "UTC";
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

const DB_DOWN = new Set(["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "ECONNRESET", "57P01", "57P03", "53300"]);

function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // non-browser clients / same-origin GET
  try {
    return new URL(origin).host === (req.headers.get("host") ?? new URL(req.url).host);
  } catch {
    return false;
  }
}

/** Wraps a route: authentication, CSRF origin check, error mapping, no-store. */
export function route(fn: (ctx: Ctx) => Promise<unknown>) {
  return async (req: Request): Promise<Response> => {
    try {
      if (req.method !== "GET" && !sameOrigin(req)) throw new HttpError(403, "forbidden", "Cross-origin request blocked");
      await ensureSchema();
      const auth = await authenticate(req);
      if (auth.isNew && process.env.STILL_SEED_DEMO === "1") await seedDemoTasks(auth.userId);
      const body = await fn({ userId: auth.userId, req, timezone: timezoneOf(req) });
      const res = NextResponse.json(body ?? { ok: true }, { headers: { "Cache-Control": "no-store" } });
      if (auth.setCookie) res.headers.append("Set-Cookie", auth.setCookie);
      return res;
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export function errorResponse(err: unknown): Response {
  const headers = { "Cache-Control": "no-store" };
  if (err instanceof HttpError) {
    return NextResponse.json({ error: { code: err.code, message: err.message, ...err.extra } }, { status: err.status, headers });
  }
  if (err instanceof ZodError) {
    return NextResponse.json(
      { error: { code: "invalid_request", message: err.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ") } },
      { status: 400, headers },
    );
  }
  const code = (err as { code?: string; cause?: { code?: string } })?.code ?? (err as any)?.cause?.code;
  if (code && DB_DOWN.has(code)) {
    return NextResponse.json({ error: { code: "db_unavailable", message: "The database is temporarily unavailable" } }, { status: 503, headers });
  }
  if (err instanceof SyntaxError) {
    return NextResponse.json({ error: { code: "invalid_json", message: "Malformed JSON body" } }, { status: 400, headers });
  }
  const msg = err instanceof Error ? err.message : "";
  if (/^(AUTH_SECRET|DATABASE_URL)\b/.test(msg)) {
    console.error("configuration error:", msg);
    return NextResponse.json({ error: { code: "misconfigured", message: msg } }, { status: 500, headers });
  }
  console.error("unhandled route error", err);
  return NextResponse.json({ error: { code: "internal", message: "Something went wrong" } }, { status: 500, headers });
}

export async function readJson(req: Request): Promise<unknown> {
  const text = await req.text();
  if (text.length > 400_000) throw new HttpError(413, "too_large", "Request body too large");
  return text ? JSON.parse(text) : {};
}
