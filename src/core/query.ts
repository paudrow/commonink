// A note query: which notes a list shows. It's the same few keys everywhere a list of notes is
// asked for (a notes ::view, a smart folder, the Notes filter bar, an agent), written the way the
// widget writes them: `q="launch plan" folder=Projects tag=work sort=title limit=5`. Vault.feed
// runs it. The words in `q` have a grammar of their own (queryGrammar.ts): AND, OR, -, ( ),
// "a phrase", and filters among the words (`tag=x`, `folder=x`, `modified>-7d`). No Node imports:
// the web app uses this too.
import { serializeAttrs } from "./directive.ts";
import { andJoin, folderList as foldersIn, isSort, parse, SORTS, type QuerySort } from "./queryGrammar.ts";
import { cleanTag } from "./tags.ts";

export { dayFrom, dayPasses, isSort, type QuerySort } from "./queryGrammar.ts";

export interface NoteQuery {
  /** Words to find (full-text, prefix matching), with AND, OR, -, ( ) and filters among them (see queryGrammar.ts). */
  q?: string;
  /** This folder and the folders in it. Several, joined with | (`Projects|Areas`): a note in any of them. */
  folder?: string;
  /** This tag or any tag under it. Several, joined with commas (`work,plan`): a note needs each one, or with match=any, one of them. */
  tag?: string;
  /** With several tags: all (the default) or any. */
  match?: "all" | "any";
  /**
   * modified: last changed first (the default). date: the note's own date first (a `date:` or
   * `created:` in its frontmatter, else a YYYY-MM-DD in its name, else when it last changed), newest
   * first; oldest: the same, oldest first. title: A to Z. created: newest note first (see Vault's createdOf).
   */
  sort?: QuerySort;
  /** At most this many (a widget's length; a list pages through the rest). */
  limit?: number;
}

const KEYS = ["q", "folder", "tag", "match", "sort", "limit"] as const;
/**
 * Filters that can also be written as keys of their own (`::view{modified>-7d -tag=draft}`). They
 * live in `q` with the words, so a query has one place for them however it was written.
 */
const IN_Q = ["modified", "created", "-tag", "-folder"] as const;
const LIMIT = /^[1-9]\d{0,3}$/;

/** The folders in a `folder` value: `Projects|Areas` names two, tidied (`/Projects/` is `Projects`). */
export const folderList = (folder: string | undefined): string[] => foldersIn(folder ?? "");

/** The tags in a `tag` value: `work,plan`, `work plan` and `#work + #plan` all name two. */
export const tagList = (tag: string | undefined): string[] => (tag ?? "").split(/[\s,+]+/).filter(Boolean);

/**
 * The query in a set of args, leaving out other keys (a widget's label and id) and values that
 * don't fit. Tidied the way the Notes filters hold it (`tag=#Plan` is `tag=Plan`), so the two compare.
 */
export function toQuery(args: Record<string, string>): NoteQuery {
  const out: NoteQuery = {};
  // `folder=A|B` is either folder.
  const folder = [...new Set(folderList(args.folder))].join("|");
  const tags: string[] = [];
  for (const raw of tagList(args.tag)) {
    const t = cleanTag(raw);
    if (t && !tags.some((x) => x.toLowerCase() === t.toLowerCase())) tags.push(t);
  }
  // Joined so each keeps its meaning: `q="a OR b"` with `modified>-7d` is `(a OR b) modified>-7d`.
  const q = andJoin(args.q, ...IN_Q.flatMap((k) => (args[k] ? [filterText(k, args[k])] : [])));
  if (q) out.q = q;
  if (folder) out.folder = folder;
  if (tags.length) out.tag = tags.join(",");
  if (args.match === "any" && tags.length > 1) out.match = "any";
  if (isSort(args.sort)) out.sort = args.sort;
  if (LIMIT.test(args.limit ?? "")) out.limit = Number(args.limit);
  return out;
}

/**
 * A query's text as args. Forgiving the way people (and agents) write one: `tag=a tag=b` keeps both
 * tags, and an unquoted value runs on over plain words, so `folder=Health and Fitness` is one folder.
 * `bare` is a word that belongs to no key (`tag folder=Ideas`), for queryProblem to point at.
 * A ' quotes only at the start of a value, so `folder=Bob's Notes` keeps its apostrophe; `unclosed`
 * is a value that opens a ' and never closes it (`q='abc`).
 */
