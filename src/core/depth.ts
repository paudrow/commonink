// How deep a note's markdown and HTML may nest before rendering, so hostile text can't overflow the
// stack or take time out of proportion to its length. marked recurses once per nested quote, list
// and emphasis, and a DOM's serializer once per element level (browsers stop at about 512 levels,
// jsdom doesn't). Past the caps the rest still reads, at the deepest level (emphasis runs as text).
// Every pass here is one linear scan. No Node imports: the web app uses this.
import { mapOutsideCode, proseLines } from "./prose.ts";

/** Quotes and list items one inside another at the start of a line. */
export const MAX_CONTAINERS = 20;
/** Columns of indentation (a tab counts four); 20 levels of `1. ` lists need 60. */
export const MAX_INDENT = 100;
/** A run of emphasis delimiters (`*`, `_`, `~`) longer than this is text, not emphasis. */
export const MAX_DELIMITERS = 64;
/** HTML elements one inside another. */
export const MAX_HTML_DEPTH = 100;

/** A quote marker or a list marker, and the space after it. */
const CONTAINER = /[ \t]*(?:>|[-*+](?=[ \t]|$)|\d{1,9}[.)](?=[ \t]|$))[ \t]?/y;
/** A line that is only `-`, `*` or `_` (with spaces): a thematic break, however many there are. */
const BREAK = /^[ \t]*([-*_])(?:[ \t]*\1)*[ \t]*$/;

/**
 * `md` with its nesting capped, outside code: at most MAX_CONTAINERS quote and list markers at the
 * start of a line (more are dropped, so the text sits at the deepest level), indentation up to
 * MAX_INDENT columns, and runs of emphasis delimiters over MAX_DELIMITERS escaped, so they read as
 * the characters they are.
 */
export function tameMarkdown(md: string): string {
  const prose = new Set(proseLines(md).map(([n]) => n - 1));
  const lines = md.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!prose.has(i) || BREAK.test(lines[i])) continue;
    lines[i] = capContainers(capIndent(lines[i]));
  }
  return mapOutsideCode(lines.join("\n"), escapeLongRuns);
}

function capIndent(line: string): string {
  let cols = 0;
  let i = 0;
  for (; i < line.length && (line[i] === " " || line[i] === "\t"); i++) cols += line[i] === "\t" ? 4 : 1;
  return cols > MAX_INDENT ? " ".repeat(MAX_INDENT) + line.slice(i) : line;
}

function capContainers(line: string): string {
  let at = 0;
  let kept = 0;
  let count = 0;
  CONTAINER.lastIndex = 0;
  while (CONTAINER.lastIndex < line.length) {
    const start = CONTAINER.lastIndex;
    if (!CONTAINER.exec(line) || CONTAINER.lastIndex === start) break;
    count++;
    at = CONTAINER.lastIndex;
    if (count === MAX_CONTAINERS) kept = at;
  }
  return count > MAX_CONTAINERS ? line.slice(0, kept) + line.slice(at) : line;
}

/** Escape each delimiter in a run too long to be emphasis (a line of them is a thematic break, and stays). */
const escapeLongRuns = (text: string) =>
  text.length <= MAX_DELIMITERS || BREAK.test(text) ? text : text.replace(new RegExp(`[*_~]{${MAX_DELIMITERS + 1},}`, "g"), (run) => run.replace(/[*_~]/g, "\\$&"));

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);

/**
 * `html` with elements nested deeper than `max` dropped: an opening tag past the cap, and the
 * closing tag that matches it, go; what's inside stays, at the deepest level (much as a browser
 * reparents past its own limit of about 512). A closing tag closes the elements opened after its
 * own, as a browser's recovery does (a paragraph's `</p>` closes an unclosed `<kbd>` in it); one
 * with nothing to close is left for the browser. Run before DOMPurify, which still decides what's
 * allowed. One pass: each element is opened and closed once.
 */
export function capHtmlDepth(html: string, max = MAX_HTML_DEPTH): string {
  if (html.split("<", max + 2).length <= max + 1) return html; // too few tags to nest that deep
  const out: string[] = [];
  const open: Array<{ name: string; kept: boolean }> = [];
  const where = new Map<string, number[]>(); // each name's open elements, by place in `open`
  let depth = 0;
  let at = 0;
  const pop = () => {
    const e = open.pop()!;
    where.get(e.name)!.pop();
    if (e.kept) depth--;
    return e;
  };
  for (const m of html.matchAll(/<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*>/g)) {
    if (!m[2]) continue; // a comment
    const name = m[2].toLowerCase();
    let drop = false;
    if (!m[1]) {
      if (VOID.has(name) || m[0].endsWith("/>")) continue;
      const kept = depth < max;
      if (!where.has(name)) where.set(name, []);
      where.get(name)!.push(open.length);
      open.push({ name, kept });
      if (kept) depth++;
      else drop = true;
    } else {
      const mine = where.get(name);
      if (!mine?.length) continue; // nothing it closes: left as written
      while (open.length - 1 > mine[mine.length - 1]) pop(); // elements it closes on the way
      drop = !pop().kept;
    }
    if (drop) {
      out.push(html.slice(at, m.index));
      at = m.index + m[0].length;
    }
  }
  out.push(html.slice(at));
  return out.join("");
}

/** A footnote's text as a tooltip: its start, up to `max` characters. */
export const clip = (text: string, max = 300) => (text.length > max ? `${text.slice(0, max)}…` : text);
