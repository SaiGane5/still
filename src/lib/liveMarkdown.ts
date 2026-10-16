import { decodeCommentBody } from "./noteAnnotations";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Markers stay in the DOM for source round-trip; `hide` removes them from the visual layout. */
const mk = (s: string, hide = false) => `<span class="mk${hide ? " mk-hide" : ""}">${s}</span>`;

function inlineMd(escaped: string): string {
  return escaped
    .replace(/`([^`]+)`/g, (_, c) => `<code>${mk("`", true)}${c}${mk("`", true)}</code>`)
    .replace(/\*\*([^*]+)\*\*/g, (_, c) => `<strong>${mk("**", true)}${c}${mk("**", true)}</strong>`)
    .replace(/(^|[^\w])_([^_]+)_(?!\w)/g, (_, p, c) => `${p}<em>${mk("_", true)}${c}${mk("_", true)}</em>`);
}

function inlineWithComments(line: string): string {
  const escaped = esc(line);
  // Work on escaped string; markers only use safe charset so they survive esc().
  return escaped.replace(/\{\%c:([A-Za-z0-9_-]+):([A-Za-z0-9_-]*)\%\}([\s\S]*?)\{\%\/c\%\}/g, (_, id: string, bodyEnc: string, quote: string) => {
    const body = esc(decodeCommentBody(bodyEnc));
    const open = mk(`{%c:${id}:${bodyEnc}%}`, true);
    const close = mk("{%/c%}", true);
    return `<mark class="note-hl" data-comment-id="${esc(id)}" data-comment="${body}" tabindex="0">${open}${inlineMd(quote)}${close}</mark>`;
  });
}

/**
 * Live preview: each line's textContent is exactly the Markdown source (markers included
 * but visually hidden for headings / emphasis / quotes / comments).
 */
export function renderLine(line: string): string {
  // If this line contains a comment, skip block prefixes so markers stay intact in textContent.
  if (/\{\%c:/.test(line) || /\{\%\/c\%\}/.test(line)) {
    return `<div class="ln">${line ? inlineWithComments(line) : "<br>"}</div>`;
  }

  let m: RegExpMatchArray | null;
  if ((m = line.match(/^(#{1,3}) (.*)$/))) {
    return `<div class="ln h${m[1].length}">${mk(esc(m[1]) + " ", true)}${inlineMd(esc(m[2]))}</div>`;
  }
  if ((m = line.match(/^(\s*)([-*]|\d+\.) (.*)$/))) {
    return `<div class="ln li">${esc(m[1])}${mk(esc(m[2]) + " ")}${inlineMd(esc(m[3]))}</div>`;
  }
  if ((m = line.match(/^> (.*)$/))) {
    return `<div class="ln bq">${mk("&gt; ", true)}${inlineMd(esc(m[1]))}</div>`;
  }
  return `<div class="ln">${line ? inlineMd(esc(line)) : "<br>"}</div>`;
}

export const renderDoc = (value: string) =>
  value.split("\n").map(renderLine).join("") || `<div class="ln"><br></div>`;
