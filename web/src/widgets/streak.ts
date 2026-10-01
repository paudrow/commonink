//   ::streak   ::streak{label="Writing days"}
// The days you wrote in the last 12 weeks, as a heatmap, with how many days in a row you've written
// and your longest run in those weeks: the same as the popover on the sidebar's streak chip.
import { el } from "../dom.ts";
import { onVaultChange } from "../events.ts";
import { writingDays, writingSummary } from "../streak.ts";
import type { WidgetSpec } from "./core.ts";

export const streak: WidgetSpec = {
  name: "streak",
  title: "Writing days",
  icon: "drop",
  hint: "The days you wrote, and how many in a row",
  keywords: "streak writing days habit heatmap calendar contributions",
  defaults: {},
  fields: [{ key: "label", label: "Label", type: "text", placeholder: "My writing" }],

  mount(body, env) {
    let alive = true;
    body.replaceChildren(el("div", { class: "qt-empty" }, "Loading…"));
    const load = async () => {
      try {
        const days = await writingDays();
        if (alive) body.replaceChildren(writingSummary(days));
      } catch {
        if (alive) body.replaceChildren(el("div", { class: "qt-empty" }, "Couldn't load your writing days"));
      }
      env.remeasure();
    };
    void load();
    const off = onVaultChange(() => void load(), 4000);
    return () => {
      alive = false;
      off();
    };
  },
};
