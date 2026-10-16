const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const mk = (s: string) => `<span class="mk">${s}</span>`;

function inline(escaped: string): string {
  return escaped
    .replace(/`([^`]+)`/g, (_, c) => `<code>${mk("`")}${c}${mk("`")}</code>`)
    .replace(/\*\*([^*]+)\*\*/g, (_, c) => `<strong>${mk("**")}${c}${mk("**")}</strong>`)
    .replace(/(^|[^\w])_([^_]+)_(?!\w)/g, (_, p, c) => `${p}<em>${mk("_")}${c}${mk("_")}</em>`);
}

/**
 * Obsidian-style live preview: every line is a block whose text content is exactly the
 * source line (markers stay in the text, just dimmed), so DOM text round-trips to Markdown.
 */
export function renderLine(line: string): string {
  const e = esc(line);
  let m: RegExpMatchArray | null;
  if ((m = line.match(/^(#{1,3}) (.*)$/))) return `<div class="ln h${m[1].length}">${mk(esc(m[1]) + " ")}${inline(esc(m[2]))}</div>`;
  if ((m = line.match(/^(\s*)([-*]|\d+\.) (.*)$/))) return `<div class="ln li">${esc(m[1])}${mk(esc(m[2]) + " ")}${inline(esc(m[3]))}</div>`;
  if ((m = line.match(/^> (.*)$/))) return `<div class="ln bq">${mk("&gt; ")}${inline(esc(m[1]))}</div>`;
  return `<div class="ln">${line ? inline(e) : "<br>"}</div>`;
}

export const renderDoc = (value: string) => value.split("\n").map(renderLine).join("");
