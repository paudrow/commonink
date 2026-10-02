// A note query: which notes a list shows. It's the same few keys everywhere a list of notes is
// asked for (a ::query widget, a smart folder, the Notes filter bar, an agent), written the way the
// widget writes them: `q="launch plan" folder=Projects tag=work sort=title limit=5`. Vault.feed
// runs it. The words in `q` have a small grammar of their own (see parseSearch): `-word`, `OR`,
// "a phrase", `modified>-7d`, `created<2026-09-01`, `tag=x` and `-tag=x`. No Node imports: the web
// app uses this too.
import { serializeAttrs } from "./directive.ts";
import { cleanTag } from "./tags.ts";

export type QuerySort = "modified" | "date" | "oldest" | "title" | "created";

export interface NoteQuery {
  /** Words to find (full-text, prefix matching), and filters written among them (see parseSearch). */
  q?: string;
  folder?: string;
  /** This tag or any tag under it. Several, joined with commas (`work,plan`): a note needs each one. */
  tag?: string;
  /**
   * modified: last changed first (the default). date: the note's own date first (a `date:` or
   * `created:` in its frontmatter, else a YYYY-MM-DD in its name, else when it last changed), newest
   * first; oldest: the same, oldest first. title: A to Z. created: newest note first (see Vault's createdOf).
   */
  sort?: QuerySort;
  /** At most this many (a widget's length; a list pages through the rest). */
  limit?: number;
}

const KEYS = ["q", "folder", "tag", "sort", "limit"] as const;
const SORTS: readonly QuerySort[] = ["modified", "date", "oldest", "title", "created"];
/**
 * Filters that can also be written as keys of their own (`::query{modified>-7d -tag=draft}`). They
 * live in `q` with the words, so a query has one place for them however it was written.
 */
const IN_Q = ["modified", "created", "-tag"] as const;
const LIMIT = /^[1-9]\d{0,3}$/;

export const isSort = (s: string | undefined): s is QuerySort => (SORTS as readonly string[]).includes(s ?? "");

/** The tags in a `tag` value: `work,plan`, `work plan` and `#work + #plan` all name two. */
export const tagList = (tag: string | undefined): string[] => (tag ?? "").split(/[\s,+]+/).filter(Boolean);

/**
 * The query in a set of args, leaving out other keys (a widget's label and id) and values that
 * don't fit. Tidied the way the Notes filters hold it (`tag=#Plan` is `tag=Plan`), so the two compare.
 */
export function toQuery(args: Record<string, string>): NoteQuery {
  const out: NoteQuery = {};
  const folder = args.folder?.trim().replace(/^\/+|\/+$/g, "");
  const tags: string[] = [];
  for (const raw of tagList(args.tag)) {
    const t = cleanTag(raw);
    if (t && !tags.some((x) => x.toLowerCase() === t.toLowerCase())) tags.push(t);
  }
  const q = [args.q?.trim(), ...IN_Q.flatMap((k) => (args[k] ? [filterText(k, args[k])] : []))].filter(Boolean).join(" ");
  if (q) out.q = q;
  if (folder) out.folder = folder;
  if (tags.length) out.tag = tags.join(",");
  if (isSort(args.sort)) out.sort = args.sort;
  if (LIMIT.test(args.limit ?? "")) out.limit = Number(args.limit);
  return out;
}

/**
 * A query's text as args. Forgiving the way people (and agents) write one: `tag=a tag=b` keeps both
 * tags, and an unquoted value runs on over plain words, so `folder=Health and Fitness` is one folder.
 * `bare` is a word that belongs to no key (`tag folder=Ideas`), for queryProblem to point at.
 */
