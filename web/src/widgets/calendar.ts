//   ::calendar{folder=Journal}
// A month of daily notes (Journal/YYYY-MM-DD.md), shaded by how much you wrote. Click a day to
// open it, or to start it if it doesn't exist yet.
import { api, type NoteMeta } from "../api.ts";
import { el, icon } from "../dom.ts";
import { onVaultChange } from "../events.ts";
import type { WidgetSpec } from "./core.ts";

const prevent = (e: Event) => e.preventDefault();
const iso = (d: Date) => d.toLocaleDateString("en-CA"); // YYYY-MM-DD in local time

export const calendar: WidgetSpec = {
  name: "calendar",
  title: "Journal",
  icon: "calendar",
  hint: "Month of daily notes; click a day to open it",
  keywords: "calendar journal daily notes month diary",
  defaults: { folder: "Journal" },
  fields: [
    { key: "label", label: "Label", type: "text", placeholder: "Optional" },
    { key: "folder", label: "Folder", type: "text", placeholder: "Journal" },
  ],

  mount(body, env) {
    const folder = (env.args.folder || "Journal").replace(/^\/+|\/+$/g, "");
    const start = env.args.month?.match(/^(\d{4})-(\d{2})$/);
    let month = start ? new Date(Number(start[1]), Number(start[2]) - 1, 1) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    let days = new Map<string, NoteMeta>();
    let alive = true;

    const title = el("div", { class: "qc-title" });
    const stats = el("div", { class: "qc-stats" });
    const grid = el("div", { class: "qc-grid" });
    const nav = (delta: number) => () => {
      month = new Date(month.getFullYear(), month.getMonth() + delta, 1);
      render();
    };
    body.append(
      el(
        "div",
        { class: "qc-head" },
        title,
        el("span", { class: "spacer" }),
        el("button", { type: "button", class: "qw-icon is-prev", title: "Previous month", onmousedown: prevent, onclick: nav(-1) }, icon("chevron", 15)),
        el("button", { type: "button", class: "qc-today", onmousedown: prevent, onclick: () => ((month = new Date(new Date().getFullYear(), new Date().getMonth(), 1)), render()) }, "Today"),
        el("button", { type: "button", class: "qw-icon", title: "Next month", onmousedown: prevent, onclick: nav(1) }, icon("chevron", 15)),
      ),
      grid,
      stats,
    );

    async function load() {
      const notes = await api.notes().catch(() => null);
      if (!alive || !notes) return;
      days = new Map(
        notes.flatMap((n) => {
          const m = n.path.match(new RegExp(`^${folder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/(\\d{4}-\\d{2}-\\d{2})\\.md$`));
          return m ? [[m[1], n] as const] : [];
        }),
      );
      render();
    }

    function render() {
      title.textContent = month.toLocaleDateString(undefined, { month: "long", year: "numeric" });
      const today = iso(new Date());
      const first = (month.getDay() + 6) % 7; // weeks start on Monday
      const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
      const cells: HTMLElement[] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => el("span", { class: "qc-dow" }, d));
      for (let i = 0; i < first; i++) cells.push(el("span", {}));
      let written = 0;
      for (let d = 1; d <= count; d++) {
        const date = iso(new Date(month.getFullYear(), month.getMonth(), d));
        const note = days.get(date);
        if (note) written++;
        const level = !note ? 0 : note.size < 150 ? 1 : note.size < 700 ? 2 : 3;
        cells.push(
          el(
            "button",
            {
              type: "button",
              class: `qc-day${level ? ` l${level}` : ""}${date === today ? " is-today" : ""}${date > today ? " is-future" : ""}`,
              title: note ? `${date} · ${note.title}` : `Start ${date}`,
              onmousedown: prevent,
              onclick: () => void openDay(date),
            },
            String(d),
          ),
        );
      }
      grid.replaceChildren(...cells);
      let streak = 0;
      for (let d = new Date(); days.has(iso(d)); d.setDate(d.getDate() - 1)) streak++;
      stats.textContent = `${written} ${written === 1 ? "entry" : "entries"} this month${streak ? ` · ${streak}-day streak` : ""}`;
      env.remeasure();
    }

    async function openDay(date: string) {
      const path = `${folder}/${date}.md`;
      if (!days.has(date)) await api.create(path, `# ${date}\n\n## Log\n\n`).catch(() => {});
      env.open(path);
    }

    void load();
    const off = onVaultChange(load);
    return () => {
      alive = false;
      off();
    };
  },
};
