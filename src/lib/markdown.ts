export type Edit = { start: number; end: number; text: string; selStart: number; selEnd: number };

/** Wrap the selection in a marker pair (toggles if already wrapped). */
export function wrapSelection(value: string, start: number, end: number, marker: string): Edit {
  const before = value.slice(Math.max(0, start - marker.length), start);
  const after = value.slice(end, end + marker.length);
  if (before === marker && after === marker) {
    return { start: start - marker.length, end: end + marker.length, text: value.slice(start, end), selStart: start - marker.length, selEnd: end - marker.length };
  }
  const text = marker + value.slice(start, end) + marker;
  return { start, end, text, selStart: start + marker.length, selEnd: end + marker.length };
}

/** Prefix every selected line with `prefix` (or remove it if all lines already have it). */
export function prefixLines(value: string, start: number, end: number, prefix: string): Edit {
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  const nl = value.indexOf("\n", end);
  const lineEnd = nl === -1 ? value.length : nl;
  const lines = value.slice(lineStart, lineEnd).split("\n");
  const all = lines.every((l) => l.startsWith(prefix));
  const text = lines.map((l) => (all ? l.slice(prefix.length) : prefix + l)).join("\n");
  return { start: lineStart, end: lineEnd, text, selStart: lineStart, selEnd: lineStart + text.length };
}

/** Enter inside a list item continues the list; Enter on an empty item ends it. */
export function continueList(value: string, caret: number): Edit | null {
  const lineStart = value.lastIndexOf("\n", caret - 1) + 1;
  const line = value.slice(lineStart, caret);
  const m = line.match(/^(\s*)([-*]|\d+\.)\s(.*)$/);
  if (!m) return null;
  const [, indent, marker, rest] = m;
  if (rest.trim() === "") {
    return { start: lineStart, end: caret, text: "", selStart: lineStart, selEnd: lineStart };
  }
  const next = /\d/.test(marker) ? `${parseInt(marker, 10) + 1}.` : marker;
  const text = `\n${indent}${next} `;
  return { start: caret, end: caret, text, selStart: caret + text.length, selEnd: caret + text.length };
}