function readQuery(src: string): { args: Record<string, string>; bare: string | null } {
  const args: Record<string, string> = {};
  const tags: string[] = [];
  const filters: string[] = [];
  let bare: string | null = null;
  // The key=value pair, or the plain word, that a following plain word joins.
  let open: string | null = null;
  for (const m of src.matchAll(/([\w-]+)(<=|>=|<|>|=)(?:"([^"]*)"|'([^']*)'|([^\s"']+))|([^\s"']+)/g)) {
    if (m[6] !== undefined) {
      const word = m[6];
      if (open && !(KEYS as readonly string[]).includes(word.replace(/=.*/, ""))) {
        if (open === "tag") tags.push(word);
        else args[open] += ` ${word}`;
      } else {
        bare ??= word.match(/^[\w-]+/)?.[0] ?? word;
        open = null;
      }
      continue;
    }
    const value = m[3] ?? m[4] ?? m[5];
    // A filter that lives in `q` joins the words there, so it can be given twice (`modified>-30d modified<-7d`).
    if ((IN_Q as readonly string[]).includes(m[1])) filters.push(filterText(m[1], m[2] === "=" ? value : `${m[2]}${value}`));
    else if (m[2] !== "=") args[m[1]] = `${m[2]}${value}`;
    else if (m[1] === "tag") tags.push(value);
    else args[m[1]] = value;
    open = m[5] !== undefined && (m[1] === "q" || m[1] === "folder" || m[1] === "tag") ? m[1] : null;
  }
  if (tags.length) args.tag = tags.join(",");
  if (filters.length) args.q = [args.q, ...filters].filter(Boolean).join(" ");
  return { args, bare };
}

export const parseQuery = (src: string) => toQuery(readQuery(src).args);

/** A filter key and its value as `q` holds it: `modified` and `>-7d` are `modified>-7d`, `-tag` and `x` are `-tag=x`. */
const filterText = (key: string, value: string) => `${key}${/^(<=|>=|<|>)/.test(value) ? "" : "="}${value}`;

/** A query as text. Sorting by modified is the default, so it's left out. */
export function formatQuery(q: NoteQuery): string {
  return serializeAttrs({ q: q.q ?? "", folder: q.folder ?? "", tag: q.tag ?? "", sort: q.sort && q.sort !== "modified" ? q.sort : "", limit: q.limit ? String(q.limit) : "" });
}

