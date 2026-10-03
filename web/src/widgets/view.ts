//   ::view{folder=Projects limit=5 label="Active projects"}      ::view{tag=meeting sort=title}
//   ::view{has=status layout=table fields=status,owner,due}      ::view{folder=Launch layout=board fields=owner}
//   ::view{has=due layout=calendar}                              ::view{tag=work layout=calendar date=review}
// A live view of the notes matching a search, folder, tag or property: the same rows (each note,
// with the fields it asks for) laid out as a list, a table, a board or a month. Updates as notes
// (and agents) change. Every layout opens a note when you click it.
// - list: each title, with its fields as small chips under it.
// - table: the title, then a column per field.
// - board: a column per value of `group` (status by default), and one for notes without it. Dragging
//   a card to another column writes that value into the note's frontmatter.
// - calendar: a month, each note on the day its `date` property (due by default) names, else on its
//   own date (a `date:` or `created:`, or one in its name).
// The query and layout rules are src/core/query.ts and src/core/view.ts.
import { api, type FeedItem } from "../api.ts";
import { el, escapeHtml, icon, markTerms, timeAgo } from "../dom.ts";
import { onVaultChange } from "../events.ts";
import type { Field, WidgetSpec } from "./core.ts";
import { formatQuery, toQuery } from "../../../src/core/query.ts";
import { parse, textWords } from "../../../src/core/queryGrammar.ts";
import { withProperty } from "../../../src/core/frontmatter.ts";
import { boardColumns, calendarDays, dateKeyOf, fieldsOf, groupOf, layoutOf, propsWanted, rowsOf, type Layout } from "../../../src/core/view.ts";
import { clickWhere } from "../panes.ts";
import { queryHelpLink } from "../queryHelp.ts";

const prevent = (e: Event) => e.preventDefault();
const iso = (d: Date) => d.toLocaleDateString("en-CA"); // YYYY-MM-DD in local time

/**
 * The note query's fields, as the ::view widget's settings form shows them. (The smart folder
 * editor has rows of its own, over the same query text.)
 */
export const QUERY_FIELDS: Field[] = [
  {
    key: "q",
    label: "Matching",
    type: "text",
    placeholder: "Words, a OR b, ( ), -leave out, tag=x, status=draft, modified>-7d",
    check: (v) => parse(v).error?.message ?? null,
    help: queryHelpLink,
  },
  { key: "folder", label: "Folder", type: "text", placeholder: "e.g. Projects", picker: "folder" },
  { key: "tag", label: "Tags", type: "text", placeholder: "e.g. meeting (includes meeting/…), or meeting, client for both", picker: "tag" },
  { key: "match", label: "Combine", type: "select", options: [["all", "Match all of them"], ["any", "Match any of them"]] },
  { key: "sort", label: "Sort", type: "select", options: [["modified", "Recently changed"], ["date", "Newest by date"], ["oldest", "Oldest by date"], ["title", "By title"], ["created", "Newest created"]] },
];

const LAYOUT_NAMES: Record<Layout, string> = { list: "List", table: "Table", board: "Board", calendar: "Calendar" };

