// How a task's tokens look, in the editor and in task lists: a date pill, a repeat mark, a person,
// a priority flag. The markdown keeps the tokens; these only draw them.
import { avatar, el, icon } from "./dom.ts";
import { localDate, type TaskMeta } from "../../src/core/tasks.ts";

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

type Field = keyof Omit<TaskMeta, "tags" | "assignees"> | "assignees";

/** One token as a chip. `done` mutes a due date that would otherwise show as overdue. */
export function tokenChip(field: Field, value: string, opts: { done?: boolean; now?: string } = {}): HTMLElement {
  const now = opts.now ?? today();
  switch (field) {
    case "due": {
      const state = opts.done ? "" : value.slice(0, 10) < now ? " is-overdue" : value.slice(0, 10) === now ? " is-today" : "";
      return el("span", { class: `tk tk-due${state}`, title: `Due ${value}` }, icon("calendar", 12), dayLabel(value, now));
    }
    case "start":
      return el("span", { class: "tk", title: `Hidden until ${value}` }, icon("clock", 12), `from ${dayLabel(value, now)}`);
    case "done":
      return el("span", { class: "tk tk-muted", title: `Done ${value}` }, icon("check", 12), dayLabel(value, now));
    case "rec":
      return el("span", { class: "tk", title: `Repeats ${value}` }, icon("reset", 12), value);
    case "priority":
      return el("span", { class: `tk tk-priority is-${value}`, title: `${value === "high" ? "High" : "Low"} priority` }, icon("flag", 12), value === "high" ? "High" : "Low");
    case "assignees":
      return el("span", { class: "tk tk-person", title: `@${value}` }, avatar(value, 15), value);
  }
}

/** A task's metadata as chips, in a stable order. A start date shows only while it's still ahead. */
export function metaChips(meta: TaskMeta, done: boolean): HTMLElement[] {
  const now = today();
  return [
    meta.priority && tokenChip("priority", meta.priority),
    meta.due && tokenChip("due", meta.due, { done, now }),
    meta.start && meta.start.slice(0, 10) > now && tokenChip("start", meta.start, { now }),
    meta.rec && tokenChip("rec", meta.rec),
    ...meta.assignees.map((a) => tokenChip("assignees", a)),
    done && meta.done && tokenChip("done", meta.done, { now }),
  ].filter((c): c is HTMLElement => !!c);
}
