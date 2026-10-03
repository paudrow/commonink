// The query grammar: how the words of a note query read. One module, so the Notes filter, smart
// folders, `::view`, `commonink ls --query`, the smart folder editor and the syntax help can't
// drift. No Node imports: the web app uses this too.
//
//   launch plan                 every word, each as a prefix (`plan` finds "planning")
//   "launch plan", 'launch plan' the words together, in order
//   a AND b, a b                both (side by side means AND too)
//   a OR b                      either one (OR and AND in capitals; lowercase they're words)
//   -term, -( … )               leave out what it matches
//   ( … )                       a group: `-` binds tightest, then AND, then OR
//   tag=x, folder=x, modified>-7d, created<2026-09-01   filters, usable anywhere a word is
//   sort=title                  how the list is ordered: on its own, outside ( )
//
// The API, small on purpose:
//   parse(q)            the text read: { expr, sort, error }. On an error the expression is the
//                       best reading of the rest (so a list still shows something while you type).
//   evaluate(expr, test) whether a note matches, given a test for each term (the engine's job).
//   format(expr)        an expression as text again; parse(format(e)) reads back the same e.
//   andJoin(a, b, …)    texts that must all match, joined without changing what each means.
//   SYNTAX              every operator and field, with an example: what the help pages list.
import { cleanTag } from "./tags.ts";

export type QuerySort = "modified" | "date" | "oldest" | "title" | "created";
export const SORTS: readonly QuerySort[] = ["modified", "date", "oldest", "title", "created"];
export const isSort = (s: string | undefined): s is QuerySort => (SORTS as readonly string[]).includes(s ?? "");

export type CompareOp = "<" | "<=" | ">" | ">=" | "=";

/** One thing a note can match. */
export type Term =
  /** A word, found as a prefix; or with `phrase`, the words together, exactly. */
  | { kind: "text"; words: string[]; phrase: boolean }
  /** This tag, or a tag under it. */
  | { kind: "tag"; tag: string }
  /** In one of these folders, or a folder under it. */
  | { kind: "folder"; folders: string[] }
  /** The day a note was last changed (or made) compared with `day` (see dayFrom). */
  | { kind: "date"; field: "modified" | "created"; op: CompareOp; day: string };

export type Expr = Term | { kind: "and"; items: Expr[] } | { kind: "or"; items: Expr[] } | { kind: "not"; item: Expr };

export interface QueryError {
  /** For people, naming the place: `Missing ")" for the "(" at character 1`. */
  message: string;
  /** Where, counted from 0. */
  at: number;
}

export interface Parsed {
  /** What a note must match, or null for any note. */
  expr: Expr | null;
  /** A `sort=` among the words, or null. */
  sort: QuerySort | null;
  error: QueryError | null;
}

/** An operator or field, for the syntax help. Add one here and every help page lists it. */
export interface SyntaxEntry {
  group: "Words" | "Combine" | "Filters" | "Order";
  syntax: string;
  example: string;
  about: string;
}

export const SYNTAX: SyntaxEntry[] = [
  { group: "Words", syntax: "word", example: "plan", about: 'Notes with a word starting with it: "plan" finds planning. Several words: notes with all of them.' },
  { group: "Words", syntax: '"a phrase"', example: '"launch plan"', about: "The words together, in this order. Inside q=\"…\" (a smart folder or ::view), use single quotes." },
  { group: "Combine", syntax: "a AND b", example: "launch AND budget", about: "Both. Words side by side mean AND too, so launch budget is the same." },
  { group: "Combine", syntax: "a OR b", example: "budget OR costs", about: "Either one. Write OR and AND in capitals: lowercase they're just words." },
  { group: "Combine", syntax: "-term", example: "launch -draft", about: "Leave out notes that match: -word, -\"a phrase\", -tag=old, -folder=Archive." },
  { group: "Combine", syntax: "( … )", example: "(tag=work OR tag=home) launch", about: "A group. Without one, AND goes before OR: a b OR c is (a b) OR c." },
  { group: "Combine", syntax: "-( … )", example: "launch -(draft OR old)", about: "Leave out notes matching anything in the group." },
  { group: "Filters", syntax: "tag=name", example: "tag=work", about: "Tagged with it, or a tag under it (work/clients). tag=a,b needs both; tag=a|b either." },
  { group: "Filters", syntax: "folder=name", example: "folder=Projects", about: "In that folder or a folder under it. folder=A|B is either. Quote names with spaces: folder='Health and Fitness'." },
  { group: "Filters", syntax: "modified>day", example: "modified>-7d", about: "Changed after a day (<, <=, >, >= or =). A day is 2026-09-01, today, yesterday, or -7d, -2w, -1m, -1y back. modified>-7d is the last 7 days." },
  { group: "Filters", syntax: "created<day", example: "created<2026-09-01", about: "Made before a day, with the same comparisons and days as modified." },
  { group: "Order", syntax: "sort=order", example: "tag=work sort=title", about: "modified (last changed first, the default), date or oldest (by the note's own date), title or created (newest first). On its own, not inside ( )." },
];

