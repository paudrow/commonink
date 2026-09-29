// How a task's tokens look, in the editor and in task lists: a priority flag, a date pill, a repeat
// mark, a person, a tag. The markdown keeps the tokens; these only draw them. Each chip says which
// token it is (data-field, data-value), so a task list can open that token's editor.
import { avatar, el, icon } from "./dom.ts";
import { localDate, parseTask, recLabel, TASK_LINE, type ParsedTask, type TaskMeta } from "../../src/core/tasks.ts";
import { tagsInLine } from "../../src/core/tags.ts";

export const today = () => localDate(Date.now());

/** "Today", "Tomorrow", "Yesterday", "Oct 1", or "Oct 1, 2027", then the time if there is one. */
export function dayLabel(value: string, now = today()): string {
  const day = value.slice(0, 10);
  const at = (n: number) => localDate(new Date(`${now}T12:00:00`).getTime() + n * 86_400_000);
  const d = new Date(`${day}T12:00:00`);
  const name =
    day === now ? "Today" : day === at(1) ? "Tomorrow" : day === at(-1) ? "Yesterday"
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(day.slice(0, 4) === now.slice(0, 4) ? {} : { year: "numeric" }) });
  return value.length > 10 ? `${name} ${value.slice(11)}` : name;
}

export type ChipField = keyof Omit<TaskMeta, "tags" | "assignees"> | "assignees" | "tags";

/** One token as a chip. `done` mutes a due date that would otherwise show as overdue. */
export function tokenChip(field: ChipField, value: string, opts: { done?: boolean; now?: string } = {}): HTMLElement {
  const now = opts.now ?? today();
  const chip = (cls: string, title: string, ...children: Array<Node | string>) =>
    el("span", { class: `tk ${cls}`.trim(), title, "data-field": field, "data-value": value }, ...children);
  switch (field) {
    case "due": {
      const state = opts.done ? "" : value.slice(0, 10) < now ? " is-overdue" : value.slice(0, 10) === now ? " is-today" : "";
      return chip(`tk-due${state}`, `Due ${value}`, icon("calendar", 12), dayLabel(value, now));
    }
    case "start":
      return chip("", `Hidden until ${value}`, icon("clock", 12), `from ${dayLabel(value, now)}`);
    case "done":
      return chip("tk-muted", `Done ${value}`, icon("check", 12), dayLabel(value, now));
    case "rec":
      return chip("", `Repeats ${recLabel(value)}`, icon("reset", 12), recLabel(value));
    case "priority":
      return chip(`tk-priority is-${value}`, `${value === "high" ? "High" : "Low"} priority`, icon("flag", 12), value === "high" ? "High" : "Low");
    case "assignees":
      return chip("tk-person", `@${value}`, avatar(value, 14), value);
    case "tags":
      return chip("tk-tag", `Tasks tagged #${value}`, `#${value}`);
  }
}

/**
 * A task's chips in one fixed order, whatever order its tokens are in: priority, due (and a start
 * still ahead), repeat, people, then `tags` sorted by name, and done last.
 */
export function metaChips(meta: TaskMeta, done: boolean, tags: string[] = []): HTMLElement[] {
  const now = today();
  return [
    meta.priority && tokenChip("priority", meta.priority),
    meta.due && tokenChip("due", meta.due, { done, now }),
    meta.start && meta.start.slice(0, 10) > now && tokenChip("start", meta.start, { now }),
    meta.rec && tokenChip("rec", meta.rec),
    ...meta.assignees.map((a) => tokenChip("assignees", a)),
    ...[...tags].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })).map((t) => tokenChip("tags", t)),
    done && meta.done && tokenChip("done", meta.done, { now }),
  ].filter((c): c is HTMLElement => !!c);
}

/** Tags a task's chips show: the ones not already in its words (those stay there, in the sentence). */
export function endTags(summary: string, tags: string[]): string[] {
  const inText = new Set(tagsInLine(summary).map((h) => h.tag));
  return tags.filter((tag) => !inText.has(tag.toLowerCase()));
}

// A placeholder for a task's chips that survives markdown rendering: private-use characters.
const MARK = /\uE000(\d+)\uE001/g;

/**
 * Markdown with each task line's trailing tokens swapped for a placeholder, and those tasks in
 * order, so rendered markdown shows a task's words and then its chips (see hydrateTaskChips), as
 * task lists do. Lines in fenced code stay as written.
 */
export function withTaskChips(md: string): { md: string; tasks: ParsedTask[] } {
  const tasks: ParsedTask[] = [];
  let fence: string | null = null;
  const lines = md.split("\n").map((line) => {
    const f = line.match(/^\s{0,3}(`{3,}|~{3,})/)?.[1];
    if (f && (!fence || (f[0] === fence[0] && f.length >= fence.length))) fence = fence ? null : f;
    const t = !fence && !f ? parseTask(line) : null;
    if (!t) return line;
    tasks.push(t);
    const [, open, box, close] = line.match(TASK_LINE)!;
    return `${open}${box}${close}${t.summary} \uE000${tasks.length - 1}\uE001`;
  });
  return { md: lines.join("\n"), tasks };
}

/** Put each task's chips where withTaskChips left its placeholder. The chips carry the task's index (data-task). */
export function hydrateTaskChips(node: HTMLElement, tasks: ParsedTask[]) {
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  const hits: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) if (/\uE000/.test(n.nodeValue ?? "")) hits.push(n as Text);
  for (const text of hits) {
    const parts = (text.nodeValue ?? "").split(MARK);
    text.replaceWith(
      ...parts.map((part, i) => {
        if (i % 2 === 0) return part;
        const t = tasks[+part];
        return t ? el("span", { class: "tk-run", "data-task": part }, ...metaChips(t.meta, t.done, endTags(t.summary, t.meta.tags))) : "";
      }),
    );
  }
}
