/**
 * Inline note comments, embedded in markdown source as hidden markers:
 *   {%c:id:base64urlBody%}highlighted text{%/c%}
 * Markers round-trip through textContent; liveMarkdown hides them visually.
 */

export type NoteComment = {
  id: string;
  body: string;
  quote: string;
  start: number; // index in raw source (inclusive)
  end: number; // exclusive, after closing marker
  quoteStart: number;
  quoteEnd: number;
};

const OPEN_RE = /\{\%c:([A-Za-z0-9_-]+):([A-Za-z0-9_-]*)\%\}/g;
const CLOSE = "{%/c%}";

export function encodeCommentBody(body: string): string {
  try {
    return btoa(unescape(encodeURIComponent(body)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
  } catch {
    return "";
  }
}

export function decodeCommentBody(encoded: string): string {
  try {
    const pad = encoded.length % 4 === 0 ? "" : "=".repeat(4 - (encoded.length % 4));
    const b64 = encoded.replace(/-/g, "+").replace(/_/g, "/") + pad;
    return decodeURIComponent(escape(atob(b64)));
  } catch {
    return "";
  }
}

export function newCommentId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  }
  return Math.random().toString(36).slice(2, 14);
}

export function wrapWithComment(source: string, start: number, end: number, body: string, id = newCommentId()): {
  text: string;
  id: string;
  selStart: number;
  selEnd: number;
} {
  // Keep comments on a single visual line so liveMarkdown round-trips cleanly.
  let s = start;
  let e = end;
  const before = source.lastIndexOf("\n", start - 1);
  const after = source.indexOf("\n", end);
  const lineStart = before + 1;
  const lineEnd = after === -1 ? source.length : after;
  s = Math.max(s, lineStart);
  e = Math.min(e, lineEnd);
  if (e <= s) {
    s = start;
    e = end;
  }

  const quote = source.slice(s, e);
  const open = `{%c:${id}:${encodeCommentBody(body)}%}`;
  const text = source.slice(0, s) + open + quote + CLOSE + source.slice(e);
  const quoteStart = s + open.length;
  return { text, id, selStart: quoteStart, selEnd: quoteStart + quote.length };
}

export function removeComment(source: string, id: string): string {
  const re = new RegExp(
    `\\{\\%c:${id}:[A-Za-z0-9_-]*\\%\\}([\\s\\S]*?)\\{\\%/c\\%\\}`,
    "g",
  );
  return source.replace(re, "$1");
}

export function updateCommentBody(source: string, id: string, body: string): string {
  const re = new RegExp(`\\{\\%c:${id}:[A-Za-z0-9_-]*\\%\\}`, "g");
  return source.replace(re, `{%c:${id}:${encodeCommentBody(body)}%}`);
}

/** Parse all comments and their positions in the raw source. */
export function parseComments(source: string): NoteComment[] {
  const out: NoteComment[] = [];
  let m: RegExpExecArray | null;
  const openRe = new RegExp(OPEN_RE.source, "g");
  while ((m = openRe.exec(source))) {
    const id = m[1];
    const body = decodeCommentBody(m[2] ?? "");
    const openEnd = m.index + m[0].length;
    const closeAt = source.indexOf(CLOSE, openEnd);
    if (closeAt < 0) continue;
    const quote = source.slice(openEnd, closeAt);
    out.push({
      id,
      body,
      quote,
      start: m.index,
      end: closeAt + CLOSE.length,
      quoteStart: openEnd,
      quoteEnd: closeAt,
    });
    openRe.lastIndex = closeAt + CLOSE.length;
  }
  return out;
}

/** Plain text with markers stripped (for AI context). */
export function stripCommentMarkers(source: string): string {
  return source
    .replace(/\{\%c:[A-Za-z0-9_-]+:[A-Za-z0-9_-]*\%\}/g, "")
    .replace(/\{\%\/c\%\}/g, "");
}
