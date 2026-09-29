// Kanban boards: a `:::kanban` block inside an ordinary note, with notes above and below it.
//
//   :::kanban{done="Shipped"}
//   ## Backlog
//   - [ ] [[Pricing page]] #business
//   - [ ] Draft the announcement @audrow due:2026-10-15
//
//   ## Shipped
//   - [x] [[Landing page]]
//   :::
//
// Inside the block, headings of the first heading level used are columns and list items under
// them are cards, with any lines nested under an item. It stays real markdown, so tasks, links,
// tags and backlinks work in it as anywhere else. The column named by `done=` (by default one
// named "Done") is the done column: a card moved into it is ticked, and one moved out unticked.
//
// Every change is a splice of whole lines, so the rest of the note, its blank lines and a card's
// nested lines stay byte for byte. No Node imports: the editor uses this too.
import { parseAttrs, serializeAttrs } from "./directive.ts";
import { proseLines } from "./prose.ts";
import { editTask, parseTask, TASK_LINE, type TaskPatch } from "./tasks.ts";

export interface Card {
  /** Its list item's line (0-based); `to` is one past its last nested line. */
  from: number;
  to: number;
  /** Null for a list item without a checkbox. */
  checked: boolean | null;
  /** The item's text after the bullet and checkbox, tokens and all. */
  text: string;
  /** The lines nested under it, without their common indent. */
  details: string[];
}
export interface Column {
  title: string;
  /** Its heading's line; `to` is the next column's heading, or the board's closing `:::`. */
  from: number;
  to: number;
  done: boolean;
  cards: Card[];
}
export interface Board {
  /** The `:::kanban` line; `close` is the line of its `:::`. */
  from: number;
  close: number;
  args: Record<string, string>;
  /** The heading level of its columns (2 for `##`). */
  level: number;
  columns: Column[];
}

const OPEN = /^\s*:::kanban(?:\{([^}\n]*)\})?\s*$/i;
const CLOSE = /^\s*:::\s*$/;
const HEADING = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const ITEM = /^( {0,3})([-*+])([ \t]+)(.*)$/;

/** A new board, for the insert menu. */
export const NEW_BOARD = ":::kanban\n## Backlog\n- [ ] Your first card\n\n## Doing\n\n## Done\n:::";

/** Every closed `:::kanban` block in a note, in order. One inside code doesn't count. */
export function boardsIn(md: string): Board[] {
  const lines = md.split("\n").map((l) => l.replace(/\r$/, ""));
  const prose = new Set(proseLines(md).map(([n]) => n - 1));
  const boards: Board[] = [];
  for (let i = 0; i < lines.length; i++) {
    const open = prose.has(i) ? lines[i].match(OPEN) : null;
    if (!open) continue;
    const close = lines.findIndex((l, j) => j > i && prose.has(j) && CLOSE.test(l));
    if (close < 0) break;
    boards.push(readBoard(lines, prose, i, close, parseAttrs(open[1] ?? "")));
    i = close;
  }
  return boards;
}

function readBoard(lines: string[], prose: Set<number>, from: number, close: number, args: Record<string, string>): Board {
  const heads: Array<{ at: number; level: number; title: string }> = [];
  for (let i = from + 1; i < close; i++) {
    const h = prose.has(i) ? lines[i].match(HEADING) : null;
    if (h && h[2]) heads.push({ at: i, level: h[1].length, title: h[2] });
  }
  const level = heads[0]?.level ?? 2;
  const cols = heads.filter((h) => h.level === level);
  const done = (args.done || "Done").trim().toLowerCase();
  const columns = cols.map((h, k) => {
    const to = cols[k + 1]?.at ?? close;
    return { title: h.title, from: h.at, to, done: h.title.trim().toLowerCase() === done, cards: readCards(lines, prose, h.at + 1, to) };
  });
  return { from, close, args, level, columns };
}

/** List items between `from` and `to` that aren't nested in another, each with the lines nested under it. */
function readCards(lines: string[], prose: Set<number>, from: number, to: number): Card[] {
  const cards: Card[] = [];
  let open: { card: Card; indent: number } | null = null;
  for (let i = from; i < to; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const indent = line.match(/^\s*/)![0].length;
    if (open && indent > open.indent) {
      open.card.to = i + 1;
      continue;
    }
    const item = prose.has(i) ? line.match(ITEM) : null;
    open = null;
    if (!item) continue;
    const task = parseTask(line);
    const card: Card = { from: i, to: i + 1, checked: task ? task.done : null, text: task ? task.text : item[4], details: [] };
    cards.push(card);
    open = { card, indent: item[1].length };
  }
  for (const c of cards) c.details = dedent(lines.slice(c.from + 1, c.to));
  return cards;
}

function dedent(lines: string[]): string[] {
  const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => l.match(/^\s*/)![0].length));
  return lines.map((l) => (l.trim() ? l.slice(indent) : ""));
}

