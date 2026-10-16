import crypto from "node:crypto";
import { getPool } from "./db";
import { HttpError } from "./http-error";

/**
 * AUTHENTICATION INTEGRATION POINT
 *
 * `authenticate()` is the only place that decides who is calling. Every query in
 * tasks.ts / notes.ts is scoped by the `userId` it returns; client-supplied ids are
 * never trusted.
 *
 *  1. If AUTH_JWT_SECRET is set and the request carries `Authorization: Bearer <HS256 JWT>`,
 *     the token is verified and its `sub` claim is mapped to users.external_id.
 *     Swap `verifyJwt` for your IdP's verifier (JWKS / RS256) when integrating a real provider.
 *  2. Otherwise a per-browser guest account is used, identified by an HMAC-signed,
 *     HttpOnly cookie. Each browser gets its own private user, so there is no shared
 *     account and no cross-user visibility. A forged cookie fails signature verification.
 */

const COOKIE = "still_session";
const ONE_YEAR = 60 * 60 * 24 * 365;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (s && s.length >= 16) return s;
  if (process.env.NODE_ENV === "production") throw new Error("AUTH_SECRET must be set in production");
  return "dev-only-insecure-secret";
}

const sign = (value: string) => crypto.createHmac("sha256", secret()).update(value).digest("base64url");

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a), bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > -1 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
}

export function verifyJwt(token: string, key: string): { sub: string } | null {
  const [h, p, s] = token.split(".");
  if (!h || !p || !s) return null;
  try {
    const header = JSON.parse(Buffer.from(h, "base64url").toString());
    if (header.alg !== "HS256") return null;
    const expected = crypto.createHmac("sha256", key).update(`${h}.${p}`).digest("base64url");
    if (!safeEqual(expected, s)) return null;
    const payload = JSON.parse(Buffer.from(p, "base64url").toString());
    if (typeof payload.sub !== "string" || !payload.sub) return null;
    if (typeof payload.exp === "number" && payload.exp * 1000 < Date.now()) return null;
    return { sub: payload.sub };
  } catch {
    return null;
  }
}

export type AuthResult = { userId: string; isNew: boolean; setCookie?: string };

export async function authenticate(req: Request): Promise<AuthResult> {
  const pool = getPool();
  const jwtKey = process.env.AUTH_JWT_SECRET;
  const bearer = req.headers.get("authorization")?.match(/^Bearer (.+)$/i)?.[1];
  if (jwtKey && bearer) {
    const claims = verifyJwt(bearer, jwtKey);
    if (!claims) throw new HttpError(401, "unauthorized", "Invalid or expired token");
    const { rows } = await pool.query(
      `INSERT INTO users (external_id) VALUES ($1)
       ON CONFLICT (external_id) DO UPDATE SET external_id = EXCLUDED.external_id
       RETURNING id, (xmax = 0) AS inserted`,
      [claims.sub],
    );
    return { userId: rows[0].id, isNew: rows[0].inserted };
  }

  const raw = readCookie(req, COOKIE);
  if (raw) {
    const [id, sig] = raw.split(".");
    if (id && sig && UUID_RE.test(id) && safeEqual(sign(id), sig)) {
      const { rowCount } = await pool.query("SELECT 1 FROM users WHERE id = $1", [id]);
      if (rowCount) return { userId: id, isNew: false };
    }
  }
  const { rows } = await pool.query("INSERT INTO users DEFAULT VALUES RETURNING id");
  const id: string = rows[0].id;
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return {
    userId: id,
    isNew: true,
    setCookie: `${COOKIE}=${id}.${sign(id)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${ONE_YEAR}${secure}`,
  };
}

/** Test helper: cookie header value for an existing user id. */
export function sessionCookieFor(userId: string) {
  return `${COOKIE}=${userId}.${sign(userId)}`;
}