/** The syntax help as text, for the command line. */
export function syntaxText(): string {
  const width = Math.max(...SYNTAX.map((s) => s.syntax.length));
  const out = ["Query syntax: the Notes filter, smart folders, ::view and `commonink ls --query` all read it.", ""];
  for (const group of [...new Set(SYNTAX.map((s) => s.group))]) {
    out.push(`${group}:`);
    for (const s of SYNTAX.filter((x) => x.group === group)) out.push(`  ${s.syntax.padEnd(width)}  ${s.about}`, `  ${"".padEnd(width)}  e.g. ${s.example}`);
    out.push("");
  }
  out.push('Example: (tag=work OR tag=home) -folder=Archive "launch plan" sort=created');
  return out.join("\n");
}

// ---------------------------------------------------------------- reading

type Token =
  | { t: "(" | ")" | "-" | "OR" | "AND"; at: number }
  | { t: "kv"; at: number; key: string; op: CompareOp; value: string }
  | { t: "phrase" | "word"; at: number; text: string };

/** At most this many words are searched for: more only slows the search down. */
const MAX_WORDS = 12;
const wordsOf = (s: string) => [...s.matchAll(/[\p{L}\p{N}_]+/gu)].map((m) => m[0]);
const KV = /([A-Za-z_][\w-]*)(<=|>=|<|>|=)("[^"]*"|'[^']*'|[^\s()"']+)(?=[\s)]|$)/y;