function readQuery(src: string): { args: Record<string, string>; bare: string | null; unclosed: boolean } {
  const args: Record<string, string> = {};
  const tags: string[] = [];
  const filters: string[] = [];
  let bare: string | null = null;
  let unclosed = false;
  // The key=value pair, or the plain word, that a following plain word joins.
  let open: string | null = null;
  for (const m of src.matchAll(/([\w-]+)(<=|>=|<|>|=)(?:"([^"]*)"|'([^']*)'|([^\s"]+))|([^\s"]+)/g)) {
    if (m[6] !== undefined) {
      const word = m[6];
      if (open && !(KEYS as readonly string[]).includes(word.replace(/=.*/, ""))) {
        if (open === "tag") tags.push(word);
        else args[open] += ` ${word}`;
      } else {
        // A quoted word (`'abc'`) is named without its quotes; a ( or other mark stays, for queryProblem to point at.
        bare ??= word.match(/^'?([\w-]+)/)?.[1] ?? word;
        open = null;
      }
      continue;
    }
    const value = m[3] ?? m[4] ?? m[5];
    if (m[5]?.startsWith("'")) unclosed = true;
    // A filter that lives in `q` joins the words there, so it can be given twice (`modified>-30d modified<-7d`).
    if ((IN_Q as readonly string[]).includes(m[1])) filters.push(filterText(m[1], m[2] === "=" ? value : `${m[2]}${value}`));
    else if (m[2] !== "=") args[m[1]] = `${m[2]}${value}`;
    else if (m[1] === "tag") tags.push(value);
    // `folder=a folder=b` is either folder, as `folder="a|b"` is.
    else if (m[1] === "folder" && args.folder) args.folder += `|${value}`;
    else args[m[1]] = value;
    open = m[5] !== undefined && (m[1] === "q" || m[1] === "folder" || m[1] === "tag") ? m[1] : null;
  }
  if (tags.length) args.tag = tags.join(",");
  if (filters.length) args.q = andJoin(args.q, ...filters);
  return { args, bare, unclosed };
}

export const parseQuery = (src: string) => toQuery(readQuery(src).args);

/** A filter key and its value as `q` holds it: `modified` and `>-7d` are `modified>-7d`, `-tag` and `x` are `-tag=x`. */
const filterText = (key: string, value: string) => `${key}${/^(<=|>=|<|>)/.test(value) ? "" : "="}${value}`;

/** A query as text. Sorting by modified is the default, so it's left out. */
export function formatQuery(q: NoteQuery): string {
  return serializeAttrs({ q: q.q ?? "", folder: q.folder ?? "", tag: q.tag ?? "", match: q.match === "any" ? "any" : "", sort: q.sort && q.sort !== "modified" ? q.sort : "", limit: q.limit ? String(q.limit) : "" });
}

/** What's wrong with a query someone wants to save, or null. Stricter than toQuery, which drops what it can't use. */
export function queryProblem(src: string): string | null {
  if ((src.match(/"/g)?.length ?? 0) % 2) return "A quote isn't closed";
  const { args, bare, unclosed } = readQuery(src);
  if (unclosed) return "A quote isn't closed";
  // Words, groups and OR go in q: `q="(a OR b) -c"`.
  if (bare && (!/^\w[\w-]*$/.test(bare) || bare === "OR" || bare === "AND")) return `Put words, ( ) and OR inside q="…", like q="(budget OR costs) -draft"`;
  if (bare) return `Give "${bare}" a value, like ${bare === "tag" ? "tag=work" : `${bare}=…`}`;
  for (const [k, v] of Object.entries(args)) {
    if (!(KEYS as readonly string[]).includes(k)) return `Unknown query key "${k}": use ${KEYS.slice(0, -1).join(", ")} or ${KEYS.at(-1)}`;
    if (k === "sort" && !isSort(v)) return `"sort" is ${SORTS.slice(0, -1).join(", ")} or ${SORTS.at(-1)}, not "${v}"`;
    if (k === "match" && v !== "all" && v !== "any") return `"match" is all or any, not "${v}"`;
    if (k === "limit" && !LIMIT.test(v)) return `"limit" is a whole number above 0, not "${v}"`;
    if (k === "q" && parse(v).error) return parse(v).error!.message;
    if (k === "tag") {
      const wrong = tagList(v).find((t) => !cleanTag(t));
      if (wrong !== undefined || !tagList(v).length) return `"${wrong ?? v}" isn't a tag: use letters, numbers, - and _, nested with /`;
    }
  }
  return null;
}