// ---------------------------------------------------------------- changes

/** Where a card or column is: a board by its place in the note, then a column by its place on the board (both 0-based). */
export interface Place {
  board: number;
  column: number;
}

/** The note's lines, each still ending in its `\r` if it had one, and what a new line should end in. */
function split(md: string) {
  return { raw: md.split("\n"), cr: md.includes("\r\n") ? "\r" : "" };
}

/** Rewrite one line's text, keeping its `\r`. */
const retext = (line: string, fn: (text: string) => string) => (line.endsWith("\r") ? `${fn(line.slice(0, -1))}\r` : fn(line));

function locate(boards: Board[], line: number) {
  for (const [b, board] of boards.entries()) {
    for (const [c, column] of board.columns.entries()) {
      const card = column.cards.find((k) => k.from === line);
      if (card) return { board, column, card, place: { board: b, column: c } };
    }
  }
  throw new Error(`There's no card on line ${line + 1}`);
}

function columnAt(boards: Board[], at: Place): Column {
  const column = boards[at.board]?.columns[at.column];
  if (!column) throw new Error("That column isn't on the board any more");
  return column;
}

/** The line a card goes on to be `index`th in `column` (0-based; past the end means last), not counting `skip`. */
function slot(raw: string[], column: Column, index: number, skip?: Card): number {
  const cards = column.cards.filter((c) => c !== skip);
  if (index < cards.length) return cards[Math.max(0, index)].from;
  if (cards.length) return cards[cards.length - 1].to;
  let at = column.to;
  while (at > column.from + 1 && !raw[at - 1].trim()) at--;
  return at;
}

/** A card's first line ticked (`done:` stamped with `today`) or unticked. A list item without a checkbox stays as it is. */
const tick = (line: string, checked: boolean, today: string) => retext(line, (t) => editTask(t, { checked, done: checked ? today : null }));

/**
 * Add a card with `text` to a column, `index`th (default last). A text of several lines puts the
 * rest under the card. A card added to the done column starts ticked.
 */
export function addCard(md: string, at: Place, text: string, today: string, index = Infinity): string {
  const { raw, cr } = split(md);
  const column = columnAt(boardsIn(md), at);
  const [first, ...details] = text.replace(/\s+$/, "").split("\n");
  if (!first.trim()) throw new Error("A card needs some text");
  const bullet = raw[column.cards[0]?.from]?.match(/^\s*[-*+][ \t]+/)?.[0].trimStart() ?? "- ";
  let line = `${bullet}[ ] ${first.trim()}`;
  if (column.done) line = editTask(line, { checked: true, done: today });
  const block = [line, ...details.map((d) => (d.trim() ? " ".repeat(bullet.length) + d : ""))].map((l) => l + cr);
  raw.splice(slot(raw, column, index), 0, ...block);
  return raw.join("\n");
}

/**
 * Move the card on `line` (0-based) to be `index`th in a column, on this board or another in the
 * note. Into the done column ticks it; out of it, into another column, unticks it.
 */
export function moveCard(md: string, line: number, to: Place, index: number, today: string): string {
  const { raw } = split(md);
  const boards = boardsIn(md);
  const { column: from, card } = locate(boards, line);
  const dest = columnAt(boards, to);
  const block = raw.slice(card.from, card.to);
  if (card.checked !== null && dest.done !== from.done && card.checked !== dest.done) block[0] = tick(block[0], dest.done, today);
  let at = slot(raw, dest, index, card);
  raw.splice(card.from, block.length);
  if (at > card.from) at -= block.length;
  raw.splice(at, 0, ...block);
  return raw.join("\n");
}

/**
 * Replace the card on `line`'s text. Its first line is the card's (bullet and checkbox kept);
 * any more are the lines nested under it, which keep their bytes if they didn't change.
 */
export function editCard(md: string, line: number, text: string): string {
  const { raw, cr } = split(md);
  const { card } = locate(boardsIn(md), line);
  const [first, ...rest] = text.replace(/\s+$/, "").split("\n");
  const head = raw[card.from].replace(/\r$/, "");
  const prefix = head.match(TASK_LINE) ? head.match(TASK_LINE)!.slice(1, 4).join("") : head.match(ITEM)!.slice(1, 4).join("");
  const block = [retext(raw[card.from], () => prefix + first.trim())];
  const details = dedent(rest);
  if (details.join("\n") === card.details.join("\n")) block.push(...raw.slice(card.from + 1, card.to));
  else {
    const nested = raw.slice(card.from + 1, card.to).find((l) => l.trim());
    const pad = nested ? nested.match(/^\s*/)![0] : " ".repeat(prefix.match(/^\s*[-*+][ \t]+/)![0].length);
    block.push(...details.map((d) => (d ? pad + d : "") + cr));
  }
  raw.splice(card.from, card.to - card.from, ...block);
  return raw.join("\n");
}

