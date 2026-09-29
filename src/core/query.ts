// A note query: which notes a list shows. It's the same few keys everywhere a list of notes is
// asked for (a ::query widget, a smart folder, the Notes filter bar, an agent), written the way the
// widget writes them: `q="launch plan" folder=Projects tag=work sort=title limit=5`. Quire.feed
// runs it. No Node imports: the web app uses this too.
import { parseAttrs, serializeAttrs } from "./directive.ts";
import { cleanTag } from "./tags.ts";

export interface NoteQuery {
  /** Words to find (full-text, prefix matching). */
  q?: string;
  folder?: string;
  /** This tag or any tag under it. */
  tag?: string;
  sort?: "modified" | "title";
  /** At most this many (a widget's length; a list pages through the rest). */
  limit?: number;
}

const KEYS = ["q", "folder", "tag", "sort", "limit"] as const;
const LIMIT = /^[1-9]\d{0,3}$/;

/**
 * The query in a set of args, leaving out other keys (a widget's label and id) and values that
 * don't fit. Tidied the way the Notes filters hold it (`tag=#Plan` is `tag=Plan`), so the two compare.
 */
export function toQuery(args: Record<string, string>): NoteQuery {
  const out: NoteQuery = {};
  const folder = args.folder?.replace(/^\/+|\/+$/g, "");
  const tag = args.tag ? cleanTag(args.tag) : null;
  if (args.q) out.q = args.q;
  if (folder) out.folder = folder;
  if (tag) out.tag = tag;
  if (args.sort === "modified" || args.sort === "title") out.sort = args.sort;
  if (LIMIT.test(args.limit ?? "")) out.limit = Number(args.limit);
  return out;
}

export const parseQuery = (src: string) => toQuery(parseAttrs(src));

/** A query as text. Sorting by modified is the default, so it's left out. */
export function formatQuery(q: NoteQuery): string {
  return serializeAttrs({ q: q.q ?? "", folder: q.folder ?? "", tag: q.tag ?? "", sort: q.sort === "title" ? "title" : "", limit: q.limit ? String(q.limit) : "" });
}

/** What's wrong with a query someone wants to save, or null. Stricter than toQuery, which drops what it can't use. */
export function queryProblem(src: string): string | null {
  if ((src.match(/"/g)?.length ?? 0) % 2) return "A quote isn't closed";
  const bare = src.match(/(?:^|\s)([\w-]+)(?=\s|$)/);
  if (bare) return `Give "${bare[1]}" a value, like ${bare[1] === "tag" ? "tag=work" : `${bare[1]}=…`}`;
  const args = parseAttrs(src);
  for (const [k, v] of Object.entries(args)) {
    if (!(KEYS as readonly string[]).includes(k)) return `Unknown query key "${k}": use ${KEYS.slice(0, -1).join(", ")} or ${KEYS.at(-1)}`;
    if (k === "sort" && v !== "modified" && v !== "title") return `"sort" is modified or title, not "${v}"`;
    if (k === "limit" && !LIMIT.test(v)) return `"limit" is a whole number above 0, not "${v}"`;
    if (k === "tag" && !cleanTag(v)) return `"${v}" isn't a tag: use letters, numbers, - and _, nested with /`;
  }
  return null;
}
