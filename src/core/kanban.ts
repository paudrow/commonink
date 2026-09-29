// Kanban boards: a `:::kanban` block inside an ordinary note, with notes above and below it.
//
//   :::kanban
//   ## Backlog
//   - [ ] [[Pricing page]] #business
//   - [ ] Draft the announcement @audrow due:2026-10-15
//
//   ## Doing {color=blue}
//
//   ## Done
//   - [x] [[Landing page]] done:2026-09-20
//   :::
//
// Inside the block, every heading is a column (any level) and the list items under it are cards,
// with any lines nested under an item. A column can carry a colour after its name, `{color=blue}`.
// It stays real markdown, so tasks, links, tags and backlinks work in it as anywhere else. The
// column named "Done" is the done column: a card moved into it is ticked, and one moved out
// unticked. The board draws no checkboxes; where a card is says whether it's done.
//
// Lines the board can't place (text before the first column, a paragraph between cards) are
// problems: reported with where they are, shown to the person with fixes to pick from, and never
// changed until they pick one. Every change is a splice of whole lines, so the rest of the note,
// its blank lines and a card's nested lines stay byte for byte. No Node imports: the editor uses this too.
import { parseAttrs, serializeAttrs } from "./directive.ts";
import { proseLines } from "./prose.ts";
import { editTask, nextOccurrence, parseTask, TASK_LINE, type TaskPatch } from "./tasks.ts";

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
  /** From `{color=…}` after its name; see COLORS. */
  color: string | null;
  /** Its heading's line; `to` is the next column's heading, or the board's closing `:::`. */
  from: number;
  to: number;
  done: boolean;
  cards: Card[];
}
/**
 * Something on a board that isn't what a board expects. The board still draws; the lines stay as
 * they are until a fix is picked (see fixesFor).
 */
export interface Problem {
  kind: "before-columns" | "stray" | "duplicate-column" | "unknown-setting";
  /** The lines it covers (0-based, `to` exclusive). */
  from: number;
  to: number;
  message: string;
}
export interface Board {
  /** The `:::kanban` line; `close` is the line of its `:::`. */
  from: number;
  close: number;
  args: Record<string, string>;
  columns: Column[];
  problems: Problem[];
}

/** Column colours, in the order the menu offers them. The app draws each for light and dark. */
export const COLORS = ["gray", "red", "orange", "yellow", "green", "teal", "blue", "purple"] as const;

const OPEN = /^\s*:::kanban(?:\{([^}\n]*)\})?\s*$/i;
const CLOSE = /^\s*:::\s*$/;
const HEADING = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const ITEM = /^( {0,3})([-*+]|\d{1,9}[.)])([ \t]+)(.*)$/;
/** A heading's text: its name, then any `{key=value}` settings. */
const TITLE = /^(.*?)(?:[ \t]*\{([^}\n]*)\})?$/;
/** Settings the opening line may carry. `done` names another done column: kept for older files, not offered. */
const SETTINGS = new Set(["done"]);

/** A new board, for the insert menu. */
export const NEW_BOARD = ":::kanban\n## Backlog\n- [ ] Your first card\n\n## Doing\n\n## Done\n:::";

/** Every closed `:::kanban` block in a note, in order. One inside code doesn't count. */
export function boardsIn(md: string): Board[] {
  return scan(md).boards;
}

/** The line of a `:::kanban` that's never closed (so it shows as text), or null. */
export const unclosedBoard = (md: string) => scan(md).unclosed;

function scan(md: string): { boards: Board[]; unclosed: number | null } {
  const lines = md.split("\n").map((l) => l.replace(/\r$/, ""));
  const prose = new Set(proseLines(md).map(([n]) => n - 1));
  const boards: Board[] = [];
  for (let i = 0; i < lines.length; i++) {
    const open = prose.has(i) ? lines[i].match(OPEN) : null;
    if (!open) continue;
    const close = lines.findIndex((l, j) => j > i && prose.has(j) && CLOSE.test(l));
    if (close < 0) return { boards, unclosed: i };
    boards.push(readBoard(lines, prose, i, close, parseAttrs(open[1] ?? "")));
    i = close;
  }
  return { boards, unclosed: null };
}