/** Tick or untick the card on `line`; `done:` is stamped with `today` or taken off. */
export const checkCard = (md: string, line: number, checked: boolean, today: string) => patchCard(md, line, { checked, done: checked ? today : null });

/** Change the task tokens on the card on `line` (see editTask); the rest of its line stays as written. */
export function patchCard(md: string, line: number, patch: TaskPatch): string {
  const { raw } = split(md);
  const { card } = locate(boardsIn(md), line);
  raw[card.from] = retext(raw[card.from], (t) => editTask(t, patch));
  return raw.join("\n");
}

/** Take the card on `line`, and the lines nested under it, out of the note. */
export function deleteCard(md: string, line: number): string {
  const { raw } = split(md);
  const { card } = locate(boardsIn(md), line);
  raw.splice(card.from, card.to - card.from);
  return raw.join("\n");
}

/** Add an empty column at the end of a board. */
export function addColumn(md: string, board: number, title: string): string {
  const { raw, cr } = split(md);
  const b = boardsIn(md)[board];
  if (!b) throw new Error("That board isn't in the note any more");
  const gap = b.columns.length && raw[b.close - 1].trim() ? [cr] : [];
  raw.splice(b.close, 0, ...gap, `${"#".repeat(b.level)} ${title.trim()}${cr}`);
  return raw.join("\n");
}

/** Rename a column: its heading's text changes, and nothing else. */
export function renameColumn(md: string, at: Place, title: string): string {
  const { raw } = split(md);
  const column = columnAt(boardsIn(md), at);
  raw[column.from] = retext(raw[column.from], (l) => `${l.match(/^ {0,3}#{1,6}[ \t]+/)![0]}${title.trim()}`);
  return raw.join("\n");
}

/**
 * Move a column, with its cards, to be `index`th on its board. The blank lines between columns
 * stay where they are, so the board keeps its spacing.
 */
export function moveColumn(md: string, at: Place, index: number): string {
  const { raw } = split(md);
  const b = boardsIn(md)[at.board];
  if (!b?.columns[at.column]) throw new Error("That column isn't on the board any more");
  const parts = b.columns.map((c) => {
    let end = c.to;
    while (end > c.from + 1 && !raw[end - 1].trim()) end--;
    return { body: raw.slice(c.from, end), gap: raw.slice(end, c.to) };
  });
  const order = parts.map((_, i) => i);
  order.splice(Math.min(Math.max(0, index), order.length - 1), 0, ...order.splice(at.column, 1));
  const columns = order.flatMap((k, i) => [...parts[k].body, ...parts[i].gap]);
  raw.splice(b.columns[0].from, b.close - b.columns[0].from, ...columns);
  return raw.join("\n");
}

/** Rewrite a board's `:::kanban{…}` line with new settings. */
export function setBoardArgs(md: string, board: number, args: Record<string, string>): string {
  const { raw } = split(md);
  const b = boardsIn(md)[board];
  if (!b) throw new Error("That board isn't in the note any more");
  const attrs = serializeAttrs(args);
  raw[b.from] = retext(raw[b.from], (l) => `${l.match(/^\s*/)![0]}:::kanban${attrs ? `{${attrs}}` : ""}`);
  return raw.join("\n");
}

// ---------------------------------------------------------------- cards as notes

const LINK = /^\[\[([^\]|#\n]+)(#[^\]|\n]*)?(?:\|([^\]\n]*))?\]\]$/;

/** A card that is a [[link]] (tokens after it allowed): the note it links to and what it's called. */
export function cardLink(card: Pick<Card, "text">): { target: string; label: string } | null {
  const m = summaryOf(card.text).match(LINK);
  return m ? { target: m[1].trim() + (m[2] ?? ""), label: (m[3] ?? m[1]).trim() } : null;
}

/** A card's text without the run of tokens at its end. */
export const summaryOf = (text: string) => parseTask(`- [ ] ${text}`)!.summary;

/**
 * What "Open as note" makes of a card: a note called `name` that holds the card's nested lines,
 * and the card's new text, a [[link]] to it that keeps the card's trailing tokens.
 */
export function cardAsNote(card: Pick<Card, "text" | "details">, name: string): { body: string; text: string } {
  const details = card.details.join("\n").trim();
  return { body: `# ${name}\n\n${details ? `${details}\n` : ""}`, text: `[[${name}]]${card.text.slice(summaryOf(card.text).length)}` };
}

/** The name "Open as note" gives a card's note: its text without links, tokens or characters a file name can't have. */
export function noteName(card: Pick<Card, "text">): string {
  const summary = summaryOf(card.text).replace(/\[\[([^\]|]*)\|?([^\]]*)\]\]/g, (_m, t, alias) => alias || t);
  return summary.replace(/[\\/:*?"<>|#^[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "Untitled card";
}
