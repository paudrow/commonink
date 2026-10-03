// Find and replace across notes: plain text (not a pattern), any case unless asked, and optionally
// only whole words. Used by Vault.replaceAcross, the app's Replace page, `commonink replace` and
// MCP replace_text. Only prose changes: not frontmatter, code, link targets, URLs or #tags, so a
// rename can't break a link or a path. No Node imports: hosted workspaces run this too.
import { plainOf } from "./mentions.ts";
import { frontmatterLines, proseLines } from "./prose.ts";

export interface ReplaceOptions {
  /** Only where the case matches too. */
  matchCase?: boolean;
  /** Only whole words: no letter or digit right before or after. */
  wholeWord?: boolean;
}

/** One changed line, before and after (line counts from 1). */
export interface ReplacedLine {
  line: number;
  before: string;
  after: string;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const WORD = /[\p{L}\p{N}_]/u;

/** The search for `find`, as the options say. Null for an empty one. */
export function findPattern(find: string, opts: ReplaceOptions = {}): RegExp | null {
  if (!find) return null;
  let src = escape(find);
  if (opts.wholeWord) {
    if (WORD.test(find[0])) src = `(?<![\\p{L}\\p{N}_])${src}`;
    if (WORD.test(find.at(-1)!)) src = `${src}(?![\\p{L}\\p{N}_])`;
  }
  return new RegExp(src, `gu${opts.matchCase ? "" : "i"}`);
}

/**
 * The matches of `re` in `line` that are plain prose: none inside a code span, [[link]], [text](link),
 * bare URL, #tag or @handle. The Replace page marks these same ones in its preview.
 */
export function proseMatches(line: string, re: RegExp): RegExpExecArray[] {
  const plain = plainOf(line);
  return [...line.matchAll(re)].filter((m) => plain.slice(m.index, m.index + m[0].length) === m[0]);
}

/**
 * `md` with every `find` replaced by `replace` (written as it is: no `$1`), how many there were, and
 * the lines that changed. A find that spans lines can't match: search is line by line, like an editor's.
 * Only prose is searched (see proseMatches); frontmatter and code blocks are left as written.
 */
export function replaceIn(md: string, find: string, replace: string, opts: ReplaceOptions = {}): { content: string; count: number; lines: ReplacedLine[] } {
  const re = findPattern(find, opts);
  if (!re || find.includes("\n")) return { content: md, count: 0, lines: [] };
  let count = 0;
  const lines: ReplacedLine[] = [];
  const skip = frontmatterLines(md);
  const prose = new Set(proseLines(md).map(([n]) => n));
  const out = md.split("\n").map((before, i) => {
    if (i < skip || !prose.has(i + 1)) return before;
    let after = "";
    let at = 0;
    for (const m of proseMatches(before, re)) {
      after += before.slice(at, m.index) + replace;
      at = m.index + m[0].length;
      count++;
    }
    after += before.slice(at);
    if (after !== before) lines.push({ line: i + 1, before, after });
    return after;
  });
  return { content: lines.length ? out.join("\n") : md, count, lines };
}
