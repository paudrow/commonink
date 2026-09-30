// Collapsible sections, the GitHub way: a `<details>` block with a `<summary>` line, markdown
// inside, and a closing `</details>`. The file only says whether a section starts open (`<details
// open>`); opening and closing one in the app is how you look at it, not an edit. No Node imports:
// the editor uses this too.
import { proseLines } from "./prose.ts";

export interface Details {
  /** The `<details>` line (0-based); `close` is its `</details>` line. */
  from: number;
  close: number;
  /** The `<summary>` line, or null if the section has none (it's then called "Details"). */
  summaryLine: number | null;
  summary: string;
  /** `<details open>`: starts open. */
  open: boolean;
  /** Sections this one sits inside. */
  depth: number;
  /** Which section this is in the note, for remembering it open or closed: its summary, and which of that name. */
  key: string;
}

const OPEN = /^\s*<details(\s[^>]*)?>/i;
const CLOSE = /<\/details\s*>\s*$/i;
const SUMMARY = /<summary(?:\s[^>]*)?>(.*?)<\/summary\s*>/i;

/**
 * Every closed `<details>` section in a note, outer ones before the ones inside them. One inside
 * code doesn't count, and one never closed isn't a section (yet).
 */
export function detailsIn(md: string): Details[] {
  const lines = md.split("\n").map((l) => l.replace(/\r$/, ""));
  const prose = new Set(proseLines(md).map(([n]) => n - 1));
  const out: Details[] = [];
  const stack: Array<{ from: number; open: boolean }> = [];
  for (let i = 0; i < lines.length; i++) {
    if (!prose.has(i)) continue;
    const line = lines[i];
    const open = line.match(OPEN);
    const closes = CLOSE.test(line);
    if (open && closes) continue; // a whole section on one line stays as it's written
    if (open) stack.push({ from: i, open: /(^|\s)open(\s|=|$)/i.test(open[1] ?? "") });
    if (!closes || !stack.length) continue;
    const s = stack.pop()!;
    // The summary is on the `<details>` line or the next one.
    const summaryLine = [s.from, s.from + 1].find((n) => n < i && SUMMARY.test(lines[n])) ?? null;
    out.push({ from: s.from, close: i, summaryLine, summary: summaryLine === null ? "Details" : stripTags(lines[summaryLine].match(SUMMARY)![1]).trim() || "Details", open: s.open, depth: stack.length, key: "" });
  }
  out.sort((a, b) => a.from - b.from);
  const seen = new Map<string, number>();
  for (const d of out) {
    const n = seen.get(d.summary) ?? 0;
    seen.set(d.summary, n + 1);
    d.key = n ? `${d.summary}#${n + 1}` : d.summary;
  }
  return out;
}

const stripTags = (html: string) => html.replace(/<[^>]*>/g, "");

/**
 * `text` as a collapsible section called `summary`, blank lines around its content so the
 * markdown inside renders (GitHub needs them). With no text, an empty section to write in.
 */
export function wrapInDetails(text: string, summary = "Details"): string {
  const body = text.replace(/^\n+|\n+$/g, "");
  return `<details>\n<summary>${summary}</summary>\n\n${body}\n\n</details>`;
}