/** What's wrong with a query someone wants to save, or null. Stricter than toQuery, which drops what it can't use. */
export function queryProblem(src: string): string | null {
  if ((src.match(/"/g)?.length ?? 0) % 2) return "A quote isn't closed";
  const { args, bare } = readQuery(src);
  if (bare) return `Give "${bare}" a value, like ${bare === "tag" ? "tag=work" : `${bare}=…`}`;
  for (const [k, v] of Object.entries(args)) {
    if (!(KEYS as readonly string[]).includes(k)) return `Unknown query key "${k}": use ${KEYS.slice(0, -1).join(", ")} or ${KEYS.at(-1)}`;
    if (k === "sort" && !isSort(v)) return `"sort" is ${SORTS.slice(0, -1).join(", ")} or ${SORTS.at(-1)}, not "${v}"`;
    if (k === "limit" && !LIMIT.test(v)) return `"limit" is a whole number above 0, not "${v}"`;
    if (k === "q" && parseSearch(v).problem) return parseSearch(v).problem;
    if (k === "tag") {
      const wrong = tagList(v).find((t) => !cleanTag(t));
      if (wrong !== undefined || !tagList(v).length) return `"${wrong ?? v}" isn't a tag: use letters, numbers, - and _, nested with /`;
    }
  }
  return null;
}

// ---------------------------------------------------------------- the words in q

/** A word (found as a prefix: `plan` finds "planning") or an exact phrase. */
export interface SearchTerm {
  words: string[];
  phrase: boolean;
}

/** A date filter: `modified>-7d` is { field: "modified", op: ">", day: "-7d" }. */
export interface DateFilter {
  field: "modified" | "created";
  op: "<" | "<=" | ">" | ">=" | "=";
  day: string;
}

/** The words in `q`, read: what a note must contain, what it mustn't, and the filters among them. */
export interface Search {
  /** Every clause must match; a clause matches if any of its terms does (`a OR b` is one clause). */
  all: SearchTerm[][];
  /** No term here may match (`-word`, `-"a phrase"`). */
  none: SearchTerm[];
  /** Tags a note must carry (or a tag under each), and tags it mustn't. */
  tags: string[];
  notTags: string[];
  dates: DateFilter[];
  /** What's wrong with a filter in it, or null. */
  problem: string | null;
}

const MAX_WORDS = 12;
const wordsOf = (s: string) => [...s.matchAll(/[\p{L}\p{N}_]+/gu)].map((m) => m[0]);
const emptySearch = (): Search => ({ all: [], none: [], tags: [], notTags: [], dates: [], problem: null });

/**
 * Read the words in a query's `q`. Plain words must all be in a note (found as prefixes), the way
 * they always were. On top of that:
 *   -word, -"a phrase"          leave out notes with it
 *   a OR b                      either one (OR in capitals)
 *   "exact phrase", 'phrase'    the words together, in order (a ::query writes `q="'a phrase' b"`)
 *   tag=x, -tag=x               with, or without, a tag (and the tags under it); `-tag=a,b` leaves out both
 *   modified>-7d, created<2026-09-01, modified>=yesterday
 *                               by day: a date, today, yesterday, or days, weeks, months or years
 *                               back (-7d, -2w, -1m, -1y). `modified>-7d` is the last seven days.
 * Any other `key=value` is just words, as it always was.
 */
export function parseSearch(q: string): Search {
  const out = emptySearch();
  let count = 0;
  const take = (words: string[]) => {
    const kept = words.slice(0, Math.max(0, MAX_WORDS - count));
    count += kept.length;
    return kept;
  };
  // Whether the clause before waits for the other side of an OR.
  let or = false;
  const tokens = [...q.matchAll(/(-?)(?:([\w-]+)(<=|>=|<|>|=)("[^"]*"|'[^']*'|[^\s"']+)(?!\S)|"([^"]*)"(?!\S)|'([^']*)'(?!\S)|\S+)/g)];
  tokens.forEach((m, i) => {
    const not = m[1] === "-";
    const key = m[2]?.toLowerCase();
    if (key !== undefined) {
      const op = m[3] as DateFilter["op"];
      const value = m[4].replace(/^["']|["']$/g, "");
      if (key === "tag" && op === "=") {
        for (const t of value.split(/[\s,+]+/).filter(Boolean)) {
          const tag = cleanTag(t);
          if (!tag) out.problem ??= `"${t}" isn't a tag: use letters, numbers, - and _, nested with /`;
          else (not ? out.notTags : out.tags).push(tag);
        }
        return;
      }
      if ((key === "modified" || key === "created") && !not) {
        if (dayFrom(value, "2000-01-01") === null) out.problem ??= `"${value}" isn't a day: use a date like 2026-09-01, today, yesterday, or -7d, -2w, -1m`;
        else out.dates.push({ field: key, op, day: value });
        return;
      }
    }
    const phrase = m[5] !== undefined || m[6] !== undefined;
    if (m[0] === "OR") {
      or = out.all.length > 0 && i < tokens.length - 1;
      if (or) return;
    }
    const words = take(wordsOf(phrase ? (m[5] ?? m[6])! : m[0].slice(m[1].length)));
    if (!words.length) return;
    if (not) out.none.push({ words, phrase: words.length > 1 });
    // The other side of an OR is one term: a word with a dash in it stays together.
    else if (or) out.all.at(-1)!.push({ words, phrase: words.length > 1 });
    else if (phrase) out.all.push([{ words, phrase: true }]);
    else for (const w of words) out.all.push([{ words: [w], phrase: false }]);
    or = false;
  });
  return out;
}

/** The words a note's matching lines are found by: every word searched for. */
export const searchWords = (s: Search) => [...new Set(s.all.flat().flatMap((t) => t.words))];

/**
 * A full-text (FTS5) query for the clauses that must match, or "" if none must. A word is a prefix,
 * a phrase is exact. `none` is the caller's: FTS5 can't search for only what's missing.
 */
export function ftsQuery(s: Pick<Search, "all">): string {
  const term = (t: SearchTerm) => (t.phrase ? `"${t.words.join(" ")}"` : `"${t.words[0]}"*`);
  return s.all.map((c) => (c.length > 1 ? `(${c.map(term).join(" OR ")})` : term(c[0]))).join(" ");
}

/** An FTS5 query matching any of these terms, or "". */
export const ftsAny = (terms: SearchTerm[]) => ftsQuery({ all: terms.length ? [terms] : [] });

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
export function dayPasses(noteDay: string, f: DateFilter, today: string): boolean {
  const c = noteDay.localeCompare(dayFrom(f.day, today)!);
  return f.op === "<" ? c < 0 : f.op === "<=" ? c <= 0 : f.op === ">" ? c > 0 : f.op === ">=" ? c >= 0 : c === 0;
}
