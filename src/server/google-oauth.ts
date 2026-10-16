import crypto from "node:crypto";
import { getPool, withTx } from "./db";
import { HttpError } from "./http-error";
import { clearSessionCookie, readSessionUserId, sessionCookie } from "./auth";

const STATE_COOKIE = "still_oauth";
const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO = "https://openidconnect.googleapis.com/v1/userinfo";

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (s && s.length >= 16) return s;
  if (process.env.NODE_ENV === "production") throw new Error("AUTH_SECRET must be set in production");
  return "dev-only-insecure-secret";
}

const sign = (value: string) => crypto.createHmac("sha256", secret()).update(value).digest("base64url");

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a),
    bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

function googleConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new HttpError(503, "misconfigured", "Google sign-in is not configured");
  }
  return { clientId, clientSecret };
}

/** Public origin used for OAuth redirect_uri. Prefer APP_URL in production. */
export function publicOrigin(req: Request): string {
  const env = process.env.APP_URL?.replace(/\/$/, "");
  if (env) return env;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!host) throw new HttpError(500, "misconfigured", "Cannot determine app URL");
  const proto = req.headers.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > -1 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
}

type OAuthState = { n: string; g?: string; native?: boolean };

const MOBILE_SCHEME = () => process.env.MOBILE_APP_SCHEME?.replace(/\/$/, "") || "app.still.focus";

