// Unlinked mentions: places a note's name (its title, its file name or an alias) is written as plain
// text in another note, without a [[link]]. The side panel lists them under Backlinks, each with a
// Link button that turns that one place into a link. No Node imports: hosted workspaces run this too.
import { proseLines, withoutCode } from "./prose.ts";

/** One place a name is written as plain text. `from`/`to` are columns in the line (0-based); `line` counts from 1. */
export interface Mention {
  line: number;
  from: number;
  to: number;
  /** The words as written there. */
  text: string;
}

const WORD = /[\p{L}\p{N}_]/u;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The line with what isn't plain prose blanked out, same length: code spans, [[links]], [text](links),
 * bare URLs, #tags and @handles. A name inside any of those isn't an unlinked mention.
 */
function plainOf(line: string): string {
  const blank = (s: string) => " ".repeat(s.length);
  return withoutCode(line)
    .replace(/!?\[\[[^[\]\n]*\]\]/g, blank)
    .replace(/!?\[[^[\]\n]*\]\([^()\s]*\)/g, blank)
    // The scheme is capped at 32 characters: unbounded, a long word with no "://" took quadratic time.
    .replace(/<?[a-z][a-z0-9+.-]{0,31}:\/\/[^\s>]*>?/gi, blank)
    .replace(/[#@][\p{L}\p{N}_/-]+/gu, blank);
}

/**
 * Where any of `names` is written as plain text in `md`: whole words, any case, outside code,
 * links, URLs, tags and frontmatter. Longer names win where they overlap ("Acme Corp" over "Acme").
 */
export function findMentions(md: string, names: string[]): Mention[] {
  const wanted = [...new Set(names.map((n) => n.trim()).filter((n) => n.length >= 3))].sort((a, b) => b.length - a.length);
  if (!wanted.length) return [];
  // Whole words: no letter or digit right before or after (the name's own ends may be punctuation).
  const re = new RegExp(wanted.map((n) => `${WORD.test(n[0]) ? "(?<![\\p{L}\\p{N}_])" : ""}${escape(n)}${WORD.test(n.at(-1)!) ? "(?![\\p{L}\\p{N}_])" : ""}`).join("|"), "giu");
  const body = bodyStart(md);
  const out: Mention[] = [];
  for (const [line, text] of proseLines(md)) {
    if (line <= body) continue;
    const plain = plainOf(text);
    for (const m of plain.matchAll(re)) out.push({ line, from: m.index, to: m.index + m[0].length, text: text.slice(m.index, m.index + m[0].length) });
  }
  return out;
}

/** The last line of the frontmatter (counting from 1), or 0 if there's none. */
function bodyStart(md: string): number {
  if (!/^\uFEFF?---\r?\n/.test(md)) return 0;
  const lines = md.split("\n");
  const end = lines.findIndex((l, i) => i > 0 && /^---\r?$/.test(l));
  return end < 0 ? 0 : end + 1;
}

/**
 * `md` with the mention at `at` turned into a link to `name` (a note's file name): `[[name]]` when
 * it's written the same way, else `[[name|as written]]`. Null when the text there isn't `at.text`
 * any more (the note changed since it was read).
 */
export function linkMentionIn(md: string, at: Mention, name: string): string | null {
  const lines = md.split("\n");
  const line = lines[at.line - 1];
  if (line === undefined || line.slice(at.from, at.to) !== at.text) return null;
  if (!findMentions(md, [at.text]).some((m) => m.line === at.line && m.from === at.from)) return null; // now inside a link or code
  const link = at.text === name ? `[[${name}]]` : `[[${name}|${at.text}]]`;
  lines[at.line - 1] = line.slice(0, at.from) + link + line.slice(at.to);
  return lines.join("\n");
}
