const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** Markers stay in the DOM for source round-trip; `hide` removes them from the visual layout. */
const mk = (s: string, hide = false) => `<span class="mk${hide ? " mk-hide" : ""}">${s}</span>`;

function inline(escaped: string): string {
  return escaped
    .replace(/`([^`]+)`/g, (_, c) => `<code>${mk("`", true)}${c}${mk("`", true)}</code>`)
    .replace(/\*\*([^*]+)\*\*/g, (_, c) => `<strong>${mk("**", true)}${c}${mk("**", true)}</strong>`)
    .replace(/(^|[^\w])_([^_]+)_(?!\w)/g, (_, p, c) => `${p}<em>${mk("_", true)}${c}${mk("_", true)}</em>`);
}

/**
 * Live preview: each line's textContent is exactly the Markdown source (markers included
 * but visually hidden for headings / emphasis / quotes). List markers stay dimmed so the
 * list structure remains obvious.
 */
export function renderLine(line: string): string {
  const e = esc(line);
  let m: RegExpMatchArray | null;
  if ((m = line.match(/^(#{1,3}) (.*)$/))) return `<div class="ln h${m[1].length}">${mk(esc(m[1]) + " ", true)}${inline(esc(m[2]))}</div>`;
  if ((m = line.match(/^(\s*)([-*]|\d+\.) (.*)$/))) return `<div class="ln li">${esc(m[1])}${mk(esc(m[2]) + " ")}${inline(esc(m[3]))}</div>`;
  if ((m = line.match(/^> (.*)$/))) return `<div class="ln bq">${mk("&gt; ", true)}${inline(esc(m[1]))}</div>`;
  return `<div class="ln">${line ? inline(e) : "<br>"}</div>`;
}

export const renderDoc = (value: string) => value.split("\n").map(renderLine).join("");
