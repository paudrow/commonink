// The Tasks page: the quick-add bar, then every task, narrowed to whose they are or a tag. The list
// is the ::tasks widget, so ticking a box here edits the note the task lives in. What's on today
// has a page of its own, Today (todayView.ts). The Backlog is the page's other list: tasks set aside
// (by you, or for sitting idle), each with its way back.
import type { Where } from "./panes.ts";
import { api, type TagCount } from "./api.ts";
import { onVaultChange } from "./events.ts";
import { el, icon } from "./dom.ts";
import { tagFilter } from "./tagPicker.ts";
import { WIDGETS } from "./widgets/index.ts";
import { quickAddBar } from "./quickAdd.ts";
import { emptyState } from "./emptyState.ts";

type Open = (path: string, line?: number, where?: Where) => void;

/** Mount a task list into `host`; returns its cleanup. Clicking a task's tag calls `openTag`, and "Show …'s tasks" `openPerson`. */
export function mountTasks(
  host: HTMLElement,
  opts: { limit: number; tag?: string; assignee?: string; by?: "me"; group?: string; backlog?: "only"; open: Open; openTag(tag: string): void; openPerson(name: string): void; empty?(): HTMLElement },
): () => void {
  const body = el("div", { class: "qw-body" });
  const card = el("div", { class: "qw qw-tasks is-standalone" }, body);
  host.replaceChildren(card);
  return WIDGETS.tasks.mount(
    body,
    {
      args: { limit: String(opts.limit), ...(opts.tag ? { tag: opts.tag } : {}), ...(opts.assignee ? { assignee: opts.assignee } : {}), ...(opts.by ? { by: opts.by } : {}), ...(opts.group ? { group: opts.group } : {}), ...(opts.backlog ? { backlog: opts.backlog } : {}) },
      note: "",
      openConfig: false,
      update() {},
      withId() {},
      focusEditor() {},
      remeasure() {},
      open: (target, line, where) => opts.open(target, line, where),
      openTag: opts.openTag,
      saveSmartFolder() {},
      sources: { tags: () => [], folders: () => [] }, // the Tasks page has no settings form
      openPerson: opts.openPerson,
      empty: opts.empty,
    },
    card,
  );
}

type Filter = { tag?: string; assignee?: string; by?: "me"; backlog?: boolean };

/**
 * The page, narrowed to `tag` (and the tags under it) and to one person's tasks, if given. "Assigned
 * to me" is `assignee: "me"`, the reader's tasks in anyone's notes; "Assigned by me" is `by: "me"`,
 * what they gave others in their own notes. `me` says what "me" is here (online, your @name; locally @me).
 * `backlog` shows the Backlog instead; `hooks.backlog` says how tasks get there on their own.
 */
export function renderTasksPage(root: HTMLElement, hooks: { open: Open; tags(): TagCount[]; me: string; backlog?(): { days: number; tag: string } }, filter: Filter = {}): () => void {
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
  const nothingWaiting = () =>
    emptyState({
      icon: "archive",
      title: "Nothing in the Backlog",
      text: ["Move a task here from its ", el("b", {}, "⚙"), " menu to get it out of Today and your lists without deleting it. It stays in its note."],
    });
  const note = el("p", { class: "page-sub tk-backlog-note" });
  let unmount = () => {};
  /** How many tasks are waiting, on the Backlog's tab. */
  let waiting = 0;
  const count = () =>
    void api.backlogCount().then(
      (n) => {
        if (n === waiting) return;
        waiting = n;
        const tab = filters.querySelector(".tk-backlog-n");
        if (tab) tab.textContent = n ? String(n) : "";
      },
      () => {},
    );
  const show = (next: Filter) => {
    unmount();
    const whole = !next.tag && !next.assignee && !next.by;
    const which = el(
      "div",
      { class: "seg tk-which", role: "group", "aria-label": "Which tasks" },
      el("button", { type: "button", class: next.backlog ? "" : "is-on", "aria-pressed": String(!next.backlog), title: "Every task that isn't in the Backlog", onclick: () => show({ ...next, backlog: false }) }, "Tasks"),
      el(
        "button",
        { type: "button", class: next.backlog ? "is-on" : "", "aria-pressed": String(!!next.backlog), title: "Tasks set aside: out of Today and your lists, still in their notes", onclick: () => show({ ...next, backlog: true }) },
        "Backlog",
        el("span", { class: "n tk-backlog-n" }, waiting ? String(waiting) : ""),
      ),
    );
    const auto = hooks.backlog?.();
    note.hidden = !next.backlog;
    note.replaceChildren(
      "Set aside, still in their notes. ",
      ...(auto?.days
        ? [`A task nobody touches for ${auto.days} ${auto.days === 1 ? "day" : "days"} moves here on its own; tag one `, el("code", {}, `#${auto.tag}`), " to keep it in your lists."]
        : auto
          ? ["Tasks only come here when you move them."]
          : []),
    );
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
      which,
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
    const { backlog, ...narrowed } = next;
    unmount = mountTasks(host, { limit: 500, ...narrowed, ...(next.by ? { group: "person" } : {}), ...(backlog ? { backlog: "only" as const } : {}), ...links, empty: backlog ? nothingWaiting : whole ? empty : undefined });
  };
  root.replaceChildren(
    el(
      "div",
      { class: "page" },
      el("header", { class: "page-head" }, el("h1", {}, "Tasks"), el("p", { class: "page-sub" }, "Every checkbox across your notes. Tick one here and it's ticked in its note.")),
      bar.root,
      filters,
      note,
      host,
    ),
  );
  show(filter);
  count();
  const off = onVaultChange(count);
  return () => (unmount(), off());
}
