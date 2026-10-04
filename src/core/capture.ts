// Quick capture (#18): what a share from another app (a phone's share sheet) puts in a note, and
// where in the note it goes. The capture screen (web/src/capture.ts) picks the note. No Node imports:
// the web app uses this.
import { findSection } from "./prose.ts";

/** What another app shares: any of a title, some text and a link (images come as files). */
export interface Shared {
  title?: string;
  text?: string;
  url?: string;
}

/** The section captures go in. */
export const CAPTURED = "Captured";

const WEB_LINK = /https?:\/\/[^\s<>]+/;

/**
 * A share as note lines: its title, its text, then its link alone on a line (so it draws as a link
 * card), then `![[name]]` for each image already uploaded, a blank line between each. Phones often
 * put the link in the text too, and send the link again as the title: each shows once.
 */
export function captureBlock(s: Shared, embeds: string[] = []): string[] {
  let text = (s.text ?? "").trim();
  let url = (s.url ?? "").trim();
  if (!url) url = text.match(WEB_LINK)?.[0] ?? "";
  if (url) text = text.split(url).join(" ").replace(/[ \t]+\n/g, "\n").replace(/[ \t]{2,}/g, " ").trim();
  const title = (s.title ?? "").trim();
  const parts: string[][] = [];
  if (title && title !== url && title !== text) parts.push([title]);
  if (text) parts.push(text.split(/\r?\n/));
  if (url) parts.push([url]);
  for (const name of embeds) parts.push([`![[${name}]]`]);
  return parts.flatMap((p, i) => (i ? ["", ...p] : p));
}

/**
 * A note with a capture added at the end of its Captured section, or under a new `## Captured`
 * heading at the end of the note. `line` is where the capture starts (1-based).
 */
export function withCaptured(content: string, block: string[]): { content: string; line: number } {
  let last = content.length;
  while (last > 0 && content[last - 1] === "\n") last--; // a loop: /\n+$/ is quadratic on many blank lines
  const lines = content.slice(0, last).split("\n");
  if (lines.length === 1 && lines[0] === "") lines.pop();
  const { section, end } = findSection(lines, CAPTURED);
  let at: number;
  if (section >= 0) {
    let tail = end;
    while (tail > section + 1 && !lines[tail - 1].trim()) tail--;
    lines.splice(tail, 0, "", ...block); // a blank line after the heading, or between captures
    at = tail + 1;
    const after = tail + 1 + block.length;
    if (after < lines.length && lines[after].trim()) lines.splice(after, 0, ""); // and before the next heading
  } else {
    lines.push(...(lines.length ? [""] : []), `## ${CAPTURED}`, "", ...block);
    at = lines.length - block.length;
  }
  return { content: `${lines.join("\n")}\n`, line: at + 1 };
}

/** What the browser extension (extensions/chrome) saves: a page's readable content, or a selection from one. */
export interface WebCapture {
  title?: string;
  url?: string;
  /** A page: the HTML of its main content. */
  html?: string;
  /** A selection: its text. */
  text?: string;
}

/** The most HTML one capture may bring. */
export const MAX_CAPTURE_HTML = 2_000_000;

const webUrl = (s: string | undefined) => (/^https?:\/\/\S+$/i.test((s ?? "").trim()) ? (s ?? "").trim() : "");

/** A capture's link back to where it came from: `[Title](url)`, or the title alone when there's no web link. */
export function sourceLink(c: WebCapture): string {
  const url = webUrl(c.url);
  const title = (c.title ?? "").replace(/\s+/g, " ").trim();
  if (!url) return title;
  return `[${(title || url).replace(/[[\]\\]/g, "\\$&")}](${url.replace(/[()]/g, (c) => (c === "(" ? "%28" : "%29"))})`;
}

/**
 * A web capture as note lines. A selection is a quote with its source under it; a page is its
 * source, then its content as markdown (`markdown` is what the page's HTML reads as). With `flat`
 * (a capture inside another note's section) the page's headings become bold lines, so they don't
 * end the section.
 */
export function webCaptureBlock(c: WebCapture, markdown = "", flat = false): string[] {
  const source = sourceLink(c);
  const text = (c.text ?? "").trim();
  if (text) return [...text.split(/\r?\n/).map((l) => (l.trim() ? `> ${l}` : ">")), ...(source ? ["", `— ${source}`] : [])];
  const body = markdown.trim();
  let fenced = false;
  const lines = !body ? [] : body.split("\n").map((l) => {
    if (l.startsWith("```")) fenced = !fenced;
    const h = !fenced && flat ? l.match(/^#{1,6}\s+(.*?)\s*#*$/) : null;
    return h ? `**${h[1]}**` : l;
  });
  return [...(source ? [source] : []), ...(source && lines.length ? [""] : []), ...lines];
}
