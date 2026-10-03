// Line-level markdown structure shared by the indexers and the editor (no Node imports, so the web
// app can use it too).

const LIST_ITEM = /^\s*([-*+]|\d+[.)])\s/;

/**
 * Lines outside code, with their 1-based line numbers, each without the `\r` a Windows line ending
 * leaves on it. Code is a fenced block (closed only by a bare fence of the same kind, at least as
 * long) or an indented one: indented four spaces after a blank line, unless it continues a list item.
 */
export function proseLines(md: string): Array<[number, string]> {
  const out: Array<[number, string]> = [];
  let fence: { char: string; len: number } | null = null;
  let indentedCode = false;
  let blankBefore = true;
  let lastProse = "";
  md.split("\n").forEach((raw, i) => {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (fence) {
      const close = line.match(/^\s*(`{3,}|~{3,})\s*$/);
      if (close && close[1][0] === fence.char && close[1].length >= fence.len) fence = null;
      return;
    }
    const open = line.match(/^\s*(`{3,}|~{3,})/);
    if (open) {
      fence = { char: open[1][0], len: open[1].length };
      indentedCode = blankBefore = false;
      return;
    }
    if (!line.trim()) {
      blankBefore = true;
      if (!indentedCode) out.push([i + 1, line]);
      return;
    }
    const indented = /^( {4}|\t)/.test(line);
    indentedCode = indented && (indentedCode || (blankBefore && !LIST_ITEM.test(lastProse) && !/^\s/.test(lastProse)));
    blankBefore = false;
    if (indentedCode) return;
    lastProse = line;
    out.push([i + 1, line]);
  });
  return out;
}

/**
 * `md` with `fn` applied to each stretch of text outside code, line by line. Code (fenced and
 * indented blocks as proseLines finds them, and `code spans`) is left exactly as written.
 */
export function mapOutsideCode(md: string, fn: (text: string) => string): string {
  const prose = new Set(proseLines(md).map(([n]) => n - 1));
  return md
    .split("\n")
    .map((line, i) => {
      if (!prose.has(i)) return line;
      let out = "";
      let at = 0;
      for (const [from, to] of codeSpans(line)) {
        out += fn(line.slice(at, from)) + line.slice(from, to);
        at = to;
      }
      return out + fn(line.slice(at));
    })
    .join("\n");
}

/** A line's code spans as [from, to) ranges: a run of backticks up to the next run of the same length. */
function codeSpans(line: string): Array<[number, number]> {
  const runs = [...line.matchAll(/`+/g)].map((m) => ({ at: m.index, len: m[0].length }));
  const next: Array<number | undefined> = [];
  const seen = new Map<number, number>();
  for (let i = runs.length - 1; i >= 0; i--) {
    next[i] = seen.get(runs[i].len);
    seen.set(runs[i].len, i);
  }
  const spans: Array<[number, number]> = [];
  for (let i = 0; i < runs.length; ) {
    const j = next[i];
    if (j === undefined) {
      i++;
      continue;
    }
    spans.push([runs[i].at, runs[j].at + runs[j].len]);
    i = j + 1;
  }
  return spans;
}

/** The line with `code spans` blanked out, same length, so columns still line up. */
export const withoutCode = (line: string) => line.replace(/`[^`]*`/g, (s) => " ".repeat(s.length));

/** The line with code spans and [[links]] blanked out, for finding words that mean something (tags, people). */
export const withoutCodeOrLinks = (line: string) => withoutCode(line).replace(/\[\[[^[\]\n]*\]\]/g, (s) => " ".repeat(s.length));

/**
 * A heading's name and the `{key=value}` settings it can end with (a board column's `{color=blue}`),
 * or null settings if it has none. Index lookups, not a regex like /[ \t]*\{[^}]*\}$/, which
 * backtracks for seconds on a heading with a long run of spaces.
 */
export function headingSettings(text: string): { name: string; attrs: string | null } {
  if (!text.endsWith("}")) return { name: text, attrs: null };
  const open = text.indexOf("{", text.lastIndexOf("}", text.length - 2) + 1);
  if (open < 0 || text.slice(open).includes("\n")) return { name: text, attrs: null };
  let end = open;
  while (end > 0 && (text[end - 1] === " " || text[end - 1] === "\t")) end--;
  return { name: text.slice(0, end), attrs: text.slice(open + 1, -1) };
}

/** A heading's name without the `{key=value}` settings a heading can end with (see headingSettings). */
export const headingName = (text: string) => headingSettings(text).name;

/** How many lines the frontmatter block takes at the top of a note (0 if it has none). */
export function frontmatterLines(md: string): number {
  const m = md.match(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---(\r?\n|$)/);
  return m ? m[0].replace(/\r?\n$/, "").split("\n").length : 0;
}

/**
 * The words of an ATX heading, given what follows its opening #s: "Plan ##  " → "Plan". A loop,
 * not a regex like /(.+?)\s*#*\s*$/, which takes seconds on a heading with a long run of spaces.
 */
export function headingText(rest: string): string {
  const s = rest.trimEnd();
  let i = s.length;
  while (i > 0 && s[i - 1] === "#") i--;
  return i < s.length && (i === 0 || s[i - 1] === " " || s[i - 1] === "\t") ? s.slice(0, i).trimEnd() : s;
}

/**
 * The section under the first heading called `name` (any level, any case, outside code): its
 * heading's line, and the line the next heading at its level or above starts (or the end). -1 for
 * the heading if there isn't one.
 */
export function findSection(lines: string[], name: string): { section: number; level: number; end: number } {
  const want = name.toLowerCase();
  let fence: string | null = null;
  let section = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i++) {
    const f = lines[i].match(/^\s{0,3}(`{3,}|~{3,})/)?.[1];
    if (f && (!fence || (f[0] === fence[0] && f.length >= fence.length))) fence = fence ? null : f;
    const h = !fence && !f ? lines[i].match(/^(#{1,6})\s+(.*)$/) : null;
    if (!h) continue;
    if (section < 0 && headingText(h[2]).toLowerCase() === want) [section, level] = [i, h[1].length];
    else if (section >= 0 && h[1].length <= level) return { section, level, end: i };
  }
  return { section, level, end: lines.length };
}
