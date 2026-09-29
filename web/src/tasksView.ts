// The Tasks page: the quick-add bar, then Today (today's journal note, and what's overdue, due or
// starting today), then every other task. The lists are the ::today and ::tasks widgets, so ticking
// a box here edits the note the task lives in.
import type { TagCount } from "./api.ts";
import { el, icon } from "./dom.ts";
import { tagFilter } from "./tagPicker.ts";
import { WIDGETS } from "./widgets/index.ts";
import { quickAddBar } from "./quickAdd.ts";
import { todaySection } from "../../src/core/tasks.ts";
import { today } from "./taskChips.ts";
import type { Task } from "./api.ts";

type Open = (path: string, line?: number, side?: boolean) => void;

/** Mount a task list into `host`; returns its cleanup. Clicking a task's tag calls `openTag`, and "Show …'s tasks" `openPerson`. */
export function mountTasks(
  host: HTMLElement,
  opts: { limit: number; tag?: string; assignee?: string; open: Open; openTag(tag: string): void; openPerson(name: string): void; skip?(t: Task): boolean },
): () => void {
  const body = el("div", { class: "qw-body" });
  const card = el("div", { class: "qw qw-tasks is-standalone" }, body);
  host.replaceChildren(card);
  return WIDGETS.tasks.mount(
    body,
    {
      args: { limit: String(opts.limit), ...(opts.tag ? { tag: opts.tag } : {}), ...(opts.assignee ? { assignee: opts.assignee } : {}) },
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
      skip: opts.skip,
    },
    card,
  );
}

/** Today at the top of Tasks: the ::today widget, showing only the sections with something in them. */
function mountToday(host: HTMLElement, hooks: { open: Open; openTag(tag: string): void; openPerson(name: string): void }): () => void {
  const body = el("div", { class: "qw-body" });
  const card = el("div", { class: "qw qw-today is-standalone" }, el("div", { class: "td-title" }, icon("sun", 14), "Today"), body);
  host.replaceChildren(card);
  return WIDGETS.today.mount(
    body,
    {
      args: { compact: "true" },
      note: "",
      openConfig: false,
      update() {},
      withId() {},
      focusEditor() {},
      remeasure() {},
      saveSmartFolder() {},
      sources: { tags: () => [], folders: () => [] }, // no settings form here either
      ...hooks,
    },
    card,
  );
}

/** The page, narrowed to `tag` (and the tags under it) and to one person's tasks, if given. */
export function renderTasksPage(root: HTMLElement, hooks: { open: Open; tags(): TagCount[]; vim?: boolean }, filter: { tag?: string; assignee?: string } = {}): () => void {
  const host = el("div");
  const todayHost = el("div", { class: "td-block" });
  const filters = el("div", { class: "feed-filters page-filters" });
  let unmount = () => {};
  const show = (next: { tag?: string; assignee?: string }) => {
    unmount();
    // Today sits on top of the whole list; narrowed to a tag or a person, the list stands alone.
    const whole = !next.tag && !next.assignee;
    const links = { open: hooks.open, openTag: (tag: string) => show({ ...next, tag }), openPerson: (assignee: string) => show({ ...next, assignee }) };
    const unmountToday = whole ? mountToday(todayHost, links) : () => {};
    todayHost.hidden = !whole;
    // What Today shows isn't listed again below it.
    const skip = whole ? (t: Task) => !t.done && todaySection(t.meta, today()) !== null : undefined;
    filters.replaceChildren(
      tagFilter({ current: next.tag ?? "", tags: hooks.tags, count: (t) => t.tasks, onChange: (tag) => show({ ...next, tag }) }),
      next.assignee
        ? el(
            "span",
            { class: "chip tag-filter is-on" },
            icon("at", 13),
            next.assignee,
            el("button", { type: "button", class: "tag-clear", title: "Everyone's tasks", onclick: () => show({ ...next, assignee: "" }) }, icon("close", 12)),
          )
        : "",
    );
    const unmountList = mountTasks(host, { limit: 500, ...next, ...links, skip });
    unmount = () => (unmountToday(), unmountList());
  };
  root.replaceChildren(
    el(
      "div",
      { class: "page" },
      el("header", { class: "page-head" }, el("h1", {}, "Tasks"), el("p", { class: "page-sub" }, "Every checkbox across your notes. Tick one here and it's ticked in its note.")),
      quickAddBar({ added: () => {}, open: hooks.open, vim: hooks.vim }).root, // Today and the list below reload when the note changes
      todayHost,
      filters,
      host,
    ),
  );
  show(filter);
  return () => unmount();
}