function readBoard(lines: string[], prose: Set<number>, from: number, close: number, args: Record<string, string>): Board {
  const heads: Array<{ at: number; title: string; color: string | null }> = [];
  for (let i = from + 1; i < close; i++) {
    const h = prose.has(i) ? lines[i].match(HEADING) : null;
    if (!h || !h[2]) continue;
    const [, title, attrs] = h[2].match(TITLE)!;
    heads.push({ at: i, title: title.trim() || h[2], color: attrs === undefined ? null : (parseAttrs(attrs).color ?? null) });
  }
  const problems: Problem[] = [];
  const done = (args.done || "Done").trim().toLowerCase();
  const columns = heads.map((h, k) => {
    const to = heads[k + 1]?.at ?? close;
    const { cards, stray } = readCards(lines, prose, h.at + 1, to);
    for (const s of stray) problems.push({ kind: "stray", ...s, message: `${count(s)} in ${h.title} ${s.to - s.from === 1 ? "isn't a card" : "aren't cards"}` });
    return { title: h.title, color: h.color, from: h.at, to, done: h.title.toLowerCase() === done, cards };
  });
  const first = heads[0]?.at ?? close;
  const before = trimBlank(lines, from + 1, first);
  if (before) problems.unshift({ kind: "before-columns", ...before, message: `${count(before)} before the first column ${before.to - before.from === 1 ? "isn't" : "aren't"} part of any column` });
  const seen = new Map<string, number>();
  for (const c of columns) {
    const key = c.title.toLowerCase();
    if (seen.has(key)) problems.push({ kind: "duplicate-column", from: c.from, to: c.from + 1, message: `Two columns are called ${c.title}: agents can only tell them apart by number` });
    else seen.set(key, c.from);
  }
  const unknown = Object.keys(args).filter((k) => !SETTINGS.has(k));
  if (unknown.length) problems.push({ kind: "unknown-setting", from, to: from + 1, message: `The board doesn't use ${unknown.map((k) => `${k}=`).join(", ")}` });
  problems.sort((a, b) => a.from - b.from);
  return { from, close, args, columns, problems };
}

const count = (r: { from: number; to: number }) => (r.to - r.from === 1 ? `Line ${r.from + 1}` : `Lines ${r.from + 1}–${r.to}`);

/** The lines from `from` to `to` without blank ones at either end, or null if all are blank. */
function trimBlank(lines: string[], from: number, to: number): { from: number; to: number } | null {
  while (from < to && !lines[from].trim()) from++;
  while (to > from && !lines[to - 1].trim()) to--;
  return from < to ? { from, to } : null;
}

/**
 * List items between `from` and `to` that aren't nested in another, each with the lines nested
 * under it, and the runs of other lines (a paragraph, a rule) that are neither.
 */
function readCards(lines: string[], prose: Set<number>, from: number, to: number) {
  const cards: Card[] = [];
  const stray: Array<{ from: number; to: number }> = [];
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
    if (!item) {
      const last = stray.at(-1);
      // A run of lines the board can't place, blank lines inside it included.
      if (last && trimBlank(lines, last.to, i) === null) last.to = i + 1;
      else stray.push({ from: i, to: i + 1 });
      continue;
    }
    const task = parseTask(line);
    const card: Card = { from: i, to: i + 1, checked: task ? task.done : null, text: task ? task.text : item[4], details: [] };
    cards.push(card);
    open = { card, indent: item[1].length };
  }
  for (const c of cards) c.details = dedent(lines.slice(c.from + 1, c.to));
  return { cards, stray };
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

