//   ::tasks{folder=Projects label="Launch"}   ::tasks{note="Quire roadmap" status=all}   ::tasks{tag=work due<=today group=due}
// Every checkbox across the vault (or a folder, a note, a tag, a person, a due date), grouped by note
// or by due date, priority, tag or person. Ticking one, or changing its details, edits the note it
// lives in, so agents and people can add tasks anywhere and clear them in one place.
import { marked } from "marked";
import DOMPurify from "dompurify";
import { api, type Task, type TaskPatch } from "../api.ts";
import { el, icon } from "../dom.ts";
import { onVaultChange } from "../events.ts";
import type { WidgetSpec } from "./core.ts";
import { tagsInLine } from "../../../src/core/tags.ts";
import { addDays } from "../../../src/core/tasks.ts";
import { endTags, metaChips, today } from "../taskChips.ts";
import { openChipEditor, openTaskMenu, taskPeople } from "../taskChipEditors.ts";

type Show = "open" | "done" | "all";
type Group = "note" | "due" | "priority" | "tag" | "person";
type Sort = "note" | "due" | "priority";
const GROUPS: Record<Group, string> = { note: "By note", due: "By due date", priority: "By priority", tag: "By tag", person: "By person" };
const SORTS: Record<Sort, string> = { note: "Note order", due: "Due first", priority: "Priority first" };
const PRIORITY = { high: 0, none: 1, low: 2 };
const prevent = (e: Event) => e.preventDefault();

/** Where a task goes when grouped `by`: one group, or one per tag or person. `rank` orders the groups. */
function groupsOf(t: Task, by: Group, now: string): Array<{ key: string; label: string; rank: string }> {
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
      return m.assignees.length ? m.assignees.map((a) => ({ key: a.toLowerCase(), label: `@${a}`, rank: a.toLowerCase() })) : [{ key: "", label: "Unassigned", rank: "￿" }];
  }
}

const SORTERS: Record<Sort, (a: Task, b: Task) => number> = {
  note: () => 0,
  due: (a, b) => (a.meta.due ?? "~").localeCompare(b.meta.due ?? "~"),
  priority: (a, b) => PRIORITY[a.meta.priority ?? "none"] - PRIORITY[b.meta.priority ?? "none"] || (a.meta.due ?? "~").localeCompare(b.meta.due ?? "~"),
};

