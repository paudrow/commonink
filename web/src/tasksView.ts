// The Tasks page: open tasks outside any one note. It's the ::tasks widget, so ticking a box
// here edits the note the task lives in.
import type { TagCount } from "./api.ts";
import { el, icon } from "./dom.ts";
import { tagFilter } from "./tagPicker.ts";
import { WIDGETS } from "./widgets/index.ts";

type Open = (path: string, line?: number) => void;

/** Mount a task list into `host`; returns its cleanup. Clicking a task's tag calls `openTag`, and "Show …'s tasks" `openPerson`. */
export function mountTasks(
  host: HTMLElement,
  opts: { limit: number; tag?: string; assignee?: string; open: Open; openTag(tag: string): void; openPerson(name: string): void },
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
      open: (target, line) => opts.open(target, line),
      openTag: opts.openTag,
      saveSmartFolder() {},
      sources: { tags: () => [], folders: () => [] }, // the Tasks page has no settings form
      openPerson: opts.openPerson,
    },
    card,
  );
}

/** The page, narrowed to `tag` (and the tags under it) and to one person's tasks, if given. */
export function renderTasksPage(root: HTMLElement, hooks: { open: Open; tags(): TagCount[] }, filter: { tag?: string; assignee?: string } = {}): () => void {
  const host = el("div");
  const filters = el("div", { class: "feed-filters page-filters" });
  let unmount = () => {};
  const show = (next: { tag?: string; assignee?: string }) => {
    unmount();
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
    unmount = mountTasks(host, { limit: 500, ...next, open: hooks.open, openTag: (tag) => show({ ...next, tag }), openPerson: (assignee) => show({ ...next, assignee }) });
  };
  root.replaceChildren(
    el(
      "div",
      { class: "page" },
      el("header", { class: "page-head" }, el("h1", {}, "Tasks"), el("p", { class: "page-sub" }, "Every checkbox across your notes. Tick one here and it's ticked in its note.")),
      filters,
      host,
    ),
  );
  show(filter);
  return () => unmount();
}
