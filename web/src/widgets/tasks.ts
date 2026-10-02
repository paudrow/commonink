//   ::tasks{folder=Projects label="Launch"}   ::tasks{note="Common Ink roadmap" status=all}   ::tasks{tag=work due<=today group=due}
// Every checkbox across the vault (or a folder, a note, a tag, a person, a due date), grouped by note
// or by due date, priority, tag or person. Ticking one, or changing its details, edits the note it
// lives in, so agents and people can add tasks anywhere and clear them in one place.
import { api, type Task } from "../api.ts";
import { el, icon } from "../dom.ts";
import { onVaultChange } from "../events.ts";
import type { WidgetSpec } from "./core.ts";
import { sideClick } from "../panes.ts";
import { addDays } from "../../../src/core/tasks.ts";
import { today } from "../taskChips.ts";
import { redrawRows, taskRow } from "../taskRow.ts";
import { assignees } from "../people.ts";
import { personFor, type Person } from "../../../src/core/contacts.ts";

type Show = "open" | "done" | "all";
type Group = "note" | "due" | "priority" | "tag" | "person";
type Sort = "note" | "due" | "priority";
const GROUPS: Record<Group, string> = { note: "By note", due: "By due date", priority: "By priority", tag: "By tag", person: "By person" };
const SORTS: Record<Sort, string> = { note: "Note order", due: "Due first", priority: "Priority first" };
const PRIORITY = { high: 0, none: 1, low: 2 };
const prevent = (e: Event) => e.preventDefault();

/**
 * Where a task goes when grouped `by`: one group, or one per tag or person. `rank` orders the
 * groups. A person is one group however they're written (@JD, @Jane-Doe), under their name.
 */
function groupsOf(t: Task, by: Group, now: string, people: Person[]): Array<{ key: string; label: string; rank: string }> {
  const m = t.meta;
  switch (by) {
    case "note":
      return [{ key: t.path, label: t.title, rank: "" }];
    case "due": {
      const d = m.due?.slice(0, 10);
      if (!d) return [{ key: "none", label: "No due date", rank: "4" }];
      if (d < now) return [{ key: "overdue", label: "Overdue", rank: "0" }];
      if (d === now) return [{ key: "today", label: "Today", rank: "1" }];
      return d <= addDays(now, 7) ? [{ key: "week", label: "Next 7 days", rank: "2" }] : [{ key: "later", label: "Later", rank: "3" }];
    }
    case "priority":
      return [{ key: m.priority ?? "none", label: m.priority === "high" ? "High priority" : m.priority === "low" ? "Low priority" : "No priority", rank: String(PRIORITY[m.priority ?? "none"]) }];
    case "tag":
      return m.tags.length ? m.tags.map((tag) => ({ key: tag.toLowerCase(), label: `#${tag}`, rank: tag.toLowerCase() })) : [{ key: "", label: "No tag", rank: "￿" }];
    case "person":
      if (!m.assignees.length) return [{ key: "", label: "Unassigned", rank: "￿" }];
      return [
        ...new Map(
          m.assignees.map((a) => {
            const p = personFor(a, people);
            return [p ? `p:${p.name.toLowerCase()}` : a.toLowerCase(), { key: p ? `p:${p.name.toLowerCase()}` : a.toLowerCase(), label: p ? p.name : `@${a}`, rank: (p?.name ?? a).toLowerCase() }];
          }),
        ).values(),
      ];
  }
}

const SORTERS: Record<Sort, (a: Task, b: Task) => number> = {
  note: () => 0,
  due: (a, b) => (a.meta.due ?? "~").localeCompare(b.meta.due ?? "~"),
  priority: (a, b) => PRIORITY[a.meta.priority ?? "none"] - PRIORITY[b.meta.priority ?? "none"] || (a.meta.due ?? "~").localeCompare(b.meta.due ?? "~"),
};

