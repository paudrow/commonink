// The Today page: the quick-add bar, then the ::today widget (overdue, due today, starting today,
// today's journal note). "Start on Today" makes it the page the app opens on, for this browser.
import { el } from "./dom.ts";
import { quickAddBar } from "./quickAdd.ts";
import { today } from "./taskChips.ts";
import { WIDGETS } from "./widgets/index.ts";

export interface TodayHooks {
  open(path: string, line?: number): void;
  openTag(tag: string): void;
  openPerson(name: string): void;
  /** Whether the app opens on Today in this browser, and changing it. */
  startHere: { get(): boolean; set(on: boolean): void };
}

/** Draw the page into `root`; returns its cleanup. */
export function renderTodayPage(root: HTMLElement, hooks: TodayHooks): () => void {
  const day = new Date(`${today()}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  const start = el("input", { type: "checkbox", checked: hooks.startHere.get(), "aria-label": "Start on Today" });
  start.addEventListener("change", () => hooks.startHere.set(start.checked));
  const body = el("div", { class: "qw-body" });
  const card = el("div", { class: "qw qw-today is-standalone" }, body);
  root.replaceChildren(
    el(
      "div",
      { class: "page" },
      el(
        "header",
        { class: "page-head td-head" },
        el("div", {}, el("h1", {}, "Today"), el("p", { class: "page-sub" }, day)),
        el("label", { class: "td-start", title: "Open the app on Today instead of Notes, in this browser" }, start, "Start on Today"),
      ),
      quickAddBar({ added: () => {}, open: hooks.open }).root, // the day below reloads when the note changes
      card,
    ),
  );
  return WIDGETS.today.mount(
    body,
    {
      args: {},
      note: "",
      openConfig: false,
      update() {},
      withId() {},
      focusEditor() {},
      remeasure() {},
      open: hooks.open,
      openTag: hooks.openTag,
      openPerson: hooks.openPerson,
    },
    card,
  );
}
