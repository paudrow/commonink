// The Tasks page: the quick-add bar, then every task, narrowed to whose they are or a tag. The list
// is the ::tasks widget, so ticking a box here edits the note the task lives in. What's on today
// has a page of its own, Today (todayView.ts).
import type { TagCount } from "./api.ts";
import { el, icon } from "./dom.ts";
import { tagFilter } from "./tagPicker.ts";
import { WIDGETS } from "./widgets/index.ts";
import { quickAddBar } from "./quickAdd.ts";
import { emptyState } from "./emptyState.ts";

type Open = (path: string, line?: number, side?: boolean) => void;

/** Mount a task list into `host`; returns its cleanup. Clicking a task's tag calls `openTag`, and "Show …'s tasks" `openPerson`. */
export function mountTasks(
  host: HTMLElement,
  opts: { limit: number; tag?: string; assignee?: string; by?: "me"; group?: string; open: Open; openTag(tag: string): void; openPerson(name: string): void; empty?(): HTMLElement },
): () => void {
  const body = el("div", { class: "qw-body" });
  const card = el("div", { class: "qw qw-tasks is-standalone" }, body);
  host.replaceChildren(card);
  return WIDGETS.tasks.mount(
    body,
    {
      args: { limit: String(opts.limit), ...(opts.tag ? { tag: opts.tag } : {}), ...(opts.assignee ? { assignee: opts.assignee } : {}), ...(opts.by ? { by: opts.by } : {}), ...(opts.group ? { group: opts.group } : {}) },
      note: "",
      openConfig: false,
      update() {},
      withId() {},
      focusEditor() {},
      remeasure() {},
      open: (target, line, side) => opts.open(target, line, side),
      openTag: opts.openTag,
      saveSmartFolder() {},
      sources: { tags: () => [], folders: () => [] }, // the Tasks page has no settings form
      openPerson: opts.openPerson,
      empty: opts.empty,
    },
    card,
  );
}

type Filter = { tag?: string; assignee?: string; by?: "me" };

/**
 * The page, narrowed to `tag` (and the tags under it) and to one person's tasks, if given. "Assigned
 * to me" is `assignee: "me"`, the reader's tasks in anyone's notes; "Assigned by me" is `by: "me"`,
 * what they gave others in their own notes. `me` says what "me" is here (online, your @name; locally @me).
 */
export function renderTasksPage(root: HTMLElement, hooks: { open: Open; tags(): TagCount[]; me: string }, filter: Filter = {}): () => void {
  const host = el("div");
  const filters = el("div", { class: "feed-filters page-filters" });
  const bar = quickAddBar({ added: () => {}, open: hooks.open }); // the list below reloads when the note changes
  const empty = () =>
    emptyState({
      icon: "task",
      title: "No tasks yet",
      text: ["Any line in a note that starts with ", el("code", {}, "- [ ]"), " shows up here, so you can tick it off without opening the note."],
      action: { label: "Add a task", icon: "plus", run: () => bar.focus() },
    });
  let unmount = () => {};
  const show = (next: Filter) => {
    unmount();
    const whole = !next.tag && !next.assignee && !next.by;
    const mode = next.assignee === "me" ? "to" : next.by ? "by" : "all";
    const other = next.assignee === "me" ? "" : next.assignee;
    const seg = el(
      "div",
      { class: "seg tk-whose", role: "group", "aria-label": "Whose tasks" },
      ...([
        ["all", "Everyone", "Every task", { ...next, assignee: other, by: undefined }],
        ["to", "Assigned to me", `${hooks.me}, in anyone's notes`, { ...next, assignee: "me", by: undefined }],
        ["by", "Assigned by me", "Tasks you gave someone else, in notes you made", { ...next, assignee: other, by: "me" }],
      ] as const).map(([m, label, title, to]) =>
        el("button", { type: "button", class: m === mode ? "is-on" : "", "aria-pressed": String(m === mode), title, onclick: () => show(to as Filter) }, label),
      ),
    );
    const links = { open: hooks.open, openTag: (tag: string) => show({ ...next, tag }), openPerson: (assignee: string) => show({ ...next, assignee }) };
    filters.replaceChildren(
      seg,
      tagFilter({ current: next.tag ?? "", tags: hooks.tags, count: (t) => t.tasks, onChange: (tag) => show({ ...next, tag }) }),
      next.assignee && next.assignee !== "me"
        ? el(
            "span",
            { class: "chip tag-filter is-on" },
            icon("at", 13),
            next.assignee,
            el("button", { type: "button", class: "tag-clear", title: "Everyone's tasks", onclick: () => show({ ...next, assignee: "" }) }, icon("close", 12)),
          )
        : "",
    );
    // Assigned by me is about who: group it by person.
    unmount = mountTasks(host, { limit: 500, ...next, ...(next.by ? { group: "person" } : {}), ...links, empty: whole ? empty : undefined });
  };
  root.replaceChildren(
    el(
      "div",
      { class: "page" },
      el("header", { class: "page-head" }, el("h1", {}, "Tasks"), el("p", { class: "page-sub" }, "Every checkbox across your notes. Tick one here and it's ticked in its note.")),
      bar.root,
      filters,
      host,
    ),
  );
  show(filter);
  return () => unmount();
}
