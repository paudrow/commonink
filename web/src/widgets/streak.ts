//   ::streak   ::streak{folder=Journal}   ::streak{tag=work}
// The days you wrote, as a heatmap as many weeks wide as fits (12 to a year), with how many days in a row you've written
// and your longest run in those weeks: the Today page's writing days, to embed in a note. A folder
// or a tag narrows it to those notes, so ::streak{folder=Journal} is your journaling days, and its
// header says so ("Writing days in Journal").
import { el } from "../dom.ts";
import { onVaultChange } from "../events.ts";
import { COUNTS, writingDays, writingSummary } from "../streak.ts";
import { streakTitle } from "../writingDays.ts";
import type { WidgetSpec } from "./core.ts";

export const streak: WidgetSpec = {
  name: "streak",
  title: "Writing days",
  heading: streakTitle,
  icon: "drop",
  hint: "The days you wrote, and how many in a row",
  keywords: "streak writing days habit heatmap calendar contributions",
  defaults: {},
  fields: [
    { key: "folder", label: "Folder", type: "text", placeholder: "Every folder", picker: "folder" },
    { key: "tag", label: "Tag", type: "text", placeholder: "Any tag (includes work/…)", picker: "tag" },
  ],

  mount(body, env) {
    let alive = true;
    body.replaceChildren(el("div", { class: "qt-empty" }, "Loading…"));
    const filter = { folder: env.args.folder, tag: env.args.tag };
    const load = async () => {
      try {
        const days = await writingDays(filter);
        if (alive) body.replaceChildren(writingSummary(days), el("p", { class: "wd-what" }, COUNTS));
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
