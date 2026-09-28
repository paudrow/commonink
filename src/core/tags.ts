// Tags: one concept across notes, tasks and assets. `#work/clients/acme` nests with `/`, and a
// filter on `work` matches it and every tag under it. Matching ignores case (the index keeps tags
// lowercased); notes keep whatever form the person typed. No Node imports: the editor uses this too.
import { frontmatterLines, proseLines, withoutCode } from "./prose.ts";

/** One tag found in a line: `from`/`to` are the columns of its text, without the `#`. */
export interface TagHit {
  /** Lowercased, for matching and the index. */
  tag: string;
  /** As written (slashes tidied). */
  display: string;
  from: number;
  to: number;
}
export interface TagSpan extends TagHit {
  /** 1-based. */
  line: number;
  frontmatter: boolean;
}

const SEGMENT = "[\\p{L}\\p{N}_-]+";
const SHAPE = new RegExp(`^${SEGMENT}(?:/${SEGMENT})*$`, "u");
/** `#word` at the start of a line or after whitespace: not `page#section`, `a#b` or `\#escaped`. */
const INLINE = /(?<!\S)#([\p{L}\p{N}_/-]+)/gu;
const HEADING = /^ {0,3}#{1,6}(\s|$)/;

/** A tag as written, tidied ("#Work//Acme/" → "Work/Acme"), or null if it isn't one. Needs a letter, so `#27` isn't a tag. */
export function cleanTag(raw: string): string | null {
  const t = raw.trim().replace(/^#/, "").replace(/\/{2,}/g, "/").replace(/^\/+|\/+$/g, "");
  return SHAPE.test(t) && /\p{L}/u.test(t) ? t : null;
}

/** The form the index keys a tag by, or null if it isn't one. */
export const normalizeTag = (raw: string) => cleanTag(raw)?.toLowerCase() ?? null;

/** Does `tag` fall under `filter` (both normalized)? `work` matches `work` and `work/acme`, not `workshop`. */
export const tagMatches = (tag: string, filter: string) => tag === filter || tag.startsWith(`${filter}/`);

/** The inline `#tags` on one line of prose. Code spans and [[links]] don't count. */
export function tagsInLine(line: string): TagHit[] {
  const masked = withoutCode(line).replace(/\[\[[^\]\n]*\]\]/g, (s) => " ".repeat(s.length));
  const out: TagHit[] = [];
  for (const m of masked.matchAll(INLINE)) {
    const text = m[1].replace(/\/+$/, "");
    const display = cleanTag(text);
    if (!display) continue;
    const from = m.index + 1;
    out.push({ tag: display.toLowerCase(), display, from, to: from + text.length });
  }
  return out;
}

/** Every tag in a note: its frontmatter `tags:` list, then `#tags` in the body (not in headings or code). */
export function scanTags(md: string): TagSpan[] {
  const lines = md.split("\n");
  const fm = frontmatterLines(md);
  const out: TagSpan[] = [];
  for (const item of frontmatterTags(lines, fm)?.items ?? []) {
    const display = cleanTag(item.text);
    if (display) out.push({ tag: display.toLowerCase(), display, line: item.line, from: item.from, to: item.to, frontmatter: true });
  }
  for (const [line, text] of proseLines(md)) {
    if (line <= fm || HEADING.test(text)) continue;
    for (const hit of tagsInLine(text)) out.push({ ...hit, line, frontmatter: false });
  }
  return out;
}

interface FrontmatterTags {
  /** 0-based index of the `tags:` line. */
  at: number;
  /** `tags:` followed by `- item` lines, rather than a list on the same line. */
  block: boolean;
  bracketed: boolean;
  items: Array<{ line: number; from: number; to: number; text: string; raw: string }>;
}

/** The `tags:` field of the frontmatter (the first `fm` lines), with where each item's text sits. */
function frontmatterTags(lines: string[], fm: number): FrontmatterTags | null {
  for (let i = 1; i < fm - 1; i++) {
    const head = lines[i].match(/^tags:[ \t]*/);
    if (!head) continue;
    const value = lines[i].slice(head[0].length).replace(/\s+$/, "");
    const items: FrontmatterTags["items"] = [];
    const add = (line: number, from: number, raw: string) => {
      const lead = raw.length - raw.trimStart().length;
      const trimmed = raw.trim();
      const quote = /^(["']).*\1$/.test(trimmed) ? 1 : 0;
      const hash = trimmed[quote] === "#" ? 1 : 0;
      const start = from + lead + quote + hash;
      const end = from + lead + trimmed.length - quote;
      if (end > start) items.push({ line, from: start, to: end, text: lines[line - 1].slice(start, end), raw: trimmed });
    };
    if (value) {
      const bracketed = /^\[.*\]$/.test(value);
      let at = head[0].length + (bracketed ? 1 : 0);
      for (const part of (bracketed ? value.slice(1, -1) : value).split(",")) {
        add(i + 1, at, part);
        at += part.length + 1;
      }
      return { at: i, block: false, bracketed, items };
    }
    for (let j = i + 1; j < fm - 1; j++) {
      const m = lines[j].match(/^(\s*-\s+)(.*)$/);
      if (!m) break;
      add(j + 1, m[1].length, m[2]);
    }
    return { at: i, block: true, bracketed: false, items };
  }
  return null;
}

/**
 * Rename tag `from` (normalized) to `to` (as it should be written) in a note: the tag and every tag
 * under it, wherever it counts as a tag. Nothing else changes, except that a frontmatter list which
 * ends up naming a tag twice (a merge) keeps only the first.
 */
export function renameTagIn(md: string, from: string, to: string): string {
  const spans = scanTags(md).filter((s) => tagMatches(s.tag, from));
  if (!spans.length) return md;
  const lines = md.split("\n");
  for (const s of spans.reverse()) {
    const rest = (s.display.length === s.tag.length ? s.display : s.tag).slice(from.length);
    const text = lines[s.line - 1];
    lines[s.line - 1] = text.slice(0, s.from) + to + rest + text.slice(s.to);
  }
  const fm = frontmatterTags(lines, frontmatterLines(lines.join("\n")));
  if (fm) {
    const seen = new Set<string>();
    const dupes = fm.items.filter((item) => {
      const tag = normalizeTag(item.text);
      if (!tag) return false;
      if (seen.has(tag)) return true;
      seen.add(tag);
      return false;
    });
    if (dupes.length && fm.block) {
      for (const d of dupes.reverse()) lines.splice(d.line - 1, 1);
    } else if (dupes.length) {
      const kept = fm.items.filter((item) => !dupes.includes(item)).map((item) => item.raw).join(", ");
      lines[fm.at] = lines[fm.at].match(/^tags:[ \t]*/)![0] + (fm.bracketed ? `[${kept}]` : kept);
    }
  }
  return lines.join("\n");
}
