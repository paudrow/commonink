// Click a task's chip to change just that token: priority from a menu, a date with quick picks, a
// repeat as "every N weeks", a person from the people already on tasks. Each sends one patch, and
// the core's one writer (editTask) changes that token in place and leaves the rest of the line.
import type { Task, TaskPatch } from "./api.ts";
import { avatar, el, icon } from "./dom.ts";
import { addDays, parseRec, formatRec, type RecUnit } from "../../src/core/tasks.ts";
import { dayLabel, today, type ChipField } from "./taskChips.ts";

export interface ChipContext {
  task: Task;
  save(patch: TaskPatch): Promise<void>;
  /** People on tasks anywhere in the workspace, most tasks first. */
  people(): Promise<string[]>;
  /** Show every task of this person's. */
  showPerson(name: string): void;
}

type Editor = (anchor: HTMLElement, value: string, ctx: ChipContext) => void;

/** A small popover under `anchor` that closes on Escape or a click outside. */
function popover(anchor: HTMLElement, label: string, ...children: HTMLElement[]) {
  document.querySelector(".chip-pop")?.remove();
  const box = el("div", { class: "folder-picker chip-pop", role: "dialog", "aria-label": label }, ...children);
  const r = anchor.getBoundingClientRect();
  Object.assign(box.style, { top: `${Math.min(r.bottom + 6, innerHeight - 320)}px`, left: `${Math.max(12, Math.min(r.left, innerWidth - 272))}px` });
  const close = () => {
    box.remove();
    document.removeEventListener("mousedown", outside, true);
  };
  const outside = (e: MouseEvent) => {
    if (!box.contains(e.target as Node) && !anchor.contains(e.target as Node)) close();
  };
  box.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") close();
  });
  document.addEventListener("mousedown", outside, true);
  document.body.append(box);
  return { box, close };
}

const item = (label: string | Node, iconName: string | Node | null, on: () => void, current = false) =>
  el(
    "button",
    { type: "button", class: `fp-item${current ? " is-current" : ""}`, onclick: on },
    typeof iconName === "string" ? icon(iconName, 14) : iconName,
    el("span", {}, label),
    current ? el("span", { class: "fp-here" }, "now") : null,
  );

/** Run a save from a popover, keeping it open with the error if the note changed underneath. */
const saving = (close: () => void, ctx: ChipContext, patch: TaskPatch) => async () => {
  try {
    await ctx.save(patch);
    close();
  } catch (e) {
    close();
    alert(e instanceof Error ? e.message : "Couldn't change the task");
  }
};

const priority: Editor = (anchor, value, ctx) => {
  const list = el("div", { class: "fp-list" });
  const { close } = popover(anchor, "Priority", list);
  list.append(
    ...([["high", "High"], [null, "Normal"], ["low", "Low"]] as const).map(([p, label]) =>
      item(label, "flag", saving(close, ctx, { priority: p }), (value || null) === p),
    ),
  );
};

/** Due or start: a date (keeping any time of day), quick picks, and Clear. */
const date =
  (field: "due" | "start"): Editor =>
  (anchor, value, ctx) => {
    const time = value.length > 10 ? value.slice(10) : "";
    const input = el("input", { type: "date", class: "chip-date", value: value.slice(0, 10) });
    const list = el("div", { class: "fp-list" });
    const { close } = popover(anchor, field === "due" ? "Due date" : "Start date", el("div", { class: "fp-head" }, icon("calendar", 15), input), list);
    const pick = (day: string | null) => saving(close, ctx, { [field]: day && day + time });
    input.addEventListener("change", () => input.value && void pick(input.value)());
    const now = today();
    list.append(
      ...([["Today", 0], ["Tomorrow", 1], ["Next week", 7]] as const).map(([label, n]) => item(n === 7 ? `${label} · ${dayLabel(addDays(now, n))}` : label, "calendar", pick(addDays(now, n)))),
      item("Clear", "close", pick(null)),
    );
    input.focus();
  };

const UNITS: RecUnit[] = ["day", "week", "month", "year"];

/** Repeat: every N days, weeks, months or years, or Clear. What repeating does is #8's. */
const repeat: Editor = (anchor, value, ctx) => {
  const now = parseRec(value) ?? { n: 1, unit: "week" as RecUnit };
  const n = el("input", { type: "number", class: "chip-n", min: "1", max: "999", value: String(now.n) });
  const unit = el("select", { class: "qw-select chip-unit" }, ...UNITS.map((u) => el("option", { value: u }, `${u}s`)));
  unit.value = now.unit;
  const save = el("button", { type: "submit", class: "qw-btn primary" }, "Save");
  const form = el(
    "form",
    { class: "chip-rec" },
    el("div", { class: "chip-rec-row" }, el("span", {}, "Every"), n, unit),
    el("div", { class: "qw-config-foot" }, el("button", { type: "button", class: "qw-btn", onclick: () => void saving(close, ctx, { rec: null })() }, "Clear"), el("span", { class: "spacer" }), save),
  );
  const { close } = popover(anchor, "Repeat", form);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const count = Math.round(Number(n.value));
    if (count >= 1 && count <= 999) void saving(close, ctx, { rec: formatRec(count, unit.value as RecUnit) })();
  });
  n.focus();
  n.select();
};

/** A person: swap in someone already on tasks (or a new name), take them off, or show their tasks. */
const person: Editor = (anchor, value, ctx) => {
  const input = el("input", { class: "fp-input", placeholder: "Someone else…", spellcheck: "false", autocomplete: "off" });
  const list = el("div", { class: "fp-list" });
  const { close } = popover(anchor, "Person", el("div", { class: "fp-head" }, icon("at", 15), input), list);
  const others = ctx.task.meta.assignees.filter((a) => a !== value);
  const swap = (to: string) => saving(close, ctx, { assignees: ctx.task.meta.assignees.map((a) => (a === value ? to : a)) });
  let people: string[] = [];
  const render = () => {
    const q = input.value.trim().replace(/^@/, "");
    const matches = people.filter((p) => p.toLowerCase() !== value.toLowerCase() && !others.includes(p) && p.toLowerCase().includes(q.toLowerCase()));
    const isNew = q && /^[\p{L}\p{N}_-]+(?:\.[\p{L}\p{N}_-]+)*$/u.test(q) && !people.some((p) => p.toLowerCase() === q.toLowerCase());
    list.replaceChildren(
      item(`Show ${value}'s tasks`, "task", () => (close(), ctx.showPerson(value))),
      ...matches.slice(0, 8).map((p) => item(`@${p}`, avatar(p, 16), swap(p))),
      ...(isNew ? [item(`@${q}`, "plus", swap(q))] : []),
      item(`Take @${value} off this task`, "close", saving(close, ctx, { assignees: others })),
    );
  };
  input.addEventListener("input", render);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") (list.querySelectorAll<HTMLButtonElement>(".fp-item")[1] ?? list.querySelector<HTMLButtonElement>(".fp-item"))?.click();
  });
  render();
  void ctx.people().then((p) => ((people = p), render()));
  input.focus();
};

/** Which chips open an editor. Tags filter instead, and a done date has nothing to edit. */
const EDITORS: Partial<Record<ChipField, Editor>> = { priority, due: date("due"), start: date("start"), rec: repeat, assignees: person };

/** Open the editor for the chip that was clicked; false if that chip has none. */
export function openChipEditor(chip: HTMLElement, ctx: ChipContext): boolean {
  const editor = EDITORS[chip.dataset.field as ChipField];
  if (!editor) return false;
  editor(chip, chip.dataset.value ?? "", ctx);
  return true;
}
