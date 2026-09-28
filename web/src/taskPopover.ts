// A task's details in a popover: due date and time, start, priority, people, tags and repeat.
// Saving sends only what changed; the core rewrites just those tokens in the task's line.
import type { Task, TaskPatch } from "./api.ts";
import { el, icon } from "./dom.ts";

const list = (s: string) => [...new Set(s.split(/[,\s]+/).map((x) => x.trim().replace(/^[@#]/, "")).filter(Boolean))];

export function taskPopover(anchor: HTMLElement, task: Task, save: (patch: TaskPatch) => Promise<void>) {
  document.querySelector(".task-pop")?.remove();
  const m = task.meta;
  const dueDay = el("input", { type: "date", value: m.due?.slice(0, 10) ?? "" });
  const dueTime = el("input", { type: "time", value: m.due?.slice(11) ?? "" });
  const start = el("input", { type: "date", value: m.start?.slice(0, 10) ?? "" });
  const people = el("input", { type: "text", value: m.assignees.join(", "), placeholder: "jane, sam", spellcheck: "false" });
  const tags = el("input", { type: "text", value: m.tags.join(", "), placeholder: "work/acme, billing", spellcheck: "false" });
  const rec = el("input", { type: "text", value: m.rec ?? "", placeholder: "daily, weekly, monthly…", spellcheck: "false", list: "task-rec" });
  const error = el("div", { class: "task-pop-error", hidden: true });
  let priority = m.priority;
  const seg = el("div", { class: "seg" });
  const drawSeg = () =>
    seg.replaceChildren(
      ...([[null, "None"], ["high", "High"], ["low", "Low"]] as const).map(([p, label]) =>
        el("button", { type: "button", class: p === priority ? "is-on" : "", onclick: () => ((priority = p), drawSeg()) }, label),
      ),
    );
  drawSeg();

  const row = (label: string, ...control: HTMLElement[]) =>
    el("div", { class: "qw-field" }, el("span", { class: "qw-field-label" }, label), el("span", { class: "qw-field-control task-pop-control" }, ...control));
  const form = el(
    "form",
    { class: "qw-config task-pop", role: "dialog", "aria-label": "Task details" },
    el("div", { class: "task-pop-title" }, icon("task", 14), task.summary || task.text),
    row("Due", dueDay, dueTime),
    row("Starts", start),
    row("Priority", seg),
    row("People", people),
    row("Tags", tags),
    row("Repeats", rec, el("datalist", { id: "task-rec" }, ...["daily", "weekdays", "weekly", "monthly", "yearly"].map((v) => el("option", { value: v })))),
    error,
    el(
      "div",
      { class: "qw-config-foot" },
      el("span", { class: "spacer" }),
      el("button", { class: "qw-btn", type: "button", onclick: () => close() }, "Cancel"),
      el("button", { class: "qw-btn primary", type: "submit" }, "Save"),
    ),
  );
  const r = anchor.getBoundingClientRect();
  Object.assign(form.style, { top: `${Math.min(r.bottom + 6, innerHeight - 420)}px`, left: `${Math.max(12, Math.min(r.right - 340, innerWidth - 352))}px` });

  const close = () => {
    form.remove();
    document.removeEventListener("mousedown", outside, true);
  };
  const outside = (e: MouseEvent) => {
    if (!form.contains(e.target as Node) && !anchor.contains(e.target as Node)) close();
  };
  form.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") close();
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const patch: TaskPatch = {};
    const due = dueDay.value ? `${dueDay.value}${dueTime.value ? `T${dueTime.value}` : ""}` : null;
    if (due !== m.due) patch.due = due;
    if ((start.value || null) !== (m.start?.slice(0, 10) ?? null)) patch.start = start.value || null;
    if (priority !== m.priority) patch.priority = priority;
    if (list(people.value).join() !== m.assignees.join()) patch.assignees = list(people.value);
    if (list(tags.value).join() !== m.tags.join()) patch.tags = list(tags.value);
    if ((rec.value.trim() || null) !== m.rec) patch.rec = rec.value.trim() || null;
    if (!Object.keys(patch).length) return close();
    try {
      await save(patch);
      close();
    } catch (err) {
      error.hidden = false;
      error.textContent = err instanceof Error ? err.message : "Couldn't save the task";
    }
  });
  document.addEventListener("mousedown", outside, true);
  document.body.append(form);
  dueDay.focus();
}
