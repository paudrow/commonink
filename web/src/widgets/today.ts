//   ::today   ::today{label="My day"}
// The day at a glance: open tasks overdue, due today and starting today, then today's journal
// note (open it, or start it from the daily template). The Today page is this widget with the
// quick-add bar above it. Sections come from the core (Quire.today), so new kinds slot in there.
import { api, type TodayView } from "../api.ts";
import { el, icon } from "../dom.ts";
import { onVaultChange } from "../events.ts";
import type { WidgetSpec } from "./core.ts";
import { today } from "../taskChips.ts";
import { taskRow } from "../taskRow.ts";

const EMPTY: Record<string, string> = { overdue: "Nothing overdue.", due: "Nothing due today.", starting: "Nothing starts today." };

export const todayWidget: WidgetSpec = {
  name: "today",
  title: "Today",
  icon: "sun",
  hint: "Overdue, due today and starting today, and today's journal note",
  keywords: "today day agenda brief morning journal due overdue",
  defaults: {},
  fields: [{ key: "label", label: "Label", type: "text", placeholder: "My day" }],

  mount(body, env) {
    let view: TodayView | null = null;
    let problem = "";
    let alive = true;
    const list = el("div", { class: "td-list" });
    body.append(list);

    async function load() {
      try {
        const v = await api.today(today());
        if (!alive) return;
        [view, problem] = [v, ""];
      } catch (e) {
        if (!alive) return;
        [view, problem] = [null, e instanceof Error ? e.message : "Couldn't load today"];
      }
      render();
    }

    function render() {
      if (!view) {
        list.replaceChildren(el("div", { class: "qt-empty" }, problem || "Loading…"));
        return env.remeasure();
      }
      const rowEnv = { open: env.open, openTag: env.openTag, openPerson: env.openPerson, reload: () => void load() };
      const nothing = view.sections.every((s) => !s.tasks.length);
      list.replaceChildren(
        ...view.sections.map((s) =>
          el(
            "section",
            { class: `td-section is-${s.id}${s.tasks.length ? "" : " is-empty"}` },
            el("div", { class: "qt-note is-label" }, s.title, el("span", { class: "n" }, String(s.tasks.length))),
            ...(s.tasks.length ? s.tasks.map((t) => taskRow(t, rowEnv, t.title)) : [el("div", { class: "td-none" }, EMPTY[s.id] ?? "Nothing here.")]),
          ),
        ),
        nothing ? el("div", { class: "td-clear" }, icon("check", 14), "A clear day. Add a task above, or pick one from Tasks.") : "",
        journal(view),
      );
      env.remeasure();
    }

    /** Today's journal note: open it, or start it from the daily template. */
    function journal(v: TodayView) {
      const open = async () => {
        if (!v.journal.exists) await api.dailyNote(v.date).catch(() => null);
        env.open(v.journal.path);
      };
      return el(
        "section",
        { class: "td-section is-journal" },
        el("div", { class: "qt-note is-label" }, "Journal"),
        el(
          "button",
          { type: "button", class: "td-journal", onmousedown: (e: Event) => e.preventDefault(), onclick: () => void open() },
          icon(v.journal.exists ? "file" : "plus", 14),
          el("span", {}, v.journal.exists ? "Open today's note" : "Start today's note"),
          el("span", { class: "td-path" }, v.journal.path.replace(/\.md$/, "")),
        ),
      );
    }

    void load();
    const off = onVaultChange(load);
    return () => {
      alive = false;
      off();
    };
  },
};
