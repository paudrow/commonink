// Tasks: a markdown checkbox line, plus optional todo.txt-style tokens anywhere in its text:
//   - [ ] Send invoice to Acme due:2026-10-01 rec:monthly #work/clients @jane !high
// The line stays the source of truth. This reads the tokens and rewrites one at a time in place, so
// an edit never touches the rest of the line. No Node imports: the editor uses this too.
import { findSection, frontmatterLines, withoutCodeOrLinks } from "./prose.ts";
import { daysBetween, formatRule, nextDue, parseRule, ruleProblem, shiftDate, type Rule } from "./recurrence.ts";
import { cleanTag, normalizeTag, tagsInLine } from "./tags.ts";

/** A task line: its bullet and "[", its box, "] ", its text, and the `\r` of a Windows line ending if it has one. */
export const TASK_LINE = /^(\s*[-*+]\s+\[)([ xX])(\]\s+)(.*?)(\r?)$/;

export type Priority = "high" | "low";
export interface TaskMeta {
  /** YYYY-MM-DD, or YYYY-MM-DDTHH:MM. */
  due: string | null;
  /** Hidden until this day (`start:` or `scheduled:`). */
  start: string | null;
  /** When it was ticked. */
  done: string | null;
  /** How it repeats, as written (`rec:monthly`, `rec:1st-tue`): see recurrence.ts. */
  rec: string | null;
  /** A repeat's last day (`until:`): no occurrence after it. */
  until: string | null;
  /** How many times it's left to happen, this one included (`times:`); each tick counts one down. */
  times: number | null;
  priority: Priority | null;
  assignees: string[];
  tags: string[];
}
export interface ParsedTask {
  done: boolean;
  /** Everything after the checkbox. */
  text: string;
  /** The text without the run of tokens at its end. */
  summary: string;
  meta: TaskMeta;
}
/**
 * Fields to change: a value sets it, null or [] clears it. `checked` ticks or unticks the box, and
 * `summary` replaces the task's words (everything before its trailing tokens).
 */
export type TaskPatch = Partial<TaskMeta> & { checked?: boolean; summary?: string };

type Field = "due" | "start" | "done" | "rec" | "until" | "times" | "priority" | "assignees" | "tags";
/** One token in a task's text; `from`/`to` are its columns there. `key` is how it's written (`scheduled` for a start). */
interface Token {
  field: Field;
  key: string;
  value: string;
  from: number;
  to: number;
}

const PERSON = "[\\p{L}_][\\p{L}\\p{N}_-]*(?:\\.[\\p{L}\\p{N}_-]+)*";
/**
 * A person ends where the word does, so `@jane,` and `@jane.` count and `@jane's` doesn't. A name
 * starts with a letter, so `@3pm` and `@2x` stay words, and `\@home` (escaped) is never a person.
 */
const WORD = new RegExp(`(?<!\\S)(due|start|scheduled|done|rec|until|times):(\\S+)|(?<!\\S)!(high|low)(?!\\S)|(?<!\\S)@(${PERSON})(?=$|[\\s,.;:!?)\\]])`, "giu");
const DATE = /^(\d{4})-(\d{2})-(\d{2})(?:T([01]\d|2[0-3]):[0-5]\d)?$/;

const TIMES = /^[1-9]\d{0,3}$/;
/** A real calendar day with no time (for `until:`). */
const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && isDate(s);

/** A real calendar day (2026-04-31 isn't), optionally with a time. */
export const isDate = (s: string) => {
  const m = s.match(DATE);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
};