export const tasks: WidgetSpec = {
  name: "tasks",
  title: "Tasks",
  icon: "task",
  hint: "Open tasks from across your notes",
  keywords: "tasks todo checklist rollup dashboard due",
  defaults: {},
  fields: [
    { key: "label", label: "Label", type: "text", placeholder: "This week, Launch…" },
    { key: "folder", label: "Folder", type: "text", placeholder: "Every note, or e.g. Projects" },
    { key: "note", label: "Note", type: "text", placeholder: "Just one note (optional)" },
    { key: "tag", label: "Tag", type: "text", placeholder: "e.g. work (includes work/…)" },
    { key: "assignee", label: "Person", type: "text", placeholder: "e.g. jane" },
    { key: "due", label: "Due", type: "text", placeholder: "<=today, tomorrow, >=2026-10-01" },
    { key: "group", label: "Group", type: "text", placeholder: "note, due, priority, tag or person" },
  ],

  mount(body, env) {
    let show: Show = (["open", "done", "all"] as const).find((s) => s === env.args.status) ?? "open";
    let group: Group = Object.hasOwn(GROUPS, env.args.group ?? "") ? (env.args.group as Group) : "note";
    let sort: Sort = Object.hasOwn(SORTS, env.args.sort ?? "") ? (env.args.sort as Sort) : "note";
    let all: Task[] = [];
    let problem = "";
    let expanded = false;
    let alive = true;
    const limit = Number(env.args.limit) || 12;

    const summary = el("div", { class: "qt-summary" });
    const bar = el("span");
    const seg = el("div", { class: "seg qt-seg" });
    const select = <T extends string>(options: Record<T, string>, value: () => T, set: (v: T) => void) => {
      const s = el("select", { class: "qt-select", onmousedown: (e: Event) => e.stopPropagation() }, ...Object.entries(options).map(([k, label]) => el("option", { value: k }, label as string)));
      s.value = value();
      s.addEventListener("change", () => (set(s.value as T), render()));
      return s;
    };
    const groupSel = select(GROUPS, () => group, (v) => (group = v));
    const sortSel = select(SORTS, () => sort, (v) => (sort = v));
    const list = el("div", { class: "qt-list" });
    body.append(el("div", { class: "qt-top" }, summary, el("span", { class: "spacer" }), groupSel, sortSel, seg), el("div", { class: "qt-progress" }, bar), list);

    async function load() {
      try {
        const t = await api.tasks({ folder: env.args.folder, note: env.args.note, tag: env.args.tag, assignee: env.args.assignee, due: env.args.due, today: today() });
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
      bar.style.width = `${all.length ? (done / all.length) * 100 : 0}%`;
      seg.replaceChildren(
        ...(["open", "done", "all"] as Show[]).map((s) =>
          el("button", { type: "button", class: s === show ? "is-on" : "", onmousedown: prevent, onclick: () => ((show = s), render()) }, s[0].toUpperCase() + s.slice(1)),
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
        for (const g of groupsOf(t, group, now)) {
          if (!groups.has(g.key)) groups.set(g.key, { label: g.label, rank: g.rank, tasks: [] });
          groups.get(g.key)!.tasks.push(t);
        }
      }
      const ordered = group === "note" ? [...groups] : [...groups].sort(([, a], [, b]) => a.rank.localeCompare(b.rank));
      list.replaceChildren(
        ...(problem
          ? [el("div", { class: "qt-empty" }, problem)]
          : shown.length
            ? ordered.map(([key, g]) =>
                el(
                  "div",
                  { class: "qt-group" },
                  group === "note"
                    ? el("button", { type: "button", class: "qt-note", onmousedown: prevent, onclick: () => env.open(key) }, icon("file", 13), g.label)
                    : el("div", { class: "qt-note is-label" }, g.label, el("span", { class: "n" }, String(g.tasks.length))),
                  ...g.tasks.map(row),
                ),
              )
            : [el("div", { class: "qt-empty" }, show === "open" && all.length ? "All done." : "Nothing here.")]),
        ...(visible.length > shown.length
          ? [el("button", { type: "button", class: "qt-more", onmousedown: prevent, onclick: () => ((expanded = true), render()) }, `Show ${visible.length - shown.length} more`)]
          : []),
      );
      env.remeasure();
    }

    function row(t: Task) {
      const box = el("span", { class: `cm-checkbox${t.done ? " is-checked" : ""}`, role: "checkbox", "aria-checked": String(t.done), title: t.done ? "Mark open" : "Mark done" });
      box.addEventListener("mousedown", (e) => {
        e.preventDefault();
        void toggle(t);
      });
      const words = el("span", { class: "qt-words", html: inline(t.summary) });
      const text = el("span", { class: "qt-text", title: `${t.title}, line ${t.line}` }, words, ...metaChips(t.meta, t.done, endTags(t.summary, t.meta.tags))); // tags mid-sentence stay there
      const save = async (patch: TaskPatch) => {
        Object.assign(t, await api.updateTask(t, patch)); // its new text, for the next change
        void load();
      };
      const ctx = { task: t, save, people: taskPeople, showPerson: env.openPerson };
      text.addEventListener("mousedown", (e) => {
        // A click on the words edits them, so let that one place the caret; chips and tags keep focus where it is.
        const target = e.target as HTMLElement;
        if (target.closest(".qt-input")) return; // placing the caret or selecting in the open edit
        if (!target.closest(".qt-words") || e.metaKey || e.ctrlKey) prevent(e);
      });
      text.addEventListener("click", (e) => {
        const target = e.target as HTMLElement;
        if (e.metaKey || e.ctrlKey) return env.open(t.path, t.line); // ⌘-click: the note, at this line
        const chip = target.closest<HTMLElement>(".tk[data-field]");
        const tag = chip?.dataset.field === "tags" ? chip.dataset.value!.toLowerCase() : target.closest<HTMLElement>(".tag")?.dataset.tag;
        if (tag) env.openTag(tag);
        else if (chip) openChipEditor(chip, ctx);
        else if (target.closest(".qt-words")) editWords(t, words, save);
      });
      const menu = el("button", { type: "button", class: "qt-act", title: "Priority, due, repeat, person, tags…", "aria-label": "Task fields", onmousedown: prevent }, icon("sliders", 13));
      menu.addEventListener("click", () => openTaskMenu(menu, ctx));
      const go = el("button", { type: "button", class: "qt-act", title: "Go to note", "aria-label": `Go to ${t.title}, line ${t.line}`, onmousedown: prevent, onclick: () => env.open(t.path, t.line) }, icon("open", 13));
      const where = group === "note" ? (t.heading && t.heading !== t.title ? t.heading : null) : t.title;
      return el("div", { class: `qt-row${t.done ? " is-done" : ""}` }, box, text, where ? el("span", { class: "qt-where" }, where) : null, menu, go);
    }

    /**
     * Edit a task's words in place: an input over them, its chips left as they are. Enter or leaving
     * the input saves (only the words change; the core leaves the tokens be), Escape puts them back.
     */
    function editWords(t: Task, words: HTMLElement, save: (patch: TaskPatch) => Promise<void>) {
      const input = el("input", { class: "qt-input", value: t.summary, "aria-label": "Task text", spellcheck: "true" });
      let done = false;
      const finish = (keep: boolean) => {
        if (done) return;
        done = true;
        const next = input.value.trim();
        input.replaceWith(words);
        if (keep && next && next !== t.summary) {
          words.innerHTML = inline(next); // show it now; the reload confirms it
          void save({ summary: next }).catch((e) => {
            words.innerHTML = inline(t.summary);
            alert(e instanceof Error ? e.message : "Couldn't change the task");
          });
        }
      };
      input.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter") (e.preventDefault(), finish(true));
        else if (e.key === "Escape") (e.preventDefault(), finish(false));
      });
      input.addEventListener("blur", () => finish(true));
      input.addEventListener("click", (e) => e.stopPropagation());
      words.replaceWith(input);
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }

    async function toggle(t: Task) {
      const next = !t.done;
      try {
        const r = await api.setTask(t, next);
        Object.assign(t, { done: next, line: r.line, text: r.text }); // ticking adds done:, so the text changed too
        render();
        void load();
      } catch {
        void load(); // the note changed underneath us: show what's there now
      }
    }

    void load();
    const off = onVaultChange(load);
    return () => {
      alive = false;
      off();
    };
  },
};

/** Task text as inline markdown; [[links]] shown by name, #tags as chips. */
export function inline(md: string): string {
  const hits = tagsInLine(md);
  let text = md;
  for (let i = hits.length - 1; i >= 0; i--) text = `${text.slice(0, hits[i].from - 1)}\u0003${i}\u0004${text.slice(hits[i].to)}`;
  const withLinks = text.replace(/\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g, (_m, t: string, alias?: string) => `\u0001${alias ?? t}\u0002`);
  const html = DOMPurify.sanitize(marked.parseInline(withLinks, { async: false }) as string, { FORBID_TAGS: ["img", "style"] });
  return html
    .replace(/\u0001([^\u0002]*)\u0002/g, '<span class="qt-link">$1</span>') // already escaped by marked
    .replace(/\u0003(\d+)\u0004/g, (_m, i) => `<span class="tag" data-tag="${hits[+i].tag}" title="Tasks tagged #${hits[+i].display}">#${hits[+i].display}</span>`); // tags are letters, digits, _ - /
}
