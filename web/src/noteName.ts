// A markdown note's file name follows the `# heading` on its first line (after any frontmatter):
// change the heading and the note is renamed to match (retitle in main.ts). No DOM here, for tests.
import type { Text } from "@codemirror/state";
import { headingText } from "../../src/core/prose.ts";
import { isAgentsNote } from "../../src/core/noteRoles.ts";
import { TEMPLATES } from "../../src/core/templates.ts";

/** The first line after a note's frontmatter, where the heading that names it goes. */
export interface NameLine {
  /** Its line number: one past the last line when the note is only frontmatter. */
  line: number;
  /** Where the line starts. */
  at: number;
  /** The heading's words (maybe ""), or null when the line isn't a `# heading`. */
  text: string | null;
  /** Where its words are: an empty range after "# " when there are none yet. */
  from: number;
  to: number;
  /** The frontmatter has a `title:`, which is the note's title instead (see titleOf in src/core/parse.ts). */
  titled: boolean;
}

export function nameLine(doc: Text): NameLine {
  let line = 1;
  let titled = false;
  if (doc.line(1).text === "---") {
    for (let n = 2; n <= doc.lines; n++) {
      const text = doc.line(n).text;
      if (n > 2 && text === "---") {
        line = n + 1;
        break;
      }
      if (/^title:/.test(text)) titled = true;
    }
    if (line === 1) titled = false; // never closed: not frontmatter
  }
  if (line > doc.lines) return { line, at: doc.length, text: null, from: doc.length, to: doc.length, titled };
  const { from: at, text } = doc.line(line);
  const mark = text.match(/^#(?:[ \t]+|$)/)?.[0];
  if (mark === undefined) return { line, at, text: null, from: at, to: at, titled };
  const words = headingText(text.slice(mark.length));
  return { line, at, text: words, from: at + mark.length, to: at + mark.length + words.length, titled };
}

/** Notes whose names the app relies on: the agents' note, templates and daily notes. A heading doesn't rename them. */
export const fixedName = (path: string) => isAgentsNote(path) || path.startsWith(`${TEMPLATES}/`) || /(^|\/)\d{4}-\d{2}-\d{2}\.md$/i.test(path);

/** A heading as a file name: without the characters a name can't have, at most 120 long. */
export const cleanName = (text: string) =>
  text
    .replace(/[\\/:*?"<>|#^[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120)
    .trim();

/** The name a markdown note's heading gives it, or null if it keeps the one it has. */
export function nameFromHeading(path: string, doc: Text): string | null {
  if (!/\.md$/i.test(path) || fixedName(path)) return null;
  const h = nameLine(doc);
  return h.titled || !h.text ? null : cleanName(h.text) || null;
}

/**
 * Where the note at `path` goes to be called `name`: the same folder, with " 2" (and on) after a name
 * another note has. Null if that's where it is.
 */
export function renamedPath(path: string, name: string, paths: string[]): string | null {
  const dir = path.slice(0, path.lastIndexOf("/") + 1);
  const taken = new Set(paths.filter((p) => p !== path).map((p) => p.toLowerCase()));
  let to = `${dir}${name}.md`;
  for (let i = 2; taken.has(to.toLowerCase()); i++) to = `${dir}${name} ${i}.md`;
  return to === path ? null : to;
}