/** The day `ms` falls on in `timeZone` (an IANA name; this machine's zone by default), as YYYY-MM-DD. */
export function localDate(ms: number, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(ms);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** `name` as the IANA time zone it names ("asia/tokyo" → "Asia/Tokyo"), or null if it names none. */
export function timeZoneNamed(name: string): string | null {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: name }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

function tokensOf(text: string): Token[] {
  const out: Token[] = [];
  for (const m of withoutCodeOrLinks(text).matchAll(WORD)) {
    const at = { from: m.index, to: m.index + m[0].length };
    if (m[1]) {
      const key = m[1].toLowerCase();
      const value = m[2];
      if (!(key === "rec" ? parseRule(value) : key === "times" ? TIMES.test(value) : key === "until" ? isDay(value) : isDate(value))) continue;
      out.push({ field: key === "scheduled" ? "start" : (key as Field), key, value, ...at });
    } else if (m[3]) out.push({ field: "priority", key: "!", value: m[3].toLowerCase(), ...at });
    else out.push({ field: "assignees", key: "@", value: m[4], ...at });
  }
  for (const t of tagsInLine(text)) {
    let to = t.to;
    while (text[to] === "/") to++; // `#work/` is the tag work: its slash goes with it
    out.push({ field: "tags", key: "#", value: t.display, from: t.from - 1, to });
  }
  return out.sort((a, b) => a.from - b.from);
}

/** A task line's tokens other than tags (those have chips of their own), with their columns in the line. */
export function lineTokens(line: string): Array<{ field: Exclude<Field, "tags">; value: string; from: number; to: number }> {
  const m = line.match(TASK_LINE);
  if (!m) return [];
  const at = line.length - m[4].length;
  return tokensOf(m[4]).flatMap((t) => (t.field === "tags" ? [] : [{ field: t.field, value: t.value, from: t.from + at, to: t.to + at }]));
}

export function parseTask(line: string): ParsedTask | null {
  const m = line.match(TASK_LINE);
  if (!m) return null;
  const text = m[4];
  const tokens = tokensOf(text);
  const end = trailing(text, tokens)[0]?.from ?? text.trimEnd().length;
  const first = (f: Field) => tokens.find((t) => t.field === f)?.value ?? null;
  const all = (f: Field) => tidy(f, tokens.filter((t) => t.field === f).map((t) => t.value));
  return {
    done: m[2] !== " ",
    text,
    summary: text.slice(0, end).trimEnd(),
    meta: { due: first("due"), start: first("start"), done: first("done"), rec: first("rec"), until: first("until"), times: first("times") === null ? null : Number(first("times")), priority: first("priority") as Priority | null, assignees: all("assignees"), tags: all("tags") },
  };
}

/** The run of tokens at the end of a task's text (only whitespace between them), in order. */
function trailing(text: string, tokens: Token[]): Token[] {
  const run: Token[] = [];
  let end = text.trimEnd().length;
  for (const t of [...tokens].reverse()) {
    if (t.to !== end) break;
    run.unshift(t);
    end = text.slice(0, t.from).trimEnd().length;
  }
  return run;
}

/** The order tokens are shown in, and the place a new one goes: priority, due, start, repeat (and its ends), people, tags, done. */
const RANK: Record<Field, number> = { priority: 0, due: 1, start: 2, rec: 3, until: 4, times: 5, assignees: 6, tags: 7, done: 8 };

/** What's wrong with a patch that couldn't be written back as tokens, or null if nothing is. */
export function patchProblem(patch: TaskPatch): string | null {
  if (patch.summary !== undefined && /[\r\n]/.test(patch.summary)) return "A task's text is one line";
  for (const f of ["due", "start", "done"] as const) {
    const v = patch[f];
    if (v !== undefined && v !== null && !isDate(v)) return `"${f}" must be a date like 2026-10-01 or 2026-10-01T09:30, not "${v}"`;
  }
  const rec = patch.rec ? ruleProblem(patch.rec) : null;
  if (rec) return rec;
  if (patch.until !== undefined && patch.until !== null && !isDay(patch.until)) return `"until" must be a date like 2026-10-01, not "${patch.until}"`;
  if (patch.times !== undefined && patch.times !== null && !TIMES.test(String(patch.times))) return `"times" must be a whole number of repeats left, 1 or more`;
  if (patch.priority !== undefined && patch.priority !== null && patch.priority !== "high" && patch.priority !== "low") return `"priority" must be high or low`;
  const person = (patch.assignees ?? []).find((a) => !new RegExp(`^@?${PERSON}$`, "u").test(a.trim()));
  if (person !== undefined) return `"${person}" isn't a person: use a name like jane or jane.doe, without the @`;
  const tag = (patch.tags ?? []).find((t) => !normalizeTag(t));
  if (tag !== undefined) return `"${tag}" isn't a tag: use letters, numbers, - and _, nested with /`;
  return null;
}

const write = (field: Field, value: string, key?: string) =>
  field === "priority" ? `!${value}` : field === "assignees" ? `@${value}` : field === "tags" ? `#${value}` : `${key ?? field}:${value}`;
const same = (field: Field, a: string, b: string) => (field === "tags" ? normalizeTag(a) === normalizeTag(b) : a.toLowerCase() === b.toLowerCase());

/** List values the way tokens hold them (tags tidied, people without the @), each once, first spelling kept. */
function tidy(field: Field, values: string[]): string[] {
  const clean = values.map((v) => (field === "tags" ? (cleanTag(v) ?? v.trim()) : field === "assignees" ? v.trim().replace(/^@/, "") : v.trim())).filter(Boolean);
  return clean.filter((v, i) => clean.findIndex((o) => same(field, o, v)) === i);
}

/** How many spaces and tabs come just before `at` (a loop: /[ \t]*$/ is quadratic on a long run). */
function blanksBefore(text: string, at: number): number {
  let i = at;
  while (i > 0 && (text[i - 1] === " " || text[i - 1] === "\t")) i--;
  return at - i;
}

/**
 * Apply a patch to a task line. A token whose value stays is left as written; a changed value (or
 * a person swapped for another) is replaced where it stands; a cleared one is cut out with the
 * whitespace before it; a new one goes into the tokens at the end of the line at its place in RANK
 * order. Not a task line: returned as is.
 */
export function editTask(line: string, patch: TaskPatch): string {
  const m = line.match(TASK_LINE);
  if (!m) return line;
  let text = m[4];
  if (patch.summary !== undefined) {
    // The words end where the trailing run of tokens starts; that run, and the spacing before it, stay.
    const end = trailing(text, tokensOf(text))[0]?.from ?? text.trimEnd().length;
    const words = patch.summary.trim();
    let rest = text.slice(text.slice(0, end).trimEnd().length);
    if (!words) rest = rest.trimStart();
    text = words + (words && rest && !/^\s/.test(rest) ? " " : "") + rest;
  }
  for (const field of Object.keys(RANK) as Field[]) {
    if (!(field in patch)) continue;
    const v = patch[field];
    const want = tidy(field, Array.isArray(v) ? v : v !== null && v !== undefined && v !== "" ? [String(v)] : []);
    const have = tokensOf(text).filter((t) => t.field === field);
    // A single value changed in place keeps its spot in the sentence (and `scheduled:` stays `scheduled:`).
    if (!Array.isArray(v) && want.length && have.length) {
      const t = have[0];
      if (!same(field, t.value, want[0])) text = text.slice(0, t.from) + write(field, want[0], t.key) + text.slice(t.to);
      continue;
    }
    const kept = new Set<Token>();
    for (const w of want) {
      const hit = have.find((t) => !kept.has(t) && same(field, t.value, w));
      if (hit) kept.add(hit);
    }
    const gone = have.filter((t) => !kept.has(t));
    const fresh = want.filter((w) => ![...kept].some((t) => same(field, t.value, w)));
    // A value swapped for another (a different person) takes the old one's place in the sentence.
    const swaps = Math.min(gone.length, fresh.length);
    for (let i = gone.length - 1; i >= 0; i--) {
      const t = gone[i];
      if (i < swaps) {
        text = text.slice(0, t.from) + write(field, fresh[i], t.key) + text.slice(t.to);
        continue;
      }
      const before = blanksBefore(text, t.from);
      const after = before ? 0 : text.slice(t.to).match(/^[ \t]*/)![0].length;
      text = text.slice(0, t.from - before) + text.slice(t.to + after);
    }
    for (const w of fresh.slice(swaps)) text = insertToken(text, field, write(field, w));
  }
  const box = patch.checked === undefined || patch.checked === (m[2] !== " ") ? m[2] : patch.checked ? "x" : " ";
  return `${m[1]}${box}${m[3]}${text}${m[5]}`;
}

/**
 * Apply a patch to the task on `lines[i]`, and what ticking means for the lines around it. Ticking
 * stamps `done:` with `today` and unticking takes it off, unless the patch sets it. Ticking a
 * repeating task puts its next occurrence directly below; unticking it while that occurrence is
 * still there as it was added takes it back, so a mis-tick leaves nothing behind.
 */
export function editTaskLines(lines: string[], i: number, patch: TaskPatch, today: string): string[] {
  const was = parseTask(lines[i] ?? "");
  if (!was) return lines;
  const flips = patch.checked !== undefined && patch.checked !== was.done;
  const out = [...lines];
  out[i] = editTask(lines[i], flips && !("done" in patch) ? { ...patch, done: patch.checked ? today : null } : patch);
  if (!flips) return out;
  if (patch.checked) {
    const next = nextOccurrence(out[i], parseTask(out[i])!.meta.done ?? today);
    if (next) out.splice(i + 1, 0, next);
  } else if (was.meta.done && out[i + 1] !== undefined && out[i + 1] === nextOccurrence(out[i], was.meta.done)) {
    out.splice(i + 1, 1);
  }
  return out;
}

/**
 * Where a repeat ends: the earlier of its `until:` and its rule's UNTIL, and its `times:` (else the
 * rule's COUNT), the occurrences left with this one included. Null for no end.
 */
export function endsOf(meta: Pick<TaskMeta, "until" | "times">, rule: Rule): { until: string | null; times: number | null } {
  const untils = [meta.until, rule.until].filter((u): u is string => !!u).sort();
  return { until: untils[0] ?? null, times: meta.times ?? rule.count ?? null };
}

/**
 * The next occurrence of a repeating task that's done (or skipped) with `after` as the day to count
 * from: its due date, never before `today`, and the patch that counts `times:` (or the rule's
 * COUNT) down by one, however many dates it passed. Null if the task doesn't repeat, or this was its
 * last time.
 */
function following(meta: TaskMeta, after: string, today = after): { due: string; patch: TaskPatch } | null {
  const rule = meta.rec ? parseRule(meta.rec) : null;
  if (!rule) return null;
  const ends = endsOf(meta, rule);
  if (ends.times !== null && ends.times <= 1) return null;
  const due = nextDue(rule, meta.due, after, today);
  if (!due || (ends.until && due.slice(0, 10) > ends.until)) return null;
  const start = meta.start && shiftDate(meta.start, daysBetween(meta.due ?? after, due));
  const countdown: TaskPatch = meta.times !== null ? { times: meta.times - 1 } : rule.count ? { rec: formatRule({ ...rule, count: rule.count - 1 }) } : {};
  return { due, patch: { due, ...(start ? { start } : {}), ...countdown } };
}

/**
 * The task that follows a repeating one done on `done`: the same line, unticked, due on the rule's
 * next date on or after `done` (so a late tick doesn't leave the next one overdue too), with its
 * start moved by as many days and one fewer `times:` left. Null if it doesn't repeat, or never
 * again (its `until:` has passed, or that was its last time).
 */
export function nextOccurrence(line: string, done: string): string | null {
  const task = parseTask(line);
  const next = task && following(task.meta, done);
  return next ? editTask(line, { checked: false, done: null, ...next.patch }) : null;
}

/**
 * The patch that skips a repeating task's current occurrence: due (and start) move to the next
 * date without it being done, and a skipped time counts as one of its `times:`. A gap after
 * completion counts from the due date, as if done on time. Either way it lands on or after `today`.
 * Null if the task doesn't repeat, or has no next time to skip to.
 */
export function skipPatch(meta: TaskMeta, today: string): TaskPatch | null {
  return following(meta, meta.due?.slice(0, 10) ?? today, today)?.patch ?? null;
}

/** Put a new token among the tokens at the end of the text, before the first that ranks after it (else last). */
function insertToken(text: string, field: Field, token: string): string {
  const next = trailing(text, tokensOf(text)).find((t) => RANK[t.field] > RANK[field]);
  if (next) return `${text.slice(0, next.from)}${token} ${text.slice(next.from)}`;
  const body = text.trimEnd();
  return `${body}${body ? " " : ""}${token}${text.slice(body.length)}`;
}

/**
 * The day a filter word means: today, tomorrow, yesterday, a date, or a span from today (`+7d`,
 * `-2w`, `+1m`, `+1y`). Null if it isn't one.
 */
export function dayFrom(word: string, today: string): string | null {
  const w = word.toLowerCase();
  if (w === "today" || w === "tomorrow" || w === "yesterday") return addDays(today, { today: 0, tomorrow: 1, yesterday: -1 }[w]);
  if (/^\d{4}-\d{2}-\d{2}$/.test(w)) return isDate(w) ? w : null;
  const m = w.match(/^([+-])(\d{1,4})([dwmy])$/);
  if (!m) return null;
  const n = Number(m[2]) * (m[1] === "-" ? -1 : 1);
  return m[3] === "d" ? addDays(today, n) : m[3] === "w" ? addDays(today, 7 * n) : addMonths(today, m[3] === "m" ? n : 12 * n);
}

/** What a date filter takes, for messages. */
export const DATE_FILTER_HELP =
  'today, tomorrow, yesterday, a date, or a span from today like +7d, -2w or +1m, optionally after <, <=, > or >=; two make a range (">=today <=+7d")';

/**
 * A test for one of a task's dates (due:, start: or done:) from a filter: one or more comparisons,
 * all of which must hold, like `<=today`, `>=today <=+7d` (the coming week), `>=-7d` or `tomorrow`
 * (no operator means that day). Spaces or commas separate them. Null if it isn't one. `today` is
 * the day it's evaluated on. A task without that date never matches.
 */
export function dateFilter(expr: string, today: string): ((date: string | null) => boolean) | null {
  // An operator may have a space after it (">= tomorrow"): it still goes with the word that follows.
  const parts = expr.trim().replace(/(<=|>=|<|>|=)\s+/g, "$1").split(/[\s,]+/).filter(Boolean);
  if (!parts.length || parts.length > 4) return null;
  const tests: Array<(d: string) => boolean> = [];
  for (const part of parts) {
    const m = part.match(/^(<=|>=|<|>|=)?(.+)$/)!;
    const day = dayFrom(m[2], today);
    if (!day) return null;
    const op = m[1] ?? "=";
    tests.push((d) => (op === "<" ? d < day : op === "<=" ? d <= day : op === ">" ? d > day : op === ">=" ? d >= day : d === day));
  }
  return (date) => !!date && tests.every((t) => t(date.slice(0, 10)));
}

/** A due date filter (the name it had before start: and done: could be filtered too). */
export const dueFilter = dateFilter;

/**
 * A test for a task's priority from a filter: high, low or none (no priority), or several with
 * commas (`high,none`). `!high` works too, the way the token is written. Null if it isn't one.
 */
export function priorityFilter(expr: string): ((p: Priority | null) => boolean) | null {
  const want = expr.toLowerCase().split(/[\s,]+/).filter(Boolean).map((w) => w.replace(/^!/, ""));
  if (!want.length || want.some((w) => w !== "high" && w !== "low" && w !== "none")) return null;
  return (p) => want.includes(p ?? "none");
}

/** The day `n` days after `day` (both YYYY-MM-DD). */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The day `n` months after `day`, on the month's last day if that month is shorter (Jan 31 + 1m is Feb 28). */
export function addMonths(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const months = y * 12 + (m - 1) + n;
  const year = Math.floor(months / 12);
  const month = months - year * 12;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return `${String(year).padStart(4, "0")}-${String(month + 1).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

const RULE = /^ {0,3}([-*_])[ \t]*(?:\1[ \t]*){2,}$/;
const FOOTNOTE = /^ {0,3}\[\^[^\]\s]+\]:/;

/**
 * Where a note's footer starts (a 0-based line), or `lines.length` if it has none. A footer is what
 * closes the note under its last section: a `---` rule (after a blank line, so not a heading's
 * underline) with no heading below it, or the footnote definitions at its end.
 */
export function footerStart(lines: string[]): number {
  const fm = frontmatterLines(lines.join("\n"));
  let fence: string | null = null;
  let rule = -1;
  for (let i = fm; i < lines.length; i++) {
    const f = lines[i].match(/^\s{0,3}(`{3,}|~{3,})/)?.[1];
    if (f && (!fence || (f[0] === fence[0] && f.length >= fence.length))) fence = fence ? null : f;
    if (fence || f) continue;
    if (/^ {0,3}#{1,6}(\s|$)/.test(lines[i])) rule = -1;
    else if (rule < 0 && RULE.test(lines[i]) && (i === fm || !lines[i - 1].trim())) rule = i;
  }
  if (rule >= 0 && !fence) return rule;
  // Footnotes: the definitions at the very end, with their indented or blank continuation lines.
  let notes = lines.length;
  for (let i = lines.length - 1; i >= fm; i--) {
    if (FOOTNOTE.test(lines[i])) notes = i;
    else if (lines[i].trim() && !/^( {2,}|\t)/.test(lines[i])) break;
  }
  return fence ? lines.length : notes;
}

