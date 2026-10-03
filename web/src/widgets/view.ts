//   ::view{folder=Projects limit=5}   ::view{show=tasks tag=work due<=today}   ::view{show=month}
//   ::view{show=agenda days=7}   ::view{show=today}   ::view{show=board note="Launch"}
// One widget for everything that shows what's in the workspace: `show` picks the kind, and the rest
// are that kind's own args. No `show` is a list of notes. Each kind is a widget spec of its own (its
// fields, defaults, settings button and drawing), so the Tasks and Today pages mount theirs straight
// from VIEWS; in a note, renderWidget and the settings form ask specFor which one a line's args pick.
// A board in its own note is a `:::kanban` block, not this.
import { el } from "../dom.ts";
import { VIEW_SHOWS, viewShow, type ViewShow } from "../../../src/core/directive.ts";
import type { WidgetSpec } from "./core.ts";
import { agenda } from "./agenda.ts";
import { calendar } from "./calendar.ts";
import { kanban } from "./kanban.ts";
import { query } from "./query.ts";
import { tasks } from "./tasks.ts";
import { todayWidget } from "./today.ts";

/** The widget that draws each kind, by its `show=`. */
export const VIEWS: Record<ViewShow, WidgetSpec> = { notes: query, tasks, month: calendar, agenda, today: todayWidget, board: kanban };

/** Each kind's name in the settings form's Show choice and the / menu, in VIEW_SHOWS's order. */
export const VIEW_LABELS: Record<ViewShow, string> = { notes: "Notes", tasks: "Tasks", month: "Month", agenda: "Agenda", today: "Today", board: "Board" };

/** What a `show=` that names no kind draws: says so, with a settings form that has only Show, to pick one. */
const unknown = (show: string): WidgetSpec => ({
  name: "view",
  title: "View",
  icon: "feed",
  hint: "",
  keywords: "",
  defaults: {},
  fields: [],
  mount(body, env) {
    body.append(el("div", { class: "qt-empty" }, `There's no view called “${show}”. Pick one in settings: ${VIEW_SHOWS.join(", ")}.`));
    env.remeasure();
    return () => {};
  },
});

export const view: WidgetSpec = {
  name: "view",
  title: "View",
  icon: "feed",
  hint: "Notes, tasks, a month, an agenda, today or a board, live",
  // Every kind's words, the old widget names among them, so "/tasks" or "/agenda" still finds it.
  keywords: ["view", ...VIEW_SHOWS.map((s) => `${s} ${VIEWS[s].keywords}`)].join(" "),
  defaults: {},
  fields: [],
  kinds: {
    key: "show",
    label: "Show",
    options: VIEW_SHOWS.map((s) => [s, VIEW_LABELS[s]]),
    of: (args) => {
      const show = viewShow(args);
      return show ? VIEWS[show] : unknown(args.show ?? "");
    },
  },
  // Never drawn itself: renderWidget draws the kind specFor picks.
  mount: () => () => {},
};
