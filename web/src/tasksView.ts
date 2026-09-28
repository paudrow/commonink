// Open tasks outside any one note: the Tasks page and the dashboard at the top of the feed. Both
// are the ::tasks widget, so ticking a box here edits the note the task lives in.
import { el } from "./dom.ts";
import { WIDGETS } from "./widgets/index.ts";

type Open = (path: string, line?: number) => void;

/** Mount a task list into `host`; returns its cleanup. */
export function mountTasks(host: HTMLElement, opts: { limit: number; open: Open }): () => void {
  const body = el("div", { class: "qw-body" });
  const card = el("div", { class: "qw qw-tasks is-standalone" }, body);
  host.replaceChildren(card);
  return WIDGETS.tasks.mount(
    body,
    {
      args: { limit: String(opts.limit) },
      note: "",
      openConfig: false,
      update() {},
      withId() {},
      focusEditor() {},
      remeasure() {},
      open: (target, line) => opts.open(target, line),
    },
    card,
  );
}

export function renderTasksPage(root: HTMLElement, open: Open): () => void {
  const host = el("div");
  root.replaceChildren(
    el(
      "div",
      { class: "page" },
      el("header", { class: "page-head" }, el("h1", {}, "Tasks"), el("p", { class: "page-sub" }, "Every checkbox across your notes. Tick one here and it's ticked in its note.")),
      host,
    ),
  );
  return mountTasks(host, { limit: 500, open });
}
