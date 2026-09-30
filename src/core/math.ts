// Math in markdown, found the way GitHub finds it, plus the delimiters agents write (see AGENTS.md):
//
//   inline   $E = mc^2$   $`a_{b}`$   \(x^2\)       display   $$ … $$   \[ … \]   ```math
//
// A `$` opens math only with no space right after it, and closes it only with no space right before
// it and no digit right after it, so "$5 and $10" is text. `\$` is a dollar sign. Each opening
// looks ahead at most MAX_TEX characters, and a $ scan stops at the next $, so scanning stays
// linear however many dollar signs a note has. No Node imports: the editor uses this.

/** The longest formula read; longer ones stay text. */
export const MAX_TEX = 4000;

export interface InlineMath {
  /** Where the math ends, delimiters included (from the start of the text scanned). */
  end: number;
  /** The TeX inside the delimiters. */
  tex: string;
  /** Where the TeX starts and ends, from the start of the text scanned. */
  texFrom: number;
  texTo: number;
  display: boolean;
}

const isSpace = (c: string | undefined) => c === undefined || c === " " || c === "\t" || c === "\n" || c === "\r";
const isDigit = (c: string | undefined) => c !== undefined && c >= "0" && c <= "9";

/**
 * Math starting at `at` in `text`, or null. `text[at]` is `$` or `\`. The character before it is
 * the caller's to check (a backslash there escapes it).
 */
export function inlineMathAt(text: string, at: number): InlineMath | null {
  const limit = Math.min(text.length, at + MAX_TEX + 4);
  /**
   * Where `close` is after `from`: not past the limit or a blank line, and not past another
   * `open` (which would start math of its own), so each opening costs only up to the next one.
   */
  const find = (close: string, open: string, from: number) => {
    for (let i = from; i < limit; i++) {
      if (text.startsWith(close, i)) return i;
      if (text.startsWith(open, i) || (text[i] === "\n" && text[i + 1] === "\n")) return -1;
    }
    return -1;
  };
  if (text.startsWith("\\(", at) || text.startsWith("\\[", at)) {
    const close = text.startsWith("\\(", at) ? "\\)" : "\\]";
    const end = find(close, close === "\\)" ? "\\(" : "\\[", at + 2);
    if (end < 0 || end === at + 2) return null;
    return { end: end + 2, tex: text.slice(at + 2, end), texFrom: at + 2, texTo: end, display: close === "\\]" };
  }
  if (text[at] !== "$") return null;
  if (text.startsWith("$`", at)) {
    // $`…`$: GitHub's form for math markdown would otherwise read (underscores, asterisks).
    const end = find("`$", "$`", at + 2);
    if (end < 0 || end === at + 2) return null;
    return { end: end + 2, tex: text.slice(at + 2, end), texFrom: at + 2, texTo: end, display: false };
  }
  if (text.startsWith("$$", at)) {
    const end = find("$$", "$$", at + 2);
    if (end < 0 || !text.slice(at + 2, end).trim()) return null;
    return { end: end + 2, tex: text.slice(at + 2, end).trim(), texFrom: at + 2, texTo: end, display: true };
  }
  if (isSpace(text[at + 1])) return null;
  for (let i = at + 1; i < limit; i++) {
    const c = text[i];
    if (c === "\\") {
      i++; // an escaped character, \$ included, doesn't close
      continue;
    }
    if (c === "\n" && text[i + 1] === "\n") return null; // math doesn't cross a paragraph
    if (c !== "$") continue;
    // The next unescaped $ closes the math, or nothing does: math never holds a bare $, and
    // stopping here keeps every scan short.
    if (text[i + 1] === "$" || isSpace(text[i - 1]) || isDigit(text[i + 1])) return null;
    return { end: i + 1, tex: text.slice(at + 1, i), texFrom: at + 1, texTo: i, display: false };
  }
  return null;
}

/** A block of display math starting on `lines[i]`: `$$` or `\[` on a line of its own (or with math after it) up to its closing line. */
export function blockMathAt(lines: string[], i: number): { endLine: number; tex: string } | null {
  const first = lines[i].trim();
  const open = first.startsWith("$$") ? "$$" : first.startsWith("\\[") ? "\\[" : null;
  if (!open) return null;
  const close = open === "$$" ? "$$" : "\\]";
  const rest = first.slice(2);
  // One line: $$ x $$ (or \[ x \]).
  if (rest.trimEnd().endsWith(close) && rest.trim().length > close.length) {
    return { endLine: i, tex: rest.trimEnd().slice(0, -close.length).trim() };
  }
  if (rest.includes(close)) return null; // text after the closing: inline, not a block
  let size = rest.length;
  for (let j = i + 1; j < lines.length; j++) {
    const t = lines[j].trim();
    if (t.endsWith(close)) {
      const body = [rest, ...lines.slice(i + 1, j), t.slice(0, -close.length)].join("\n").trim();
      return body ? { endLine: j, tex: body } : null;
    }
    size += lines[j].length + 1;
    if (!t || size > MAX_TEX) return null; // a blank line or too much ends the attempt: GitHub wants them together
  }
  return null;
}
