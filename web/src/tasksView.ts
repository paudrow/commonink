// The Tasks page: open tasks outside any one note. It's the ::tasks widget, so ticking a box
// here edits the note the task lives in.
import type { TagCount } from "./api.ts";
import { el } from "./dom.ts";
import { tagFilter } from "./tagPicker.ts";
import { WIDGETS } from "./widgets/index.ts";

type Open = (path: string, line?: number) => void;

/** Mount a task list into `host`; returns its cleanup. Clicking a task's tag calls `openTag`. */
export function mountTasks(host: HTMLElement, opts: { limit: number; tag?: string; open: Open; openTag(tag: string): void }): () => void {
  const body = el("div", { class: "qw-body" });
  const card = el("div", { class: "qw qw-tasks is-standalone" }, body);
  host.replaceChildren(card);
  return WIDGETS.tasks.mount(
    body,
    {
      args: { limit: String(opts.limit), ...(opts.tag ? { tag: opts.tag } : {}) },
      note: "",
      openConfig: false,
      update() {},
      withId() {},
      focusEditor() {},
      remeasure() {},
      open: (target, line) => opts.open(target, line),
      openTag: opts.openTag,
    },
    card,
  );
}

/** The page, narrowed to `tag` (and the tags under it) if given. */
export function renderTasksPage(root: HTMLElement, hooks: { open: Open; tags(): TagCount[] }, tag = ""): () => void {
  const host = el("div");
  const filters = el("div", { class: "feed-filters page-filters" });
  let unmount = () => {};
  const show = (next: string) => {
    unmount();
    filters.replaceChildren(tagFilter({ current: next, tags: hooks.tags, count: (t) => t.tasks, onChange: show }));
    unmount = mountTasks(host, { limit: 500, tag: next, open: hooks.open, openTag: show });
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
  show(tag);
  return () => unmount();
}
