// A note query: which notes a list shows. It's the same few keys everywhere a list of notes is
// asked for (a ::query widget, a smart folder, the Notes filter bar, an agent), written the way the
// widget writes them: `q="launch plan" folder=Projects tag=work sort=title limit=5`. Vault.feed
// runs it. No Node imports: the web app uses this too.
import { serializeAttrs } from "./directive.ts";
import { cleanTag } from "./tags.ts";

export type QuerySort = "modified" | "date" | "oldest" | "title";

export interface NoteQuery {
  /** Words to find (full-text, prefix matching). */
  q?: string;
  folder?: string;
  /** This tag or any tag under it. Several, joined with commas (`work,plan`): a note needs each one. */
  tag?: string;
  /**
   * modified: last changed first (the default). date: the note's own date first (a `date:` or
   * `created:` in its frontmatter, else a YYYY-MM-DD in its name, else when it last changed), newest
   * first; oldest: the same, oldest first. title: A to Z.
   */
  sort?: QuerySort;
  /** At most this many (a widget's length; a list pages through the rest). */
  limit?: number;
}

const KEYS = ["q", "folder", "tag", "sort", "limit"] as const;
const SORTS: readonly QuerySort[] = ["modified", "date", "oldest", "title"];
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
  if (args.q) out.q = args.q;
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
  let bare: string | null = null;
  // The key=value pair, or the plain word, that a following plain word joins.
  let open: string | null = null;
  for (const m of src.matchAll(/([\w-]+)=(?:"([^"]*)"|'([^']*)'|([^\s"']+))|([^\s"']+)/g)) {
    if (m[5] !== undefined) {
      const word = m[5];
      if (open && !(KEYS as readonly string[]).includes(word.replace(/=.*/, ""))) {
        if (open === "tag") tags.push(word);
        else args[open] += ` ${word}`;
      } else {
        bare ??= word.match(/^[\w-]+/)?.[0] ?? word;
        open = null;
      }
      continue;
    }
    const value = m[2] ?? m[3] ?? m[4];
    if (m[1] === "tag") tags.push(value);
    else args[m[1]] = value;
    open = m[4] !== undefined && (m[1] === "q" || m[1] === "folder" || m[1] === "tag") ? m[1] : null;
  }
  if (tags.length) args.tag = tags.join(",");
  return { args, bare };
}

export const parseQuery = (src: string) => toQuery(readQuery(src).args);

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
    if (k === "tag") {
      const wrong = tagList(v).find((t) => !cleanTag(t));
      if (wrong !== undefined || !tagList(v).length) return `"${wrong ?? v}" isn't a tag: use letters, numbers, - and _, nested with /`;
    }
  }
  return null;
}
