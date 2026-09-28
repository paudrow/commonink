//   ::tasks{folder=Projects label="Launch"}      ::tasks{note="Quire roadmap" status=all}
// Every checkbox across the vault (or a folder / one note), grouped by note. Ticking one here
// edits the note it lives in, so agents and people can add tasks anywhere and clear them in one place.
import { marked } from "marked";
import DOMPurify from "dompurify";
import { api, type Task } from "../api.ts";
import { el, icon } from "../dom.ts";
import { onVaultChange } from "../events.ts";
import type { WidgetSpec } from "./core.ts";
import { tagsInLine } from "../../../src/core/tags.ts";

type Show = "open" | "done" | "all";
const prevent = (e: Event) => e.preventDefault();

export const tasks: WidgetSpec = {
  name: "tasks",
  title: "Tasks",
  icon: "task",
  hint: "Open tasks from across your notes",
  keywords: "tasks todo checklist rollup dashboard",
  defaults: {},
  fields: [
    { key: "label", label: "Label", type: "text", placeholder: "This week, Launch…" },
    { key: "folder", label: "Folder", type: "text", placeholder: "Every note, or e.g. Projects" },
    { key: "note", label: "Note", type: "text", placeholder: "Just one note (optional)" },
    { key: "tag", label: "Tag", type: "text", placeholder: "e.g. work (includes work/…)" },
  ],

  mount(body, env) {
    let show: Show = (["open", "done", "all"] as const).find((s) => s === env.args.status) ?? "open";
    let all: Task[] = [];
    let expanded = false;
    let alive = true;
    const limit = Number(env.args.limit) || 12;

    const summary = el("div", { class: "qt-summary" });
    const bar = el("span");
    const seg = el("div", { class: "seg qt-seg" });
    const list = el("div", { class: "qt-list" });
    body.append(el("div", { class: "qt-top" }, summary, el("span", { class: "spacer" }), seg), el("div", { class: "qt-progress" }, bar), list);

    async function load() {
      const t = await api.tasks({ folder: env.args.folder, note: env.args.note, tag: env.args.tag }).catch(() => null);
      if (!alive || !t) return;
      all = t;
      render();
    }

    function render() {
      const done = all.filter((t) => t.done).length;
      summary.textContent = all.length ? `${done} of ${all.length} done` : "No tasks yet";
      bar.style.width = `${all.length ? (done / all.length) * 100 : 0}%`;
      seg.replaceChildren(
        ...(["open", "done", "all"] as Show[]).map((s) =>
          el("button", { type: "button", class: s === show ? "is-on" : "", onmousedown: prevent, onclick: () => ((show = s), render()) }, s[0].toUpperCase() + s.slice(1)),
        ),
      );
      const visible = all.filter((t) => show === "all" || (show === "done") === t.done);
      const shown = expanded ? visible : visible.slice(0, limit);
      const groups = new Map<string, Task[]>();
      for (const t of shown) groups.set(t.path, [...(groups.get(t.path) ?? []), t]);
      list.replaceChildren(
        ...(shown.length
          ? [...groups].map(([path, ts]) =>
              el(
                "div",
                { class: "qt-group" },
                el("button", { type: "button", class: "qt-note", onmousedown: prevent, onclick: () => env.open(path) }, icon("file", 13), ts[0].title),
                ...ts.map(row),
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
      const text = el("span", { class: "qt-text", html: inline(t.text), title: `${t.title}, line ${t.line}` });
      text.addEventListener("mousedown", prevent);
      text.addEventListener("click", (e) => {
        const tag = (e.target as HTMLElement).closest<HTMLElement>(".tag")?.dataset.tag;
        if (tag) env.openTag(tag);
        else env.open(t.path, t.line);
      });
      return el("div", { class: `qt-row${t.done ? " is-done" : ""}` }, box, text, t.heading && t.heading !== t.title ? el("span", { class: "qt-where" }, t.heading) : null);
    }

    async function toggle(t: Task) {
      const next = !t.done;
      try {
        await api.setTask(t, next); // the source note changes; the vault event reloads the list
        t.done = next;
        render();
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
function inline(md: string): string {
  const hits = tagsInLine(md);
  let text = md;
  for (let i = hits.length - 1; i >= 0; i--) text = `${text.slice(0, hits[i].from - 1)}\u0003${i}\u0004${text.slice(hits[i].to)}`;
  const withLinks = text.replace(/\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g, (_m, t: string, alias?: string) => `\u0001${alias ?? t}\u0002`);
  const html = DOMPurify.sanitize(marked.parseInline(withLinks, { async: false }) as string, { FORBID_TAGS: ["img", "style"] });
  return html
    .replace(/\u0001([^\u0002]*)\u0002/g, '<span class="qt-link">$1</span>') // already escaped by marked
    .replace(/\u0003(\d+)\u0004/g, (_m, i) => `<span class="tag" data-tag="${hits[+i].tag}" title="Tasks tagged #${hits[+i].display}">#${hits[+i].display}</span>`); // tags are letters, digits, _ - /
}