function tokenize(s: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "(" || c === ")") {
      out.push({ t: c, at: i++ });
      continue;
    }
    // A dash leaves out what follows it; a dash on its own is nothing.
    if (c === "-" && i + 1 < s.length && !/[\s)]/.test(s[i + 1])) {
      out.push({ t: "-", at: i++ });
      continue;
    }
    // A quote opens a phrase only if it closes before a space, a ")" or the end; otherwise it's part of a word.
    if (c === '"' || c === "'") {
      let k = s.indexOf(c, i + 1);
      while (k !== -1 && k + 1 < s.length && !/[\s)]/.test(s[k + 1])) k = s.indexOf(c, k + 1);
      if (k !== -1) {
        out.push({ t: "phrase", at: i, text: s.slice(i + 1, k) });
        i = k + 1;
        continue;
      }
    }
    KV.lastIndex = i;
    const m = KV.exec(s);
    if (m) {
      out.push({ t: "kv", at: i, key: m[1].toLowerCase(), op: m[2] as CompareOp, value: m[3].replace(/^(["'])(.*)\1$/, "$2") });
      i += m[0].length;
      continue;
    }
    let j = i;
    while (j < s.length && !/[\s()]/.test(s[j])) j++;
    const text = s.slice(i, j);
    out.push(text === "OR" || text === "AND" ? { t: text, at: i } : { t: "word", at: i, text });
    i = j;
  }
  return out;
}

const DAY_HELP = "use a date like 2026-09-01, today, yesterday, or -7d, -2w, -1m";

/** Read a query's words. See the top of this file, and SYNTAX. */
export function parse(q: string): Parsed {
  const tokens = tokenize(q);
  let pos = 0;
  let depth = 0;
  let words = 0;
  let sort: QuerySort | null = null;
  let error: QueryError | null = null;
  const fail = (at: number, message: string) => void (error ??= { message: `${message.replace("{at}", `at character ${at + 1}`)}`, at });
  const peek = () => tokens[pos];
  const ends = (t: Token | undefined) => !t || t.t === ")" || t.t === "OR" || t.t === "AND";

  const text = (raw: string[], phrase: boolean): Expr | null => {
    const kept = raw.slice(0, Math.max(0, MAX_WORDS - words));
    words += kept.length;
    // A word with a dash or an apostrophe in it (e-mail, don't) is its words, each needed.
    return phrase && kept.length ? { kind: "text", words: kept, phrase } : all(kept.map((w): Expr => ({ kind: "text", words: [w], phrase: false })));
  };
  // `a (b c)` is `a b c`: groups of the same kind are one, so writing an expression out reads back the same.
  const all = (items: Expr[]): Expr | null => {
    const flat = items.flatMap((e) => (e.kind === "and" ? e.items : [e]));
    return flat.length > 1 ? { kind: "and", items: flat } : (flat[0] ?? null);
  };
  const any = (items: Expr[]): Expr | null => {
    const flat = items.flatMap((e) => (e.kind === "or" ? e.items : [e]));
    return flat.length > 1 ? { kind: "or", items: flat } : (flat[0] ?? null);
  };

  /** A key=value term, or null if it's nothing to match (a sort=, or one that's wrong). `not`: it has a dash. */
  const filter = (tok: Extract<Token, { t: "kv" }>, not: boolean): Expr | null => {
    const { key, op, value, at } = tok;
    if (key === "sort") {
      if (depth > 0 || not) fail(at, "sort= goes on its own, outside ( ) and without a dash ({at})");
      else if (op !== "=" || !isSort(value)) fail(at, `"sort" is ${SORTS.slice(0, -1).join(", ")} or ${SORTS.at(-1)}, not "${value}" ({at})`);
      else sort = value;
      return null;
    }
    if (key === "tag") {
      if (op !== "=") return fail(at, `Write tag=… with "=" ({at})`), null;
      // tag=a|b is either tag; tag=a,b both. Left out (-tag=a,b), each is left out.
      const either = value.includes("|");
      const tags: Expr[] = [];
      for (const raw of value.split(either ? "|" : /[\s,+]+/).filter(Boolean)) {
        const tag = cleanTag(raw);
        if (!tag) fail(at, `"${raw}" isn't a tag: use letters, numbers, - and _, nested with / ({at})`);
        else tags.push({ kind: "tag", tag });
      }
      return either ? any(tags) : all(tags);
    }
    if (key === "folder") {
      const folders = folderList(value);
      if (op !== "=" || !folders.length) return fail(at, `Write folder=… with a folder's name, like folder=Projects ({at})`), null;
      return { kind: "folder", folders };
    }
    if (key === "modified" || key === "created") {
      if (dayFrom(value, "2000-01-01") === null) return fail(at, `"${value}" isn't a day: ${DAY_HELP} ({at})`), null;
      return { kind: "date", field: key, op, day: value };
    }
    // Any other key=value is just words, as it always was.
    return text(wordsOf(`${key} ${value}`), false);
  };

  // A dash before a multi-tag filter leaves out each tag, so it's handled where the filter is read.
  const unary = (): Expr | null => {
    const tok = peek();
    if (tok?.t !== "-") return primary(false);
    pos++;
    const next = peek();
    if (next?.t === "kv") {
      pos++;
      const f = filter(next, true);
      if (f?.kind === "and") return { kind: "and", items: f.items.map((item): Expr => ({ kind: "not", item })) };
      return f && { kind: "not", item: f };
    }
    const item = unary();
    return item && { kind: "not", item };
  };

  const primary = (not: boolean): Expr | null => {
    const tok = tokens[pos++];
    if (tok.t === "(") {
      depth++;
      const inner = or();
      if (peek()?.t === ")") pos++;
      else fail(tok.at, 'Missing ")" for the "(" {at}');
      depth--;
      if (!inner) fail(tok.at, "Nothing inside the ( ) {at}");
      return inner;
    }
    if (tok.t === "kv") return filter(tok, not);
    if (tok.t === "phrase") return text(wordsOf(tok.text), true);
    if (tok.t === "word") return text(wordsOf(tok.text), false);
    return null;
  };

  const and = (): Expr | null => {
    const items: Expr[] = [];
    let started = false;
    for (let tok = peek(); tok && tok.t !== ")" && tok.t !== "OR"; tok = peek()) {
      if (tok.t === "AND") {
        pos++;
        if (!started) fail(tok.at, "Nothing before AND {at}: put a word or filter on each side");
        else if (ends(peek())) fail(tok.at, "Nothing after AND {at}: put a word or filter on each side");
        continue;
      }
      started = true;
      const e = unary();
      if (e) items.push(e);
    }
    return all(items);
  };

  const or = (): Expr | null => {
    const items: Expr[] = [];
    const first = peek();
    const left = and();
    if (left) items.push(left);
    let empty = !left && (!first || first.t === "OR" || first.t === ")");
    while (peek()?.t === "OR") {
      const tok = tokens[pos++];
      if (empty) fail(tok.at, "Nothing before OR {at}: put a word or filter on each side");
      const next = peek();
      const right = and();
      if (right) items.push(right);
      empty = !right && (!next || next.t === "OR" || next.t === ")");
      if (empty) fail(tok.at, "Nothing after OR {at}: put a word or filter on each side");
    }
    return any(items);
  };

  const top: Expr[] = [];
  while (pos < tokens.length) {
    const e = or();
    if (e) top.push(e);
    const tok = peek();
    if (tok?.t === ")") {
      fail(tok.at, 'There\'s no "(" for the ")" {at}');
      pos++;
    }
  }
  return { expr: all(top), sort, error };
}

/** The folders in a `folder=` value: `A|B` is either; slashes at the ends don't count. */
export const folderList = (value: string) =>
  value
    .split("|")
    .map((f) => f.trim().replace(/^\/+|\/+$/g, ""))
    .filter(Boolean);

/** Is a note's path (its home, outside the archive) in one of these folders, or under one? */
export const inFolders = (path: string, folders: string[]) => folders.some((f) => path.startsWith(`${f}/`));

// ---------------------------------------------------------------- matching

/** Does a note match? `test` says whether it matches one term; and, or and not are done here. */
export function evaluate(expr: Expr | null, test: (t: Term) => boolean): boolean {
  if (!expr) return true;
  if (expr.kind === "and") return expr.items.every((e) => evaluate(e, test));
  if (expr.kind === "or") return expr.items.some((e) => evaluate(e, test));
  if (expr.kind === "not") return !evaluate(expr.item, test);
  return test(expr);
}

/** Every term in an expression, left out or not. */
export function termsOf(expr: Expr | null): Term[] {
  if (!expr) return [];
  if (expr.kind === "and" || expr.kind === "or") return expr.items.flatMap(termsOf);
  if (expr.kind === "not") return termsOf(expr.item);
  return [expr];
}

/** The words a note is found by, for marking them: every word searched for that isn't left out. */
export function textWords(expr: Expr | null, not = false): string[] {
  if (!expr) return [];
  if (expr.kind === "and" || expr.kind === "or") return [...new Set(expr.items.flatMap((e) => textWords(e, not)))];
  if (expr.kind === "not") return textWords(expr.item, !not);
  return expr.kind === "text" && !not ? expr.words : [];
}

const ftsGroup = (s: string) => (/^"[^"]*"\*?$/.test(s) ? s : `(${s})`);

/**
 * A full-text (FTS5) query for the words in an expression, or null if it has none to search for.
 * Filters (tags, folders, dates) are left out: they aren't in the text. FTS5 can't search for only
 * what's missing, so `-word` needs something beside it to leave it out of.
 */
export function toFts(expr: Expr | null): string | null {
  if (!expr) return null;
  if (expr.kind === "text") return expr.phrase ? `"${expr.words.join(" ")}"` : expr.words.map((w) => `"${w}"*`).join(" ");
  if (expr.kind === "or") {
    const parts = expr.items.map(toFts).filter((s): s is string => !!s);
    return parts.length ? (parts.length > 1 ? parts.map(ftsGroup).join(" OR ") : parts[0]) : null;
  }
  if (expr.kind === "and") {
    const pos = expr.items.filter((e) => e.kind !== "not").map(toFts).filter((s): s is string => !!s);
    const neg = expr.items.flatMap((e) => (e.kind === "not" ? [toFts(e.item)] : [])).filter((s): s is string => !!s);
    if (!pos.length) return null;
    const both = pos.length > 1 ? pos.map(ftsGroup).join(" ") : pos[0];
    return neg.length ? `${ftsGroup(both)} NOT ${ftsGroup(neg.length > 1 ? neg.map(ftsGroup).join(" OR ") : neg[0])}` : both;
  }
  return null;
}

// ---------------------------------------------------------------- writing

const quoted = (v: string) => (/^[^\s()"'|]+$/.test(v) ? v : `'${v.replace(/'/g, "")}'`);

/** An expression as text, reading back the same (parse(format(e)).expr equals e). */
export function format(expr: Expr | null): string {
  if (!expr) return "";
  switch (expr.kind) {
    case "text":
      return expr.phrase ? `"${expr.words.join(" ")}"` : expr.words.join(" ");
    case "tag":
      return `tag=${expr.tag}`;
    case "folder":
      return `folder=${expr.folders.length > 1 ? `'${expr.folders.join("|")}'` : quoted(expr.folders[0])}`;
    case "date":
      return `${expr.field}${expr.op}${expr.day}`;
    case "not":
      return expr.item.kind === "and" || expr.item.kind === "or" ? `-(${format(expr.item)})` : `-${format(expr.item)}`;
    case "and":
      return expr.items.map((e) => (e.kind === "or" ? `(${format(e)})` : format(e))).join(" ");
    case "or":
      return expr.items.map(format).join(" OR ");
  }
}

/**
 * Texts that must all match, as one: `a OR b` and `c` are `(a OR b) c`, not `a OR b c` (which is
 * a OR (b c)). A text with a mistake in it is kept as written.
 */
export function andJoin(...texts: Array<string | undefined>): string {
  const parts = texts.map((t) => t?.trim() ?? "").filter(Boolean);
  if (parts.length < 2) return parts[0] ?? "";
  return parts
    .map((t) => {
      const p = parse(t);
      if (p.error || p.expr?.kind !== "or") return t;
      return `(${format(p.expr)})${p.sort ? ` sort=${p.sort}` : ""}`;
    })
    .join(" ");
}

// ---------------------------------------------------------------- days

/**
 * The day (YYYY-MM-DD) a date filter names, counted from `today`: a date, `today`, `yesterday`, or
 * so many days, weeks, months or years back (`-7d`, `-2w`, `-1m`, `-1y`; `+3d` is ahead). Null if
 * it names none.
 */
export function dayFrom(value: string, today: string): string | null {
  const v = value.trim().toLowerCase();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return new Date(`${v}T00:00:00Z`).toISOString().startsWith(v) ? v : null;
  if (v === "today") return today;
  if (v === "yesterday") return shift(today, "d", -1);
  const m = v.match(/^([-+])(\d{1,4})([dwmy])$/);
  return m ? shift(today, m[3] as "d" | "w" | "m" | "y", (m[1] === "-" ? -1 : 1) * Number(m[2])) : null;
}

function shift(day: string, unit: "d" | "w" | "m" | "y", n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  if (unit === "d" || unit === "w") d.setUTCDate(d.getUTCDate() + n * (unit === "w" ? 7 : 1));
  else {
    // A month back from March 31 is the last day of February, not March 3.
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + n * (unit === "y" ? 12 : 1));
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(Number(day.slice(8, 10)), last));
  }
  return d.toISOString().slice(0, 10);
}

/** Whether a note's day passes a date filter, counted from `today`. */
export function dayPasses(noteDay: string, f: { op: CompareOp; day: string }, today: string): boolean {
  const c = noteDay.localeCompare(dayFrom(f.day, today)!);
  return f.op === "<" ? c < 0 : f.op === "<=" ? c <= 0 : f.op === ">" ? c > 0 : f.op === ">=" ? c >= 0 : c === 0;
}
