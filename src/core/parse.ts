import path from "node:path";
import { linkKey, type NoteKind } from "./paths.ts";
import { decodeTarget, proseLines, withoutCode } from "./prose.ts";

export interface ParsedLink {
  target: string;
  key: string;
  kind: "wikilink" | "embed" | "mdlink";
  line: number;
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const WIKILINK = /(!?)\[\[([^\]|#\n]+)(#[^\]|\n]*)?(\|[^\]\n]*)?\]\]/g;
const MDLINK = /(!?)\[[^\]\n]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

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
    const h1 = body.match(/^#\s+(.+?)\s*#*\s*$/m);
    return h1 ? h1[1] : fallback;
  }
  if (kind === "html") {
    const t = content.match(/<title[^>]*>([^<]*)<\/title>/i) ?? content.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    return t ? stripTags(t[1]).trim() || fallback : fallback;
  }
  return fallback;
}

export function stripTags(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
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
      const target = decodeTarget(m[2]);
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
      const m = text.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
      return m ? { level: m[1].length, text: m[2], line } : null;
    })
    .filter((h): h is Heading => h !== null);
}
