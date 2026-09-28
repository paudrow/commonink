// Tasks: a markdown checkbox line, plus optional todo.txt-style tokens anywhere in its text:
//   - [ ] Send invoice to Acme due:2026-10-01 rec:monthly #work/clients @jane !high
// The line stays the source of truth. This reads the tokens and rewrites one at a time in place, so
// an edit never touches the rest of the line. No Node imports: the editor uses this too.
import { withoutCode } from "./prose.ts";
import { normalizeTag, tagsInLine } from "./tags.ts";

export const TASK_LINE = /^(\s*[-*+]\s+\[)([ xX])(\]\s+)(.*)$/;

export type Priority = "high" | "low";
export interface TaskMeta {
  /** YYYY-MM-DD, or YYYY-MM-DDTHH:MM. */
  due: string | null;
  /** Hidden until this day (`start:` or `scheduled:`). */
  start: string | null;
  /** When it was ticked. */
  done: string | null;
  /** How it repeats, as written (`rec:monthly`); #8 gives it meaning. */
  rec: string | null;
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
/** Fields to change: a value sets it, null or [] clears it. `checked` ticks or unticks the box. */
export type TaskPatch = Partial<TaskMeta> & { checked?: boolean };

type Field = "due" | "start" | "done" | "rec" | "priority" | "assignees" | "tags";
/** One token in a task's text; `from`/`to` are its columns there. `key` is how it's written (`scheduled` for a start). */
interface Token {
  field: Field;
  key: string;
  value: string;
  from: number;
  to: number;
}

const WORD = /(?<!\S)(due|start|scheduled|done|rec):(\S+)|(?<!\S)!(high|low)(?!\S)|(?<!\S)@([\p{L}\p{N}_-]+(?:\.[\p{L}\p{N}_-]+)*)/giu;
const DATE = /^(\d{4})-(\d{2})-(\d{2})(?:T([01]\d|2[0-3]):[0-5]\d)?$/;
const REC = /^[\p{L}\p{N}_+-]+$/u;

export const isDate = (s: string) => {
  const m = s.match(DATE);
  return !!m && +m[2] >= 1 && +m[2] <= 12 && +m[3] >= 1 && +m[3] <= 31;
};

/** The day `ms` falls on here, as YYYY-MM-DD. */
export const localDate = (ms: number) => new Date(ms).toLocaleDateString("en-CA");

function tokensOf(text: string): Token[] {
  const out: Token[] = [];
  for (const m of withoutCode(text).matchAll(WORD)) {
    const at = { from: m.index, to: m.index + m[0].length };
    if (m[1]) {
      const key = m[1].toLowerCase();
      const value = m[2];
      if (key === "rec" ? !REC.test(value) : !isDate(value)) continue;
      out.push({ field: key === "scheduled" ? "start" : (key as Field), key, value, ...at });
    } else if (m[3]) out.push({ field: "priority", key: "!", value: m[3].toLowerCase(), ...at });
    else out.push({ field: "assignees", key: "@", value: m[4], ...at });
  }
  for (const t of tagsInLine(text)) out.push({ field: "tags", key: "#", value: t.display, from: t.from - 1, to: t.to });
  return out.sort((a, b) => a.from - b.from);
}

export function parseTask(line: string): ParsedTask | null {
  const m = line.match(TASK_LINE);
  if (!m) return null;
  const text = m[4];
  const tokens = tokensOf(text);
  let end = text.trimEnd().length;
  for (const t of [...tokens].reverse()) {
    if (t.to !== end) break;
    end = text.slice(0, t.from).trimEnd().length;
  }
  const first = (f: Field) => tokens.find((t) => t.field === f)?.value ?? null;
  const all = (f: Field) => [...new Map(tokens.filter((t) => t.field === f).map((t) => [t.value.toLowerCase(), t.value])).values()];
  return {
    done: m[2] !== " ",
    text,
    summary: text.slice(0, end),
    meta: { due: first("due"), start: first("start"), done: first("done"), rec: first("rec"), priority: first("priority") as Priority | null, assignees: all("assignees"), tags: all("tags") },
  };
}

/** What's wrong with a patch that couldn't be written back as tokens, or null if nothing is. */
export function patchProblem(patch: TaskPatch): string | null {
  for (const f of ["due", "start", "done"] as const) {
    const v = patch[f];
    if (v !== undefined && v !== null && !isDate(v)) return `"${f}" must be a date like 2026-10-01 or 2026-10-01T09:30, not "${v}"`;
  }
  if (patch.rec && !REC.test(patch.rec)) return `"rec" must be one word like weekly or monthly, not "${patch.rec}"`;
  if (patch.priority !== undefined && patch.priority !== null && patch.priority !== "high" && patch.priority !== "low") return `"priority" must be high or low`;
  const person = (patch.assignees ?? []).find((a) => !/^[\p{L}\p{N}_-]+(?:\.[\p{L}\p{N}_-]+)*$/u.test(a));
  if (person !== undefined) return `"${person}" isn't a person: use a name like jane or jane.doe, without the @`;
  const tag = (patch.tags ?? []).find((t) => !normalizeTag(t));
  if (tag !== undefined) return `"${tag}" isn't a tag: use letters, numbers, - and _, nested with /`;
  return null;
}

const write = (field: Field, value: string, key?: string) =>
  field === "priority" ? `!${value}` : field === "assignees" ? `@${value}` : field === "tags" ? `#${value}` : `${key ?? field}:${value}`;
const same = (field: Field, a: string, b: string) => (field === "tags" ? normalizeTag(a) === normalizeTag(b) : a.toLowerCase() === b.toLowerCase());

/**
 * Apply a patch to a task line. A token whose value stays is left as written; a changed value is
 * replaced where it stands; a cleared one is cut out with the space before it; a new one goes on
 * the end (before any trailing whitespace). Not a task line: returned as is.
 */
export function editTask(line: string, patch: TaskPatch): string {
  const m = line.match(TASK_LINE);
  if (!m) return line;
  let text = m[4];
  for (const field of ["due", "start", "done", "rec", "priority", "assignees", "tags"] as Field[]) {
    if (!(field in patch)) continue;
    const v = patch[field];
    const want = (Array.isArray(v) ? v : v ? [v] : []).filter(Boolean);
    const have = tokensOf(text).filter((t) => t.field === field);
    const single = !Array.isArray(v);
    // A single value changed in place keeps its spot in the sentence (and `scheduled:` stays `scheduled:`).
    if (single && want.length && have.length && !same(field, have[0].value, want[0])) {
      const t = have[0];
      text = text.slice(0, t.from) + write(field, want[0], t.key) + text.slice(t.to);
      continue;
    }
    const kept = new Set<Token>();
    for (const w of want) {
      const hit = have.find((t) => !kept.has(t) && same(field, t.value, w));
      if (hit) kept.add(hit);
    }
    for (const t of [...have].reverse()) {
      if (kept.has(t)) continue;
      const cutFrom = t.from > 0 && text[t.from - 1] === " " ? t.from - 1 : t.from;
      const cutTo = cutFrom === t.from && text[t.to] === " " ? t.to + 1 : t.to;
      text = text.slice(0, cutFrom) + text.slice(cutTo);
    }
    for (const w of want) {
      if ([...kept].some((t) => same(field, t.value, w))) continue;
      text = text.replace(/\s*$/, (ws) => `${text.trim() ? " " : ""}${write(field, w)}${ws}`);
    }
  }
  const box = patch.checked === undefined || patch.checked === (m[2] !== " ") ? m[2] : patch.checked ? "x" : " ";
  return `${m[1]}${box}${m[3]}${text}`;
}

/**
 * A test for due dates from an expression like `<=today`, `>2026-10-01` or `tomorrow` (no operator
 * means that day), or null if it isn't one. `today` is the day it's evaluated on. A task with no
 * due date never matches.
 */
export function dueFilter(expr: string, today: string): ((due: string | null) => boolean) | null {
  const m = expr.trim().match(/^(<=|>=|<|>|=)?\s*(today|tomorrow|yesterday|\d{4}-\d{2}-\d{2})$/i);
  if (!m || (/^\d/.test(m[2]) && !isDate(m[2]))) return null;
  const shift = { today: 0, tomorrow: 1, yesterday: -1 }[m[2].toLowerCase()];
  const day = shift === undefined ? m[2] : addDays(today, shift);
  const op = m[1] ?? "=";
  return (due) => {
    if (!due) return false;
    const d = due.slice(0, 10);
    return op === "<" ? d < day : op === "<=" ? d <= day : op === ">" ? d > day : op === ">=" ? d >= day : d === day;
  };
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