export const view: WidgetSpec = {
  name: "view",
  title: "View",
  heading: (args) => `${LAYOUT_NAMES[layoutOf(args)]} view`,
  icon: "feed",
  hint: "Notes by search, folder, tag or property, as a list, table, board or calendar",
  keywords: "view query list table board kanban calendar month notes properties dashboard recent folder tag search",
  defaults: {},
  // Filters written as keys of their own (modified>-7d, -tag=x, status=draft) show in Matching, so saving the form keeps them.
  formArgs: (args) => ({ ...args, q: toQuery(args).q ?? "" }),
  configAction: {
    label: "Save as view",
    icon: "folderSearch",
    run: (args, env, anchor) => env.saveSmartFolder(formatQuery(toQuery(args)), args.label ?? "", anchor),
  },
  fields: [
    { key: "label", label: "Title", type: "text", placeholder: "Active projects, Meetings…" },
    ...QUERY_FIELDS,
    { key: "layout", label: "Layout", type: "select", options: [["list", "List"], ["table", "Table"], ["board", "Board"], ["calendar", "Calendar"]] },
    { key: "fields", label: "Fields", type: "text", placeholder: "status, due (properties), tags, folder, modified", picker: "property", several: true },
    { key: "group", label: "Columns by", type: "text", placeholder: "status", picker: "property", when: (v) => layoutOf(v) === "board" },
    { key: "date", label: "Date", type: "text", placeholder: "due (else the note's own date)", picker: "property", when: (v) => layoutOf(v) === "calendar" },
    { key: "limit", label: "How many", type: "text", placeholder: "6 in a list or table; a board or calendar shows all" },
  ],

  mount(body, env) {
    let alive = true;
    const args = env.args;
    const layout = layoutOf(args);
    const query = toQuery(args);
    const limit = rowsOf(args, query.limit);
    const fields = fieldsOf(args);
    const props = propsWanted(args);
    const problem = parse(query.q ?? "").error?.message;
    const list = el("div", { class: `qq-list qv-${layout}` });
    const foot = el("div", { class: "qq-foot" });
    body.append(list, foot);
    // The month a calendar shows; the arrows move it without loading again.
    let month = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    let items: FeedItem[] = [];

    async function load() {
      const page = await api.feed({ ...query, scope: "active", limit: limit + 1, cols: props.join(",") || undefined }).catch(() => null);
      if (!alive || !page) return;
      items = page.items.filter((i) => i.path !== env.note).slice(0, limit); // a dashboard shouldn't list itself
      const total = page.total - (page.items.some((i) => i.path === env.note) ? 1 : 0);
      draw();
      foot.textContent = total > items.length ? `${items.length} of ${total} notes` : `${total} note${total === 1 ? "" : "s"}`;
      if (layout === "calendar") {
        const undated = calendarDays(items, dateKeyOf(args), "").undated;
        if (undated) foot.textContent += ` · ${undated} without a date`;
      }
      // A mistake in the query (a "(" never closed) is said here; the list is the best reading of the rest.
      if (problem) foot.textContent = problem;
      foot.classList.toggle("is-error", !!problem);
    }

    function draw() {
      if (layout === "calendar") list.replaceChildren(calendarOf(items));
      else if (!items.length) list.replaceChildren(el("div", { class: "qt-empty" }, "No notes match."));
      else if (layout === "table") list.replaceChildren(tableOf(items));
      else if (layout === "board") list.replaceChildren(boardOf(items));
      else list.replaceChildren(...items.map(row));
      env.remeasure();
    }

    const open = (item: FeedItem, line?: number) => (e: MouseEvent) => env.open(item.path, line, clickWhere(e));

    /** A note's title, as a button that opens it. */
    const titleButton = (item: FeedItem, cls: string) => el("button", { type: "button", class: cls, onmousedown: prevent, onclick: open(item) }, item.title);

    /** A note's fields as small chips: the field's name, then its value. Fields it has no value for are left out. */
    function chips(item: FeedItem, skip?: string): HTMLElement | null {
      const shown = fields.filter((f) => f !== skip).flatMap((f) => {
        const v = value(item, f);
        return v === null ? [] : [el("span", { class: "qv-chip", title: f }, el("span", { class: "qv-chip-key" }, f), v)];
      });
      return shown.length ? el("span", { class: "qv-chips" }, ...shown) : null;
    }

    function row(item: FeedItem) {
      const folder = item.path.split("/").slice(0, -1).join("/");
      const hit = item.lines[0];
      const preview = hit ? highlight(hit.text, args.q ?? "") : fields.length ? "" : escapeHtml(firstLine(item.excerpt));
      return el(
        "button",
        { type: "button", class: "qq-row", onmousedown: prevent, onclick: open(item, hit?.line) },
        icon(item.kind === "html" ? "html" : "file", 14),
        el(
          "span",
          { class: "qq-main" },
          el("span", { class: "qq-title" }, item.title),
          preview ? el("span", { class: "qq-preview", html: preview }) : null,
          chips(item),
        ),
        el("span", { class: "qq-meta" }, folder ? `${folder} · ` : "", el("span", { "data-ts": String(item.mtime) }, timeAgo(item.mtime))),
      );
    }

    function tableOf(items: FeedItem[]) {
      return el(
        "div",
        { class: "qq-table-wrap" },
        el(
          "table",
          { class: "qq-table" },
          el("thead", {}, el("tr", {}, el("th", { scope: "col" }, "Note"), ...fields.map((c) => el("th", { scope: "col" }, c)))),
          el(
            "tbody",
            {},
            ...items.map((item) => el("tr", {}, el("td", {}, titleButton(item, "qq-cell-title")), ...fields.map((c) => el("td", {}, value(item, c) ?? el("span", { class: "qq-none", "aria-label": "None" }, "–"))))),
          ),
        ),
      );
    }

    function boardOf(items: FeedItem[]) {
      const key = groupOf(args);
      return el(
        "div",
        { class: "qv-board" },
        ...boardColumns(items, key).map((col) => {
          const cards = el("div", { class: "qv-cards" }, ...col.rows.map((item) => card(item, key)));
          const column = el(
            "section",
            { class: `qv-col${col.value === null ? " is-none" : ""}`, "aria-label": col.value ?? `No ${key}` },
            el("div", { class: "qv-col-head" }, el("span", { class: "qv-col-name" }, col.value ?? `No ${key}`), el("span", { class: "qv-col-count" }, String(col.rows.length))),
            cards,
          );
          if (!env.readOnly) dropTarget(column, cards, key, col.value);
          return column;
        }),
      );
    }

    function card(item: FeedItem, key: string) {
      const node = el("div", { class: "qv-card", "data-path": item.path }, titleButton(item, "qv-card-title"), chips(item, key));
      if (!env.readOnly) {
        node.draggable = true;
        node.addEventListener("dragstart", (e) => {
          e.dataTransfer?.setData("application/x-commonink-view-card", item.path);
          e.dataTransfer!.effectAllowed = "move";
          node.classList.add("is-dragging");
        });
        node.addEventListener("dragend", () => node.classList.remove("is-dragging"));
      }
      return node;
    }

    function dropTarget(column: HTMLElement, cards: HTMLElement, key: string, value: string | null) {
      const ours = (e: DragEvent) => e.dataTransfer?.types.includes("application/x-commonink-view-card");
      column.addEventListener("dragover", (e) => {
        if (!ours(e)) return;
        e.preventDefault();
        e.dataTransfer!.dropEffect = "move";
        column.classList.add("is-over");
      });
      column.addEventListener("dragleave", (e) => {
        if (!column.contains(e.relatedTarget as Node)) column.classList.remove("is-over");
      });
      column.addEventListener("drop", (e) => {
        if (!ours(e)) return;
        e.preventDefault();
        e.stopPropagation(); // the editor around the widget mustn't take it as text dropped in the note
        column.classList.remove("is-over");
        const path = e.dataTransfer!.getData("application/x-commonink-view-card");
        const item = items.find((i) => i.path === path);
        if (!item || (item.props?.[key]?.[0]?.toLowerCase() ?? null) === (value?.toLowerCase() ?? null)) return;
        // Shown in its new column at once; the note's change redraws the board when it's saved.
        item.props = { ...item.props, [key]: value === null ? [] : [value] };
        const node = [...list.querySelectorAll<HTMLElement>(".qv-card")].find((n) => n.dataset.path === path);
        if (node) cards.append(node);
        void moveTo(path, key, value).catch((err: Error) => {
          void import("../toast.ts").then((t) => t.toast({ text: `Couldn't move ${item.title}: ${err.message}`, error: true }));
          void load();
        });
      });
    }

    function calendarOf(items: FeedItem[]) {
      const key = dateKeyOf(args);
      const ym = iso(month).slice(0, 7);
      const { days } = calendarDays(items, key, ym);
      const nav = (delta: number) => () => {
        month = new Date(month.getFullYear(), month.getMonth() + delta, 1);
        draw();
      };
      const today = iso(new Date());
      const first = (month.getDay() + 6) % 7; // weeks start on Monday
      const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
      const cells: HTMLElement[] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => el("span", { class: "qc-dow" }, d));
      for (let i = 0; i < first; i++) cells.push(el("span", { class: "qv-day is-blank" }));
      for (let d = 1; d <= count; d++) {
        const date = `${ym}-${String(d).padStart(2, "0")}`;
        const on = days.get(date) ?? [];
        cells.push(
          el(
            "div",
            { class: `qv-day${date === today ? " is-today" : ""}`, "aria-label": `${date}${on.length ? `, ${on.length} ${on.length === 1 ? "note" : "notes"}` : ""}` },
            el("span", { class: "qv-day-num" }, String(d)),
            ...on.slice(0, 3).map((item) => titleButton(item, "qv-day-note")),
            on.length > 3 ? el("span", { class: "qv-day-more", title: on.slice(3).map((i) => i.title).join("\n") }, `+${on.length - 3} more`) : null,
          ),
        );
      }
      return el(
        "div",
        { class: "qv-month" },
        el(
          "div",
          { class: "qc-head" },
          el("div", { class: "qc-title" }, month.toLocaleDateString(undefined, { month: "long", year: "numeric" })),
          el("span", { class: "spacer" }),
          el("button", { type: "button", class: "qw-icon is-prev", title: "Previous month", onmousedown: prevent, onclick: nav(-1) }, icon("chevron", 15)),
          el("button", { type: "button", class: "qc-today", onmousedown: prevent, onclick: () => ((month = new Date(new Date().getFullYear(), new Date().getMonth(), 1)), draw()) }, "Today"),
          el("button", { type: "button", class: "qw-icon", title: "Next month", onmousedown: prevent, onclick: nav(1) }, icon("chevron", 15)),
        ),
        el("div", { class: "qv-grid" }, ...cells),
      );
    }

    void load();
    const off = onVaultChange(load);
    return () => {
      alive = false;
      off();
    };
  },
};

