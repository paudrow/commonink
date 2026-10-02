// The Today page: the quick-add bar, then decisions agents are waiting on you for (decisionsCard.ts,
// only when there are any), then the day at a glance (the ::today widget: today's journal
// note, today's events, and what's overdue, due or starting today), then your Writing streak. Ticking
// a box here edits the note the task lives in, and clearing the last one is celebrated as anywhere
// else (todayCleared.ts). Tasks lists every task; this page is just today.
import { mountDecisions } from "./decisionsCard.ts";
import { el, icon } from "./dom.ts";
import { onVaultChange } from "./events.ts";
import { quickAddBar } from "./quickAdd.ts";
import { COUNTS, gamified, writingDays, writingSummary } from "./streak.ts";
import { today } from "./taskChips.ts";
import { WIDGETS } from "./widgets/index.ts";

export interface TodayHooks {
  open(path: string, line?: number, side?: boolean): void;
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

/** Your writing streak: the 12-week heatmap, the streaks, and what counts. It keeps up as you write. */
function mountStreak(host: HTMLElement): () => void {
  const body = el("div", { class: "qw-body" }, el("div", { class: "qt-empty" }, "Loading…"));
  host.replaceChildren(
    el("section", { class: "qw wd-card is-standalone", "aria-labelledby": "wd-heading" }, el("h2", { class: "td-title", id: "wd-heading" }, icon("drop", 14), "Writing streak"), body),
  );
  let alive = true;
  const load = async () => {
    const days = await writingDays().catch(() => null);
    if (!alive) return;
    body.replaceChildren(days ? writingSummary(days) : el("div", { class: "qt-empty" }, "Couldn't load your writing days"), el("p", { class: "wd-what" }, COUNTS));
  };
  void load();
  // A few seconds after the last change, so typing in a note to the side isn't slowed.
  const off = onVaultChange(() => void load(), 4000);
  return () => {
    alive = false;
    off();
  };
}

/** Draw the page into `root`; returns its cleanup. */
export function renderTodayPage(root: HTMLElement, hooks: TodayHooks): () => void {
  const date = new Date(`${today()}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  const decisions = el("div", { class: "td-decisions" });
  const day = el("div");
  const streak = el("div", { class: "td-streak" });
  root.replaceChildren(
    el(
      "div",
      { class: "page" },
      el("header", { class: "page-head" }, el("h1", {}, "Today"), el("p", { class: "page-sub" }, date)),
      quickAddBar({ added: () => {}, open: hooks.open }).root, // the day below reloads when the note changes
      decisions,
      day,
      gamified() ? streak : "", // a workspace without rewards has no streak (see streak.ts)
    ),
  );
  const unmountDecisions = mountDecisions(decisions, root, { open: (path) => hooks.open(path) });
  const unmountDay = mountDay(day, hooks);
  const unmountStreak = gamified() ? mountStreak(streak) : () => {};
  return () => (unmountDecisions(), unmountDay(), unmountStreak());
}
