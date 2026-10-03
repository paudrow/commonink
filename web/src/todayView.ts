// The Today page: the quick-add bar, then decisions agents are waiting on you for (decisionsCard.ts,
// only when there are any), then the day at a glance (the ::today widget: today's journal note,
// today's events, and what's overdue, due or starting today), then your week (weekRecapCard.ts). Ticking
// a box here edits the note the task lives in, and clearing the last one is celebrated as anywhere
// else (todayCleared.ts). Tasks lists every task; this page is just today.
import type { Where } from "./panes.ts";
import { mountDecisions } from "./decisionsCard.ts";
import { el } from "./dom.ts";
import { gamified } from "./gamify.ts";
import { quickAddBar } from "./quickAdd.ts";
import { today } from "./taskChips.ts";
import { todayPageRing } from "./todayRing.ts";
import { mountWeekRecap } from "./weekRecapCard.ts";
import { WIDGETS } from "./widgets/index.ts";

export interface TodayHooks {
  open(path: string, line?: number, where?: Where): void;
  openTag(tag: string): void;
  openPerson(name: string): void;
}

/** The day at a glance: the ::today widget, showing only the sections with something in them. */
function mountDay(host: HTMLElement, hooks: TodayHooks): () => void {
  const body = el("div", { class: "qw-body" });
  const card = el("div", { class: "qw qw-today is-standalone" }, body);
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
      sources: { tags: () => [], folders: () => [] }, // no settings form here
      ...hooks,
    },
    card,
  );
}

/** Draw the page into `root`; returns its cleanup. */
export function renderTodayPage(root: HTMLElement, hooks: TodayHooks): () => void {
  const date = new Date(`${today()}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  const decisions = el("div", { class: "td-decisions" });
  const day = el("div");
  const week = el("div", { class: "td-week" });
  const ring = gamified() ? todayPageRing() : null; // how much of today is ticked, as in the sidebar
  root.replaceChildren(
    el(
      "div",
      { class: "page" },
      el("header", { class: "page-head" }, el("h1", {}, "Today"), el("p", { class: "page-sub td-sub" }, el("span", {}, date), ring?.root ?? "")),
      quickAddBar({ added: () => {}, open: hooks.open }).root, // the day below reloads when the note changes
      decisions,
      day,
      gamified() ? week : "", // a workspace without rewards has no week card (see gamify.ts)
    ),
  );
  const unmountDecisions = mountDecisions(decisions, root, { open: (path) => hooks.open(path) });
  const unmountDay = mountDay(day, hooks);
  const unmountWeek = gamified() ? mountWeekRecap(week, (path) => hooks.open(path)) : () => {};
  return () => (unmountDecisions(), unmountDay(), unmountWeek(), ring?.stop());
}
