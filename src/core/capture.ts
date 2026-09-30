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