export const tasks: WidgetSpec = {
  name: "tasks",
  title: "Task list",
  icon: "task",
  hint: "Open tasks from across your notes",
  keywords: "tasks todo checklist rollup dashboard due",
  defaults: {},
  fields: [
    { key: "label", label: "Title", type: "text", placeholder: "This week, Launch…" },
    { key: "folder", label: "Folder", type: "text", placeholder: "Every note, or e.g. Projects" },
    { key: "note", label: "Note", type: "text", placeholder: "Just one note (optional)" },
    { key: "tag", label: "Tag", type: "text", placeholder: "e.g. work (includes work/…)" },
    { key: "assignee", label: "Person", type: "text", placeholder: "e.g. jane, or me" },
    { key: "due", label: "Due", type: "text", placeholder: "<=today, tomorrow, >=2026-10-01" },
    { key: "group", label: "Group", type: "text", placeholder: "note, due, priority, tag or person" },
  ],

  mount(body, env) {
    let show: Show = (["open", "done", "all"] as const).find((s) => s === env.args.status) ?? "open";
    let group: Group = Object.hasOwn(GROUPS, env.args.group ?? "") ? (env.args.group as Group) : "note";
    let sort: Sort = Object.hasOwn(SORTS, env.args.sort ?? "") ? (env.args.sort as Sort) : "note";
    let all: Task[] = [];
    /** Who each @name is, for grouping by person. */
    let people: Person[] = [];
    let problem = "";
    let expanded = false;
    let alive = true;
    const limit = Number(env.args.limit) || 12;

    const summary = el("div", { class: "qt-summary" });
    const bar = el("span");
    const seg = el("div", { class: "seg qt-seg", role: "group", "aria-label": "Show" });
    const select = <T extends string>(label: string, options: Record<T, string>, value: () => T, set: (v: T) => void) => {
      const s = el("select", { class: "qt-select", "aria-label": label, onmousedown: (e: Event) => e.stopPropagation() }, ...Object.entries(options).map(([k, label]) => el("option", { value: k }, label as string)));
      s.value = value();
      s.addEventListener("change", () => (set(s.value as T), render()));
      return s;
    };
    const groupSel = select("Group", GROUPS, () => group, (v) => ((group = v), v === "person" && !people.length && void assignees().then((a) => ((people = a.directory), render())).catch(() => {})));
    const sortSel = select("Sort", SORTS, () => sort, (v) => (sort = v));
    const list = el("div", { class: "qt-list" });
    const top = el("div", { class: "qt-top" }, summary, el("span", { class: "spacer" }), groupSel, sortSel, seg);
    const progress = el("div", { class: "qt-progress" }, bar);
    body.append(top, progress, list);

    async function load() {
      try {
        const by = env.args.by === "me" ? ("me" as const) : undefined;
        const [t, who] = await Promise.all([
          api.tasks({ folder: env.args.folder, note: env.args.note, tag: env.args.tag, assignee: env.args.assignee, by, due: env.args.due, today: today() }),
          group === "person" ? assignees().then((a) => a.directory).catch(() => people) : Promise.resolve(people),
        ]);
        people = who;
        if (!alive) return;
        [all, problem] = [t, ""];
      } catch (e) {
        if (!alive) return;
        [all, problem] = [[], e instanceof Error ? e.message : "Couldn't load tasks"];
      }
      render();
    }

    function render() {
      const now = today();
      const done = all.filter((t) => t.done).length;
      summary.textContent = all.length ? `${done} of ${all.length} done` : "No tasks yet";
      const blank = !all.length && !problem && !!env.empty;
      top.hidden = progress.hidden = blank;
      bar.style.width = `${all.length ? (done / all.length) * 100 : 0}%`;
      seg.replaceChildren(
        ...(["open", "done", "all"] as Show[]).map((s) =>
          el("button", { type: "button", class: s === show ? "is-on" : "", "aria-pressed": String(s === show), onmousedown: prevent, onclick: () => ((show = s), render()) }, s[0].toUpperCase() + s.slice(1)),
        ),
      );
      // Open tasks that start later stay out of the way until then; All shows them.
      const later = (t: Task) => !!t.meta.start && t.meta.start.slice(0, 10) > now;
      const order = new Map(all.map((t, i) => [t, i]));
      const visible = all
        .filter((t) => (show === "all" || (show === "done") === t.done) && !(show === "open" && later(t)))
        .sort((a, b) => SORTERS[sort](a, b) || order.get(a)! - order.get(b)!);
      const shown = expanded ? visible : visible.slice(0, limit);
      const groups = new Map<string, { label: string; rank: string; tasks: Task[] }>();
      for (const t of shown) {
        for (const g of groupsOf(t, group, now, people)) {
          if (!groups.has(g.key)) groups.set(g.key, { label: g.label, rank: g.rank, tasks: [] });
          groups.get(g.key)!.tasks.push(t);
        }
      }
      const ordered = group === "note" ? [...groups] : [...groups].sort(([, a], [, b]) => a.rank.localeCompare(b.rank));
      redrawRows(list, () => list.replaceChildren(
        ...(problem
          ? [el("div", { class: "qt-empty" }, problem)]
          : shown.length
            ? ordered.map(([key, g]) =>
                el(
                  "div",
                  { class: "qt-group" },
                  group === "note"
                    ? el("button", { type: "button", class: "qt-note", onmousedown: prevent, onclick: (e: MouseEvent) => env.open(key, undefined, sideClick(e)) }, icon("file", 13), g.label)
                    : el("div", { class: "qt-note is-label" }, g.label, el("span", { class: "n" }, String(g.tasks.length))),
                  ...g.tasks.map(row),
                ),
              )
            : [blank ? env.empty!() : el("div", { class: "qt-empty" }, show === "open" && all.length ? "All done." : "Nothing here.")]),
        ...(visible.length > shown.length
          ? [el("button", { type: "button", class: "qt-more", onmousedown: prevent, onclick: () => ((expanded = true), render()) }, `Show ${visible.length - shown.length} more`)]
          : []),
      ));
      env.remeasure();
    }

    function row(t: Task) {
      const where = group === "note" ? (t.heading && t.heading !== t.title ? t.heading : null) : t.title;
      return taskRow(t, { open: env.open, openTag: env.openTag, openPerson: env.openPerson, reload: () => void load() }, where);
    }

    void load();
    const off = onVaultChange(load);
    return () => {
      alive = false;
      off();
    };
  },
};
