import path from "node:path";
import { linkKey, type NoteKind } from "./paths.ts";
import { proseLines, withoutCode, headingText } from "./prose.ts";
import { safeDecode } from "./uri.ts";

export interface ParsedLink {
  target: string;
  key: string;
  kind: "wikilink" | "embed" | "mdlink";
  line: number;
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
// Note text is hostile, so no pattern here may backtrack across a long line: each scanning class
// leaves out the character that starts the next attempt ("[" for links), which keeps them linear.
const WIKILINK = /(!?)\[\[([^[\]|#\n]+)(#[^[\]|\n]*)?(\|[^[\]\n]*)?\]\]/g;
const MDLINK = /(!?)\[[^[\]\n]*\]\(([^()\s]+)(?:\s+"[^"\n]*")?\)/g;

export function splitFrontmatter(md: string): { data: Record<string, string>; body: string } {
  const m = md.match(FRONTMATTER);
  if (!m) return { data: {}, body: md };
  const data: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([\w-]+):\s*(.*)$/);
    if (kv) data[kv[1]] = kv[2].replace(/^["']|["']$/g, "");
  }
  return { data, body: md.slice(m[0].length) };
}

export function titleOf(content: string, kind: NoteKind, p: string): string {
  const fallback = path.posix.basename(p).replace(/\.(md|markdown|html?)$/i, "");
  if (kind === "md") {
    const { data, body } = splitFrontmatter(content);
    if (data.title) return data.title;
    const h1 = body.match(/^#[ \t]+(.+)$/m);
    return (h1 && headingText(h1[1])) || fallback;
  }
  if (kind === "html") {
    const t = content.match(/<title[^<>]*>([^<]*)<\/title>/i)?.[1] ?? between(content, "<h1", "</h1>");
    return t !== null ? stripTags(t).trim() || fallback : fallback;
  }
  return fallback;
}

/** The inside of the first `<open …>…close` in `html` (case-insensitive), or null. */
function between(html: string, open: string, close: string): string | null {
  const lower = html.toLowerCase();
  const at = lower.indexOf(open);
  const start = at < 0 ? -1 : lower.indexOf(">", at);
  const end = start < 0 ? -1 : lower.indexOf(close, start);
  return end < 0 ? null : html.slice(start + 1, end);
}

/** `html` without its <script> and <style> elements, found with indexOf (a lazy regex is quadratic on unclosed ones). */
function withoutScripts(html: string): string {
  const lower = html.toLowerCase();
  let out = "";
  let at = 0;
  for (;;) {
    const s = lower.indexOf("<script", at);
    const t = lower.indexOf("<style", at);
    const open = s < 0 ? t : t < 0 ? s : Math.min(s, t);
    if (open < 0) return out + html.slice(at);
    const close = lower.indexOf(open === s ? "</script>" : "</style>", open);
    if (close < 0) return out + html.slice(at);
    out += `${html.slice(at, open)} `;
    at = close + (open === s ? 9 : 8);
  }
}

export function stripTags(html: string): string {
  return withoutScripts(html)
    .replace(/<[^<>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ");
}

/** Searchable text for a note (markdown is indexed as-is; HTML is reduced to text). */
export function searchableText(content: string, kind: NoteKind): string {
  return kind === "html" ? stripTags(content) : content;
}

export function extractLinks(md: string): ParsedLink[] {
  const links: ParsedLink[] = [];
  for (const [line, text] of proseLines(md)) {
    const noCode = withoutCode(text);
    for (const m of noCode.matchAll(WIKILINK)) {
      links.push({ target: m[2].trim(), key: linkKey(m[2]), kind: m[1] ? "embed" : "wikilink", line });
    }
    for (const m of noCode.matchAll(MDLINK)) {
      const target = safeDecode(m[2]);
      if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#")) continue;
      links.push({ target, key: linkKey(target), kind: m[1] ? "embed" : "mdlink", line });
    }
  }
  return links;
}

export interface Heading {
  level: number;
  text: string;
  line: number;
}

export function outlineOf(md: string): Heading[] {
  return proseLines(md)
    .map(([line, text]) => {
      const m = text.match(/^(#{1,6})[ \t]+(.+)$/);
      const words = m && headingText(m[2]);
      return words ? { level: m[1].length, text: words, line } : null;
    })
    .filter((h): h is Heading => h !== null);
}
