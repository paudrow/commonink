//   ::view   ::view{folder=Projects limit=5 label="Active projects"}   ::view{tag=meeting sort=title}   ::view{q="mcp"}
//   ::view{folder=Projects layout=table cols=status,due}
// A ::view's list of notes (its first kind, so no `show`): notes matching a search, folder or tag.
// Updates as notes (and agents) change. layout=table shows it as a table: the note's title, then a
// column per frontmatter property in `cols` (and tags, folder or modified). Read-only for now.
import { api, type FeedItem } from "../api.ts";
import { el, escapeHtml, icon, markTerms, timeAgo } from "../dom.ts";
import { onVaultChange } from "../events.ts";
import type { Field, WidgetSpec } from "./core.ts";
import { formatQuery, toQuery } from "../../../src/core/query.ts";
import { parse, textWords } from "../../../src/core/queryGrammar.ts";
import { sideClick } from "../panes.ts";
import { queryHelpLink } from "../queryHelp.ts";

const prevent = (e: Event) => e.preventDefault();

/** Table columns every note has, not frontmatter properties. */
const BUILT_IN = ["tags", "folder", "modified"];

/**
 * The note query's fields, as a notes view's settings form shows them. (The smart folder
 * editor has rows of its own, over the same query text.)
 */
export const QUERY_FIELDS: Field[] = [
  {
    key: "q",
    label: "Matching",
    type: "text",
    placeholder: "Words, a OR b, ( ), -leave out, tag=x, modified>-7d",
    check: (v) => parse(v).error?.message ?? null,
    help: queryHelpLink,
  },
  { key: "folder", label: "Folder", type: "text", placeholder: "e.g. Projects", picker: "folder" },
  { key: "tag", label: "Tags", type: "text", placeholder: "e.g. meeting (includes meeting/…), or meeting, client for both", picker: "tag" },
  { key: "match", label: "Combine", type: "select", options: [["all", "Match all of them"], ["any", "Match any of them"]] },
  { key: "sort", label: "Sort", type: "select", options: [["modified", "Recently changed"], ["date", "Newest by date"], ["oldest", "Oldest by date"], ["title", "By title"], ["created", "Newest created"]] },
];

export const query: WidgetSpec = {
  name: "query",
  title: "Notes",
  icon: "feed",
  hint: "Live list or table of notes by search, folder, tag or property",
  keywords: "query list notes dashboard recent folder tag search",
  defaults: { limit: "6" },
  // Filters written as keys of their own (modified>-7d, -tag=x) show in Matching, so saving the form keeps them.
  formArgs: (args) => ({ ...args, q: toQuery(args).q ?? "" }),
  configAction: {
    label: "Save as smart folder",
    icon: "folderSearch",
    run: (args, env, anchor) => env.saveSmartFolder(formatQuery(toQuery(args)), args.label ?? "", anchor),
  },
  fields: [
    { key: "label", label: "Title", type: "text", placeholder: "Active projects, Meetings…" },
    ...QUERY_FIELDS,
    { key: "layout", label: "Layout", type: "select", options: [["list", "List"], ["table", "Table"]] },
    { key: "cols", label: "Columns", type: "text", placeholder: "For a table: status, due (properties), tags, folder, modified" },
    { key: "limit", label: "How many", type: "text", placeholder: "6" },
  ],

  mount(body, env) {
    let alive = true;
    const list = el("div", { class: "qq-list" });
    const foot = el("div", { class: "qq-foot" });
    body.append(list, foot);
    const query = toQuery(env.args);
    const limit = Math.min(query.limit ?? 6, 50);
    const table = env.args.layout === "table";
    const cols = table ? [...new Set((env.args.cols ?? "").split(",").map((c) => c.trim()).filter(Boolean))].slice(0, 20) : [];
    // Properties the index has; tags, folder and modified come with every note.
    const props = cols.filter((c) => !BUILT_IN.includes(c.toLowerCase()));
    const problem = parse(query.q ?? "").error?.message;

    async function load() {
      const page = await api.feed({ ...query, scope: "active", limit: limit + 1, cols: props.join(",") || undefined }).catch(() => null);
      if (!alive || !page) return;
      const items = page.items.filter((i) => i.path !== env.note).slice(0, limit); // a dashboard shouldn't list itself
      const total = page.total - (page.items.some((i) => i.path === env.note) ? 1 : 0);
      if (!items.length) list.replaceChildren(el("div", { class: "qt-empty" }, "No notes match."));
      else list.replaceChildren(...(table ? [tableOf(items)] : items.map(row)));
      foot.textContent = total > items.length ? `${items.length} of ${total} notes` : `${total} note${total === 1 ? "" : "s"}`;
      // A mistake in the query (a "(" never closed) is said here; the list is the best reading of the rest.
      if (problem) foot.textContent = problem;
      foot.classList.toggle("is-error", !!problem);
      env.remeasure();
    }

    function tableOf(items: FeedItem[]) {
      return el(
        "div",
        { class: "qq-table-wrap" },
        el(
          "table",
          { class: "qq-table" },
          el("thead", {}, el("tr", {}, el("th", { scope: "col" }, "Note"), ...cols.map((c) => el("th", { scope: "col" }, c)))),
          el(
            "tbody",
            {},
            ...items.map((item) =>
              el(
                "tr",
                {},
                el("td", {}, el("button", { type: "button", class: "qq-cell-title", onmousedown: prevent, onclick: (e: MouseEvent) => env.open(item.path, undefined, sideClick(e)) }, item.title)),
                ...cols.map((c) => el("td", {}, cell(item, c.toLowerCase()))),
              ),
            ),
          ),
        ),
      );
    }

    function cell(item: FeedItem, key: string): Node | string {
      if (key === "modified") return el("span", { "data-ts": String(item.mtime) }, timeAgo(item.mtime));
      const values = key === "tags" ? item.tags.map((t) => `#${t}`) : key === "folder" ? [item.path.split("/").slice(0, -1).join("/")].filter(Boolean) : (item.props?.[key] ?? []);
      return values.length ? values.join(", ") : el("span", { class: "qq-none", "aria-label": "None" }, "–");
    }

    function row(item: FeedItem) {
      const folder = item.path.split("/").slice(0, -1).join("/");
      const hit = item.lines[0];
      const preview = hit ? highlight(hit.text, env.args.q ?? "") : escapeHtml(firstLine(item.excerpt));
      const node = el(
        "button",
        { type: "button", class: "qq-row", onmousedown: prevent, onclick: (e: MouseEvent) => env.open(item.path, hit?.line, sideClick(e)) },
        icon(item.kind === "html" ? "html" : "file", 14),
        el(
          "span",
          { class: "qq-main" },
          el("span", { class: "qq-title" }, item.title),
          preview ? el("span", { class: "qq-preview", html: preview }) : null,
        ),
        el("span", { class: "qq-meta" }, folder ? `${folder} · ` : "", el("span", { "data-ts": String(item.mtime) }, timeAgo(item.mtime))),
      );
      return node;
    }

    void load();
    const off = onVaultChange(load);
    return () => {
      alive = false;
      off();
    };
  },
};

function firstLine(md: string): string {
  const line = md.split("\n").find((l) => l.trim() && !/^(::|!\[|```|---|\|)/.test(l.trim())) ?? "";
  return line.replace(/^[#>\-*+\s]+|\[[ xX]\]\s*/g, "").replace(/[*_`~]|\[\[|\]\]/g, "").slice(0, 140);
}

function highlight(text: string, q: string): string {
  return markTerms(text.replace(/^[#>\-*+\s]+/, ""), textWords(parse(q).expr).join(" "));
}