function boardAt(boards: Board[], board: number): Board {
  const b = boards[board];
  if (!b) throw new Error("That board isn't in the note any more");
  return b;
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

/**
 * A card's first line ticked (`done:` stamped with `today`) or unticked. A list item without a
 * checkbox gets one when it's ticked, so it counts as done like any other card.
 */
function tick(line: string, checked: boolean, today: string) {
  return retext(line, (t) => {
    const boxed = TASK_LINE.test(t) || !checked ? t : t.replace(ITEM, (_m, indent, bullet, gap, rest) => `${indent}${/\d/.test(bullet) ? "-" : bullet}${gap}[ ] ${rest}`);
    return editTask(boxed, { checked, done: checked ? today : null });
  });
}

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
 * note. Into the done column ticks it; out of it, into another column, unticks it. A repeating
 * card moved into the done column leaves its next occurrence at the top of the board's first
 * column (the first that isn't the done column).
 */
export function moveCard(md: string, line: number, to: Place, index: number, today: string, next = nextOccurrence): string {
  const { raw, cr } = split(md);
  const boards = boardsIn(md);
  const { column: from, card } = locate(boards, line);
  const dest = columnAt(boards, to);
  // A card indented (up to three spaces) comes out flush left, so it can't land nested under another.
  const pad = raw[card.from].match(/^ */)![0];
  const block = raw.slice(card.from, card.to).map((l) => (l.startsWith(pad) ? l.slice(pad.length) : l));
  const flips = dest.done !== from.done && !!card.checked !== dest.done && (card.checked !== null || dest.done);
  if (flips) block[0] = tick(block[0], dest.done, today);
  const following = flips && dest.done ? next(block[0].replace(/\r$/, ""), today) : null;
  let at = slot(raw, dest, index, card);
  raw.splice(card.from, block.length);
  if (at > card.from) at -= block.length;
  raw.splice(at, 0, ...block);
  if (!following) return raw.join("\n");
  const board = boardsIn(raw.join("\n"))[to.board];
  const start = board.columns.find((c) => !c.done) ?? board.columns[0];
  raw.splice(slot(raw, start, 0), 0, following + cr);
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
    const pad = nested ? nested.match(/^\s*/)![0] : " ".repeat(head.match(ITEM)!.slice(1, 4).join("").length);
    block.push(...details.map((d) => (d ? pad + d : "") + cr));
  }
  raw.splice(card.from, card.to - card.from, ...block);
  return raw.join("\n");
}

/** Tick or untick the card on `line`; `done:` is stamped with `today` or taken off. */
export function checkCard(md: string, line: number, checked: boolean, today: string): string {
  const { raw } = split(md);
  const { card } = locate(boardsIn(md), line);
  raw[card.from] = tick(raw[card.from], checked, today);
  return raw.join("\n");
}

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

/** A column heading's `#`s, as its last column (or `##` on a board without one). */
const hashes = (raw: string[], b: Board) => raw[b.columns.at(-1)?.from ?? -1]?.match(/^ {0,3}(#{1,6})/)?.[1] ?? "##";

/** Add an empty column at the end of a board. */
export function addColumn(md: string, board: number, title: string): string {
  const { raw, cr } = split(md);
  const b = boardAt(boardsIn(md), board);
  const gap = b.columns.length && raw[b.close - 1].trim() ? [cr] : [];
  raw.splice(b.close, 0, ...gap, `${hashes(raw, b)} ${title.trim()}${cr}`);
  return raw.join("\n");
}

/** A heading line with a new name and settings (`{color=…}`), its `#`s and anything after them kept. */
function heading(line: string, title: string, attrs: Record<string, string>) {
  const set = serializeAttrs(attrs);
  return retext(line, (l) => `${l.match(/^ {0,3}#{1,6}[ \t]+/)![0]}${title}${set ? ` {${set}}` : ""}`);
}

/** The settings on a column's heading, `{…}` after its name. */
function headingAttrs(line: string): Record<string, string> {
  const text = line.replace(/\r$/, "").match(HEADING)?.[2] ?? "";
  const attrs = text.match(TITLE)?.[2];
  return attrs === undefined ? {} : parseAttrs(attrs);
}

/** Rename a column: its heading's name changes; its level and colour stay. */
export function renameColumn(md: string, at: Place, title: string): string {
  const { raw } = split(md);
  const column = columnAt(boardsIn(md), at);
  raw[column.from] = heading(raw[column.from], title.trim(), headingAttrs(raw[column.from]));
  return raw.join("\n");
}

/** Give a column a colour (one of COLORS), or take it off with null. It's written after the name: `## Doing {color=blue}`. */
export function setColumnColor(md: string, at: Place, color: string | null): string {
  const { raw } = split(md);
  const column = columnAt(boardsIn(md), at);
  const attrs = headingAttrs(raw[column.from]);
  if (color) attrs.color = color;
  else delete attrs.color;
  raw[column.from] = heading(raw[column.from], column.title, attrs);
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

// ---------------------------------------------------------------- problems and their fixes

/** What a problem's lines can be turned into. */
export type Fix = "cards" | "move" | "remove";

/** The fixes that are safe for a problem, in the order to offer them. Anything else is Edit as text. */
export function fixesFor(problem: Problem, board: Board): Fix[] {
  switch (problem.kind) {
    case "before-columns":
      return board.columns.length ? ["move", "remove"] : ["remove"];
    case "stray":
      return ["cards", "remove"];
    case "unknown-setting":
      return ["remove"];
    case "duplicate-column":
      return [];
  }
}

/**
 * Apply one of a problem's fixes (see fixesFor): make its lines cards where they are, move them
 * into the first column as cards, or remove them (an unknown setting: just that setting).
 */
export function fixProblem(md: string, board: number, problem: number, fix: Fix): string {
  const { raw } = split(md);
  const b = boardAt(boardsIn(md), board);
  const p = b.problems[problem];
  if (!p || !fixesFor(p, b).includes(fix)) throw new Error("That problem isn't on the board any more");
  if (p.kind === "unknown-setting") {
    const kept = Object.fromEntries(Object.entries(b.args).filter(([k]) => SETTINGS.has(k)));
    const attrs = serializeAttrs(kept);
    raw[b.from] = retext(raw[b.from], (l) => `${l.match(/^\s*/)![0]}:::kanban${attrs ? `{${attrs}}` : ""}`);
    return raw.join("\n");
  }
  const lines = raw.slice(p.from, p.to);
  const cards = lines.filter((l) => l.trim()).map((l) => retext(l, (t) => `- [ ] ${t.trim()}`));
  if (fix === "remove") raw.splice(p.from, p.to - p.from);
  else if (fix === "cards") raw.splice(p.from, p.to - p.from, ...cards);
  else {
    const column = b.columns[0];
    const at = slot(raw, column, 0);
    raw.splice(at, 0, ...cards);
    raw.splice(p.from, p.to - p.from);
  }
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
