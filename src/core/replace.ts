// Find and replace across notes: plain text (not a pattern), any case unless asked, and optionally
// only whole words. Used by Vault.replaceAcross, the app's Replace page, `commonink replace` and
// MCP replace_text. No Node imports: hosted workspaces run this too.

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
 * `md` with every `find` replaced by `replace` (written as it is: no `$1`), how many there were, and
 * the lines that changed. A find that spans lines can't match: search is line by line, like an editor's.
 */
export function replaceIn(md: string, find: string, replace: string, opts: ReplaceOptions = {}): { content: string; count: number; lines: ReplacedLine[] } {
  const re = findPattern(find, opts);
  if (!re || find.includes("\n")) return { content: md, count: 0, lines: [] };
  let count = 0;
  const lines: ReplacedLine[] = [];
  const out = md.split("\n").map((before, i) => {
    const after = before.replace(re, () => (count++, replace));
    if (after !== before) lines.push({ line: i + 1, before, after });
    return after;
  });
  return { content: lines.length ? out.join("\n") : md, count, lines };
}