/** A field's value for a note, as shown (tags as #tags, modified as "2h ago"), or null if it has none. */
function value(item: FeedItem, key: string): Node | string | null {
  if (key === "modified") return el("span", { "data-ts": String(item.mtime) }, timeAgo(item.mtime));
  const values = key === "tags" ? item.tags.map((t) => `#${t}`) : key === "folder" ? [item.path.split("/").slice(0, -1).join("/")].filter(Boolean) : (item.props?.[key] ?? []);
  return values.length ? values.join(", ") : null;
}

/**
 * Write `value` as the note's `key` property (null takes it out): a board card dropped in another
 * column. Read fresh and saved against that version, so an edit made meanwhile isn't lost; if the
 * note changed in between, it's read and written once more.
 */
export async function moveTo(path: string, key: string, value: string | null, tries = 2): Promise<void> {
  const note = await api.note(path);
  const next = withProperty(note.content, key, value);
  if (next === note.content) return;
  try {
    await api.save(path, next, note.version);
  } catch (e) {
    if (tries > 1 && (e as { status?: number }).status === 409) return moveTo(path, key, value, tries - 1);
    throw e;
  }
}

function firstLine(md: string): string {
  const line = md.split("\n").find((l) => l.trim() && !/^(::|!\[|```|---|\|)/.test(l.trim())) ?? "";
  return line.replace(/^[#>\-*+\s]+|\[[ xX]\]\s*/g, "").replace(/[*_`~]|\[\[|\]\]/g, "").slice(0, 140);
}

function highlight(text: string, q: string): string {
  return markTerms(text.replace(/^[#>\-*+\s]+/, ""), textWords(parse(q).expr).join(" "));
}
