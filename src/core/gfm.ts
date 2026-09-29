// GitHub-flavored markdown the editor and the renderer read the same way: alerts, footnotes and
// heading anchors. No Node imports: the editor uses this too.
import { proseLines } from "./prose.ts";

// ---------------------------------------------------------------- alerts

export type AlertType = "note" | "tip" | "important" | "warning" | "caution";
export const ALERTS: Record<AlertType, string> = { note: "Note", tip: "Tip", important: "Important", warning: "Warning", caution: "Caution" };
/** Obsidian's callout names, as the GitHub alert that looks like them. */
const ALIASES: Record<string, AlertType> = {
  info: "note", abstract: "note", summary: "note", tldr: "note", todo: "note", example: "note", quote: "note", cite: "note",
  hint: "tip", success: "tip", check: "tip", done: "tip",
  question: "important", help: "important", faq: "important",
  attention: "warning",
  danger: "caution", error: "caution", failure: "caution", fail: "caution", missing: "caution", bug: "caution",
};

export interface Alert {
  type: AlertType;
  /** Obsidian's `-` (folded) or `+` (foldable, open); null for a GitHub alert, which doesn't fold. */
  fold: "-" | "+" | null;
  /** The title: what follows the marker, else the type's name. */
  title: string;
}

const MARKER = /^\s{0,3}>\s?\[!([A-Za-z]+)\]([+-])?[ \t]*(.*)$/;

/** The alert a blockquote's first line opens (`> [!NOTE]`, `> [!warning]- Title`), or null. */
export function parseAlert(line: string): Alert | null {
  const m = line.match(MARKER);
  if (!m) return null;
  const name = m[1].toLowerCase();
  const type = (name in ALERTS ? name : ALIASES[name]) as AlertType | undefined;
  if (!type) return null;
  return { type, fold: (m[2] as "-" | "+" | undefined) ?? null, title: m[3].trim() || ALERTS[type] };
}

// ---------------------------------------------------------------- footnotes

export interface Footnotes {
  /** Each definition (`[^id]: text`), in order: its line (0-based), its text and the lines under it. */
  defs: Map<string, { line: number; text: string }>;
  /** Each reference, in order: its line and column range. */
  refs: Array<{ id: string; line: number; from: number; to: number }>;
  /** Footnotes numbered the way GitHub does: by their first reference. */
  number: Map<string, number>;
}

const DEF = /^\[\^([^\]\s[]{1,64})\]:[ \t]+(.*)$/;
const REF = /\[\^([^\]\s[]{1,64})\](?!:)/g;

/** A note's footnotes: definitions, references outside code, and their numbers. */
export function footnotesIn(md: string): Footnotes {
  const defs = new Map<string, { line: number; text: string }>();
  const refs: Footnotes["refs"] = [];
  const number = new Map<string, number>();
  for (const [n, text] of proseLines(md)) {
    const d = text.match(DEF);
    if (d && !defs.has(d[1])) defs.set(d[1], { line: n - 1, text: d[2].trim() });
    const body = d ? "" : text.replace(/`[^`]*`/g, (s) => " ".repeat(s.length));
    for (const m of body.matchAll(REF)) {
      refs.push({ id: m[1], line: n - 1, from: m.index, to: m.index + m[0].length });
      if (!number.has(m[1])) number.set(m[1], number.size + 1);
    }
  }
  return { defs, refs, number };
}

// ---------------------------------------------------------------- heading anchors

/** A heading's anchor the way GitHub makes it: lowercase, punctuation dropped, spaces as hyphens. */
export const headingSlug = (text: string) =>
  text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");

/** Does `anchor` (a heading's text, or its GitHub slug, from a link or a URL's #) name this heading? */
export function headingMatches(heading: string, anchor: string): boolean {
  let want = anchor;
  try {
    want = decodeURIComponent(anchor);
  } catch {}
  want = want.trim().toLowerCase();
  return heading.trim().toLowerCase() === want || headingSlug(heading) === headingSlug(want);
}
