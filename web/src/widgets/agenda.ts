//   ::view{show=agenda}   ::view{show=agenda days=7}   ::view{show=agenda calendars="k3x9q2mfab,a2b3c4d5e6"}
// The next few days of events from the workspace's calendars, by day, each with its time, its
// calendar's color and its meeting note, from every calendar or the ones picked in its settings.
// Clicking an event opens it on the Calendar page.
import { el, icon } from "../dom.ts";
import { onVaultChange } from "../events.ts";
import type { WidgetSpec } from "./core.ts";
import { calendars, chosenCalendars, eventItems, eventsOn, dayText, type Item } from "../calendar/data.ts";
import { addDays, bucket, dayKey, dayStart } from "../calendar/layout.ts";
import { eventRow } from "../calendar/ui.ts";

type EventItem = Extract<Item, { kind: "event" }>;

export const agenda: WidgetSpec = {
  name: "agenda",
  title: "Agenda",
  icon: "calendar",
  hint: "The next few days of events",
  keywords: "agenda events calendar meetings schedule upcoming week",
  defaults: { days: "3" },
  fields: [
    { key: "label", label: "Title", type: "text", placeholder: "Optional" },
    { key: "days", label: "Days", type: "select", options: [["3", "3 days"], ["1", "Today"], ["7", "A week"], ["14", "Two weeks"]] },
    { key: "calendars", label: "Calendars", type: "calendars" },
  ],

  mount(body, env) {
    const count = Math.min(31, Math.max(1, Number(env.args.days) || 3));
    const shows = chosenCalendars(env.args.calendars);
    const list = el("div", { class: "ag-list" });
    body.append(list);
    let alive = true;

    async function load() {
      const first = dayKey(new Date());
      const days = Array.from({ length: count }, (_, i) => addDays(first, i));
      let groups: Array<[string, EventItem[]]> | null = null;
      let problem = "";
      try {
        const sources = await calendars();
        if (sources.length) {
          const items = eventItems((await eventsOn(days[0], days[days.length - 1])).filter((e) => shows(e.source)), sources);
          groups = [...bucket(items, (i) => i.span, days)].map(([d, l]) => [d, l.filter((i): i is EventItem => i.kind === "event")]);
        }
      } catch (e) {
        problem = e instanceof Error ? e.message : "Couldn't load the events";
      }
      if (!alive) return;
      render(groups, problem, first);
    }

    function render(groups: Array<[string, EventItem[]]> | null, problem: string, today: string) {
      const now = new Date();
      const open = (target: string) => env.open(target);
      if (problem) list.replaceChildren(el("div", { class: "ag-empty" }, problem));
      else if (!groups)
        list.replaceChildren(
          el(
            "div",
            { class: "ag-empty" },
            "No calendars yet. Subscribe to one on the Calendar page to see your events here.",
            el("div", {}, el("button", { type: "button", class: "qw-btn", onmousedown: (e: Event) => e.preventDefault(), onclick: () => open("/calendar") }, icon("calendar", 14), "Open Calendar")),
          ),
        );
      else {
        const busy = groups.filter(([, l]) => l.length);
        list.replaceChildren(
          ...(busy.length
            ? busy.map(([d, l]) =>
                el(
                  "section",
                  { class: "ag-day" },
                  el("div", { class: "qt-note is-label" }, d === today ? "Today" : d === addDays(today, 1) ? "Tomorrow" : dayText(dayStart(d), { weekday: "long", month: "short", day: "numeric" })),
                  el("div", { class: "cal-rows", role: "list" }, ...l.map((i) => eventRow(i, d, { open, readOnly: env.readOnly, now }))),
                ),
              )
            : [el("div", { class: "ag-empty" }, count === 1 ? "No events today." : `No events in the next ${count} days.`)]),
        );
      }
      env.remeasure();
    }

    list.replaceChildren(el("div", { class: "ag-empty" }, "Loading…"));
    void load();
    const off = onVaultChange(load);
    const tick = window.setInterval(load, 5 * 60_000); // a meeting's time passes, and the day turns
    return () => {
      alive = false;
      off();
      clearInterval(tick);
    };
  },
};