function encodeState(payload: OAuthState): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body)}`;
}

function decodeState(raw: string): OAuthState | null {
  const [body, sig] = raw.split(".");
  if (!body || !sig || !safeEqual(sign(body), sig)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString());
    if (typeof parsed?.n !== "string" || !parsed.n) return null;
    if (parsed.g != null && typeof parsed.g !== "string") return null;
    if (parsed.native != null && typeof parsed.native !== "boolean") return null;
    return { n: parsed.n, g: parsed.g, native: parsed.native === true };
  } catch {
    return null;
  }
}

/** Short-lived signed handoff so the WebView can mint its session cookie after Custom Tabs OAuth. */
export function createNativeHandoff(userId: string): string {
  const exp = Math.floor(Date.now() / 1000) + 300; // 5 minutes
  const body = Buffer.from(JSON.stringify({ u: userId, exp })).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function readNativeHandoff(token: string): string | null {
  const [body, sig] = token.split(".");
  if (!body || !sig || !safeEqual(sign(body), sig)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString()) as { u?: string; exp?: number };
    if (typeof parsed.u !== "string" || !parsed.u) return null;
    if (typeof parsed.exp !== "number" || parsed.exp * 1000 < Date.now()) return null;
    return parsed.u;
  } catch {
    return null;
  }
}

export function googleConfigured(): boolean {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export type UserProfile = {
  id: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  signedIn: boolean;
};

export async function getProfile(userId: string): Promise<UserProfile> {
  const { rows } = await getPool().query(
    `SELECT id, email, display_name, avatar_url, auth_provider_id
     FROM app_users WHERE id = $1`,
    [userId],
  );
  const r = rows[0];
  if (!r) throw new HttpError(401, "unauthorized", "Not signed in");
  return {
    id: r.id,
    email: r.email,
    displayName: r.display_name,
    avatarUrl: r.avatar_url,
    signedIn: typeof r.auth_provider_id === "string" && r.auth_provider_id.startsWith("google:"),
  };
}

function googleAuthUrl(clientId: string, req: Request, state: string): string {
  const redirectUri = `${publicOrigin(req)}/api/auth/google/callback`;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    access_type: "online",
    prompt: "select_account",
  });
  return `${GOOGLE_AUTH}?${params}`;
}

/** Start Google OAuth: set state cookie and return the authorization URL. */
export function beginGoogleAuth(req: Request): { url: string; setCookie: string } {
  const { clientId } = googleConfig();
  const nonce = crypto.randomBytes(16).toString("base64url");
  const guestId = readSessionUserId(req) ?? undefined;
  const state = encodeState({ n: nonce, g: guestId });
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const setCookie = `${STATE_COOKIE}=${nonce}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${secure}`;
  return { url: googleAuthUrl(clientId, req, state), setCookie };
}

/**
 * Native (Capacitor) OAuth start: build Google URL with guest id embedded in signed state.
 * Custom Tabs don't share the WebView cookie jar, so we skip the state cookie and
 * verify only the signed state on callback.
 */
export function beginNativeGoogleAuth(req: Request, guestId?: string | null): { url: string } {
  const { clientId } = googleConfig();
  const nonce = crypto.randomBytes(16).toString("base64url");
  const g = guestId || readSessionUserId(req) || undefined;
  const state = encodeState({ n: nonce, g, native: true });
  return { url: googleAuthUrl(clientId, req, state) };
}

type GoogleProfile = { sub: string; email?: string; name?: string; picture?: string };

async function exchangeCode(req: Request, code: string): Promise<GoogleProfile> {
  const { clientId, clientSecret } = googleConfig();
  const redirectUri = `${publicOrigin(req)}/api/auth/google/callback`;
  const tokenRes = await fetch(GOOGLE_TOKEN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) {
    console.error("google token exchange failed", await tokenRes.text());
    throw new HttpError(401, "unauthorized", "Google sign-in failed");
  }
  const tokens = (await tokenRes.json()) as { access_token?: string };
  if (!tokens.access_token) throw new HttpError(401, "unauthorized", "Google sign-in failed");

  const infoRes = await fetch(GOOGLE_USERINFO, {
    headers: { authorization: `Bearer ${tokens.access_token}` },
  });
  if (!infoRes.ok) {
    console.error("google userinfo failed", await infoRes.text());
    throw new HttpError(401, "unauthorized", "Google sign-in failed");
  }
  const info = (await infoRes.json()) as GoogleProfile;
  if (!info.sub) throw new HttpError(401, "unauthorized", "Google sign-in failed");
  return info;
}

/**
 * Move guest data onto the Google account, then delete the guest row.
 * Pending tasks from the guest are appended after the target's queue.
 */
async function mergeGuestInto(guestId: string, targetId: string) {
  if (guestId === targetId) return;
  await withTx(async (c) => {
    const guest = await c.query(`SELECT id, auth_provider_id FROM app_users WHERE id = $1 FOR UPDATE`, [guestId]);
    const target = await c.query(`SELECT id FROM app_users WHERE id = $1 FOR UPDATE`, [targetId]);
    if (!guest.rowCount || !target.rowCount) return;
    // Never merge a signed-in account away
    if (guest.rows[0].auth_provider_id) return;

    const { rows: pos } = await c.query(
      `SELECT COALESCE(max(queue_position), -1) AS max FROM tasks WHERE user_id = $1 AND status = 'pending'`,
      [targetId],
    );
    const base = Number(pos[0].max) + 1;
    await c.query(
      `UPDATE tasks SET queue_position = queue_position + $3, user_id = $2
       WHERE user_id = $1 AND status = 'pending'`,
      [guestId, targetId, base],
    );
    await c.query(`UPDATE tasks SET user_id = $2 WHERE user_id = $1`, [guestId, targetId]);
    await c.query(`UPDATE focus_sessions SET user_id = $2 WHERE user_id = $1`, [guestId, targetId]);
    await c.query(`DELETE FROM app_users WHERE id = $1`, [guestId]);
  });
}

/** Finish OAuth: verify state, upsert Google user, merge guest data, set session cookie. */
export async function finishGoogleAuth(
  req: Request,
  code: string | null,
  stateRaw: string | null,
  oauthError: string | null,
): Promise<{ redirectTo: string; setCookies: string[] }> {
  const origin = publicOrigin(req);
  const clearState = `${STATE_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;

  if (oauthError) {
    return { redirectTo: `${origin}/?auth=error`, setCookies: [clearState] };
  }
  if (!code || !stateRaw) {
    return { redirectTo: `${origin}/?auth=error`, setCookies: [clearState] };
  }

  const state = decodeState(stateRaw);
  if (!state) {
    return { redirectTo: `${origin}/?auth=error`, setCookies: [clearState] };
  }
  // Browser OAuth: require matching HttpOnly state cookie. Native: signed state alone
  // (Custom Tabs never see the WebView's cookies).
  if (!state.native) {
    const expectedNonce = readCookie(req, STATE_COOKIE);
    if (!expectedNonce || state.n !== expectedNonce) {
      return { redirectTo: `${origin}/?auth=error`, setCookies: [clearState] };
    }
  }

  const profile = await exchangeCode(req, code);
  const providerId = `google:${profile.sub}`;

  const userId = await withTx(async (c) => {
    const existing = await c.query(
      `SELECT id FROM app_users WHERE auth_provider_id = $1 FOR UPDATE`,
      [providerId],
    );

    if (existing.rows[0]) {
      const id: string = existing.rows[0].id;
      await c.query(
        `UPDATE app_users SET email = COALESCE($2, email), display_name = COALESCE($3, display_name),
           avatar_url = COALESCE($4, avatar_url) WHERE id = $1`,
        [id, profile.email ?? null, profile.name ?? null, profile.picture ?? null],
      );
      return id;
    }

    // Prefer upgrading the current guest session so local work is kept under one account.
    if (state.g) {
      const guest = await c.query(
        `SELECT id, auth_provider_id FROM app_users WHERE id = $1 FOR UPDATE`,
        [state.g],
      );
      if (guest.rows[0] && !guest.rows[0].auth_provider_id) {
        await c.query(
          `UPDATE app_users SET auth_provider_id = $2, email = $3, display_name = $4, avatar_url = $5
           WHERE id = $1`,
          [state.g, providerId, profile.email ?? null, profile.name ?? null, profile.picture ?? null],
        );
        return state.g as string;
      }
    }

    const { rows } = await c.query(
      `INSERT INTO app_users (auth_provider_id, email, display_name, avatar_url)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [providerId, profile.email ?? null, profile.name ?? null, profile.picture ?? null],
    );
    return rows[0].id as string;
  });

  // If the browser still had a different guest cookie than `state.g`, merge that too.
  const cookieGuest = readSessionUserId(req);
  if (cookieGuest && cookieGuest !== userId) {
    await mergeGuestInto(cookieGuest, userId);
  }
  if (state.g && state.g !== userId) {
    await mergeGuestInto(state.g, userId);
  }

  if (state.native) {
    const handoff = createNativeHandoff(userId);
    return {
      redirectTo: `${MOBILE_SCHEME()}://auth?t=${encodeURIComponent(handoff)}`,
      setCookies: [clearState],
    };
  }

  return {
    redirectTo: `${origin}/?auth=ok`,
    setCookies: [sessionCookie(userId), clearState],
  };
}

export function logoutCookies(): string[] {
  return [clearSessionCookie(), `${STATE_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`];
}