/**
 * A note with task lines added: at the end of its "Tasks" section (a heading named Tasks, at any
 * level), or, without one, at the end of the note, under a new `## Tasks` heading if `heading`
 * (a journal note) or right after the last line otherwise. A footer (see footerStart) stays last, so
 * "the end" is just above it. `line` is where the first one landed. `name` puts them in another
 * section instead (a journal note's Decisions).
 */
export function withTasksAdded(original: string, added: string[], heading: boolean, name = "Tasks"): { content: string; line: number } {
  // Worked out on "\n" lines, and put back with the note's own line endings.
  const crlf = original.includes("\r\n");
  const content = crlf ? original.replace(/\r\n/g, "\n") : original;
  const block = added.map((l) => l.replace(/\r$/, ""));
  let last = content.length;
  while (last > 0 && content[last - 1] === "\n") last--; // a loop: /\n+$/ is quadratic on many blank lines
  const lines = content.slice(0, last).split("\n");
  if (lines.length === 1 && lines[0] === "") lines.pop();
  // The footer comes off while the tasks go in, and back after them with a blank line between.
  const foot = footerStart(lines);
  const footer = lines.splice(foot);
  while (footer.length && lines.length && !lines[lines.length - 1].trim()) lines.pop();
  const { section, end } = findSection(lines, name);
  let at: number;
  if (section >= 0) {
    // After the section's last line with anything on it; a section with nothing yet gets a blank line first.
    let last = end;
    while (last > section + 1 && !lines[last - 1].trim()) last--;
    const empty = last === section + 1;
    const insert = empty ? ["", ...block] : block;
    lines.splice(last, 0, ...insert);
    at = last + (empty ? 1 : 0);
    const after = last + insert.length;
    if (after < lines.length && lines[after].trim()) lines.splice(after, 0, ""); // keep a blank line before the next heading
  } else if (heading) {
    lines.push(...(lines.length ? [""] : []), `## ${name}`, "", ...block);
    at = lines.length - block.length;
  } else {
    // Straight after a list; after a blank line otherwise.
    if (lines.length && !/^\s*([-*+]|\d+[.)])\s/.test(lines[lines.length - 1])) lines.push("");
    at = lines.length;
    lines.push(...block);
  }
  if (footer.length) lines.push(...(lines.length ? [""] : []), ...footer);
  const out = lines.join("\n") + "\n";
  return { content: crlf ? out.replace(/\n/g, "\r\n") : out, line: at + 1 };
}

/**
 * Which Today section an open task is in on `date`: overdue (due before it), due today, or starting
 * today; null if none. The most urgent wins, so a task is in one section at most.
 */
export function todaySection(meta: TaskMeta, date: string): "overdue" | "due" | "starting" | null {
  const due = meta.due?.slice(0, 10) ?? "";
  if (due && due < date) return "overdue";
  if (due === date) return "due";
  return meta.start?.slice(0, 10) === date ? "starting" : null;
}
