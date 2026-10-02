// Block IDs: `[[Note#^id]]` links to one paragraph or list item, and `![[Note#^id]]` embeds it.
// Used by the editor (following and embedding block links, "Copy [[link]] to this paragraph" and the right-click menu) and by
// exports. No Node imports: the web app runs this too.
import { frontmatterLines, headingName, headingText, proseLines } from "./prose.ts";

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/**
 * A block's ID, as Obsidian writes it: ` ^id` at the end of a paragraph or list item (letters,
 * digits and dashes), or `^id` on a line of its own right after a block (a table, a quote).
 * `[[Note#^id]]` links to that block and `![[Note#^id]]` embeds it.
 */
export const BLOCK_ID = /(?:^|[ \t])\^([A-Za-z0-9-]+)[ \t]*$/;
const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s/;

/** A block with an ID: its lines (`from` to `to`, counting from 1, the ID's line included), and the line the ID is on. */
export interface Block {
  id: string;
  from: number;
  to: number;
  line: number;
}

/** Every block in `md` that has an ID, outside code, in order. */
export function blocksOf(md: string): Block[] {
  const lines = md.split("\n").map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l));
  const blank = (n: number) => n < 1 || n > lines.length || !lines[n - 1].trim();
  const out: Block[] = [];
  for (const [line, text] of proseLines(md)) {
    const m = text.match(BLOCK_ID);
    if (!m) continue;
    let from = line;
    let to = line;
    if (text.trim() === `^${m[1]}`) {
      // On its own line: the block just above it (a blank line between is allowed).
      let end = line - 1;
      while (end > 0 && blank(end)) end--;
      if (end < 1) continue;
      from = end;
      while (!blank(from - 1)) from--;
    } else if (LIST_ITEM.test(text)) {
      // A list item: its line, and the lines nested under it.
      const indent = text.match(LIST_ITEM)![1].length;
      while (!blank(to + 1) && (lines[to].match(/^\s*/)![0].length > indent)) to++;
    } else if (!/^#{1,6}\s/.test(text)) {
      // A paragraph: back to the blank line, heading or list item above it.
      while (!blank(from - 1) && !/^#{1,6}\s/.test(lines[from - 2]) && !LIST_ITEM.test(lines[from - 2])) from--;
    }
    out.push({ id: m[1], from, to, line });
  }
  return out;
}

/** The block `id` names (any case), or null. */
export function findBlock(md: string, id: string): Block | null {
  const want = id.replace(/^\^/, "").toLowerCase();
  return blocksOf(md).find((b) => b.id.toLowerCase() === want) ?? null;
}

/**
 * The block line `line` (from 1) is in, for "Copy [[link]] to this paragraph": the block with an ID there,
 * or else where an ID would go. `insert` is the text to add at the end of line `at`, with `{id}` for
 * the ID: ` ^{id}` at the end of a paragraph or list item, or `^{id}` on a line of its own after a
 * table or a quote (an ID on their last line would be read as part of them). Null on a blank line,
 * a heading, code or frontmatter.
 */
export function blockAt(md: string, line: number): { id: string; from: number; to: number } | { id: null; from: number; to: number; at: number; insert: string } | null {
  const lines = md.split("\n").map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l));
  const has = blocksOf(md).find((b) => b.from <= line && line <= b.to);
  if (has) return { id: has.id, from: has.from, to: has.to };
  const prose = new Set(proseLines(md).map(([n]) => n));
  const fm = md.match(FRONTMATTER);
  const body = fm ? fm[0].split("\n").length - (fm[0].endsWith("\n") ? 1 : 0) : 0;
  const plain = (n: number) => n >= 1 && n <= lines.length && n > body && prose.has(n) && !!lines[n - 1].trim() && !/^#{1,6}\s/.test(lines[n - 1]);
  if (!plain(line)) return null;
  // A list item: the item the line is (or is under), and the lines nested under it.
  let item = line;
  while (item > 1 && !LIST_ITEM.test(lines[item - 1]) && plain(item - 1) && /^\s/.test(lines[item - 1])) item--;
  if (LIST_ITEM.test(lines[item - 1])) {
    const indent = lines[item - 1].match(LIST_ITEM)![1].length;
    let end = item;
    while (plain(end + 1) && !LIST_ITEM.test(lines[end]) && lines[end].match(/^\s*/)![0].length > indent) end++;
    return { id: null, from: item, to: end, at: item, insert: " ^{id}" };
  }
  // A paragraph, table or quote: from the blank line, heading or list item above to the one below.
  let from = line;
  let to = line;
  while (plain(from - 1) && !LIST_ITEM.test(lines[from - 2])) from--;
  while (plain(to + 1) && !LIST_ITEM.test(lines[to])) to++;
  const own = /^\s*[|>]/.test(lines[to - 1]);
  return { id: null, from, to, at: to, insert: own ? `\n\n^{id}${to < lines.length && lines[to].trim() ? "\n" : ""}` : " ^{id}" };
}

/** What a link to the line under the cursor points at, and how the editor's menu names it. */
export type LinkTarget =
  | { kind: "heading"; heading: string }
  | { kind: "paragraph" | "list item" | "table" | "quote"; block: NonNullable<ReturnType<typeof blockAt>> };

/**
 * What "Copy [[link]] to this …" links to from line `line` (from 1): a heading (by its words, as
 * `[[Note#Heading]]`), or the paragraph, list item, table or quote it's in (by its ID, as
 * `[[Note#^id]]`, which it may not have yet). Null on a blank line, in code or frontmatter.
 */
export function blockLinkTarget(md: string, line: number): LinkTarget | null {
  if (line <= frontmatterLines(md)) return null;
  const prose = proseLines(md).find(([n]) => n === line);
  const heading = prose?.[1].match(/^#{1,6}[ \t]+(.*)$/);
  if (heading) {
    const words = headingName(headingText(heading[1]));
    return words ? { kind: "heading", heading: words } : null;
  }
  const block = blockAt(md, line);
  if (!block) return null;
  const first = md.split("\n")[block.from - 1] ?? "";
  const kind = LIST_ITEM.test(first) ? "list item" : /^\s*\|/.test(first) ? "table" : /^\s*>/.test(first) ? "quote" : "paragraph";
  return { kind, block };
}

/** A new block ID for `md`: six letters and digits (at least one letter), not one it already uses. */
export function newBlockId(md: string, random = Math.random): string {
  const taken = new Set(blocksOf(md).map((b) => b.id.toLowerCase()));
  let id: string;
  do id = random().toString(36).slice(2, 8);
  while (id.length < 6 || taken.has(id) || !/[a-z]/.test(id));
  return id;
}

/** `[[name]]`, `[[name#anchor]]`, or with `embed` the `![[…]]` that shows it in place. */
export const noteLink = (name: string, anchor?: string, embed = false) => `${embed ? "!" : ""}[[${name}${anchor ? `#${anchor}` : ""}]]`;

/** A block's text, without its ID: what `![[Note#^id]]` shows. */
export function blockText(md: string, block: Block): string {
  const lines = md.split("\n").slice(block.from - 1, block.to);
  const at = block.line - block.from;
  if (at < lines.length) {
    const without = lines[at].replace(BLOCK_ID, "");
    if (without.trim()) lines[at] = without;
    else lines.splice(at, 1);
  }
  return lines.join("\n").replace(/\s+$/, "");
}
