// Click a task's chip to change just that token: priority from a menu, a date with quick picks, a
// repeat as "every N weeks", a person from the people already on tasks. Each sends one patch, and
// the core's one writer (editTask) changes that token in place and leaves the rest of the line.
import { api, type Task, type TaskPatch } from "./api.ts";
import { cleanTag, normalizeTag } from "../../src/core/tags.ts";
import { avatar, el, icon } from "./dom.ts";
import { addDays, parseRec, formatRec, recLabel, type RecUnit } from "../../src/core/tasks.ts";
import { dayLabel, today, type ChipField } from "./taskChips.ts";

export interface ChipContext {
  task: Task;
  save(patch: TaskPatch): Promise<void>;
  /** People on tasks anywhere in the workspace, most tasks first. */
  people(): Promise<string[]>;
  /** Show every task of this person's. */
  showPerson(name: string): void;
  /** The editor closed (saved, Escape, or a click away): the note editor takes its focus back. */
  onClose?(): void;
}

/** Everyone @-mentioned on a task anywhere, most tasks first. */
export async function taskPeople(): Promise<string[]> {
  const count = new Map<string, number>();
  for (const t of await api.tasks({}).catch(() => [])) for (const a of t.meta.assignees) count.set(a, (count.get(a) ?? 0) + 1);
  return [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([p]) => p);
}

type Editor = (anchor: HTMLElement, value: string, ctx: ChipContext) => void;

/** A small popover under `anchor` that closes on Escape or a click outside. */
function popover(anchor: HTMLElement, ctx: ChipContext, label: string, ...children: HTMLElement[]) {
  document.querySelector(".chip-pop")?.remove();
  const box = el("div", { class: "folder-picker chip-pop", role: "dialog", "aria-label": label }, ...children);
  const r = anchor.getBoundingClientRect();
  Object.assign(box.style, { top: `${Math.min(r.bottom + 6, innerHeight - 320)}px`, left: `${Math.max(12, Math.min(r.left, innerWidth - 272))}px` });
  const close = () => {
    if (!box.isConnected) return;
    box.remove();
    document.removeEventListener("mousedown", outside, true);
    ctx.onClose?.();
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
  const { close } = popover(anchor, ctx, "Priority", list);
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
    const { close } = popover(anchor, ctx, field === "due" ? "Due date" : "Start date", el("div", { class: "fp-head" }, icon("calendar", 15), input), list);
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
    el("div", { class: "qw-config-foot" }, value ? el("button", { type: "button", class: "qw-btn", onclick: () => void saving(close, ctx, { rec: null })() }, "Clear") : null, el("span", { class: "spacer" }), save),
  );
  const { close } = popover(anchor, ctx, "Repeat", form);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const count = Math.round(Number(n.value));
    if (count >= 1 && count <= 999) void saving(close, ctx, { rec: formatRec(count, unit.value as RecUnit) })();
  });
  n.focus();
  n.select();
};

/**
 * A person: swap in someone already on tasks (or a new name), take them off, or show their tasks.
 * With no person (from the task's ⚙ menu), it adds one, and lists who's on it to take off.
 */
const person: Editor = (anchor, value, ctx) => {
  const adding = !value;
  const input = el("input", { class: "fp-input", placeholder: adding ? "Add someone…" : "Someone else…", spellcheck: "false", autocomplete: "off" });
  const list = el("div", { class: "fp-list" });
  const { close } = popover(anchor, ctx, "Person", el("div", { class: "fp-head" }, icon("at", 15), input), list);
  const on = ctx.task.meta.assignees;
  const others = on.filter((a) => a !== value);
  const pick = (to: string) => saving(close, ctx, { assignees: adding ? [...on, to] : on.map((a) => (a === value ? to : a)) });
  const taken = (p: string) => p.toLowerCase() === value.toLowerCase() || on.some((a) => a.toLowerCase() === p.toLowerCase());
  let people: string[] = [];
  const render = () => {
    const q = input.value.trim().replace(/^@/, "");
    const matches = people.filter((p) => !taken(p) && p.toLowerCase().includes(q.toLowerCase()));
    const isNew = q && /^[\p{L}\p{N}_-]+(?:\.[\p{L}\p{N}_-]+)*$/u.test(q) && !people.some((p) => p.toLowerCase() === q.toLowerCase()) && !taken(q);
    list.replaceChildren(
      ...(adding ? [] : [item(`Show ${value}'s tasks`, "task", () => (close(), ctx.showPerson(value)))]),
      ...matches.slice(0, 8).map((p) => item(`@${p}`, avatar(p, 16), pick(p))),
      ...(isNew ? [item(`@${q}`, "plus", pick(q))] : []),
      ...(adding
        ? on.map((a) => item(`Take @${a} off this task`, "close", saving(close, ctx, { assignees: on.filter((o) => o !== a) })))
        : [item(`Take @${value} off this task`, "close", saving(close, ctx, { assignees: others }))]),
    );
  };
  input.addEventListener("input", render);
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault(); // the Enter is the pick's, not whatever takes focus next
    const items = list.querySelectorAll<HTMLButtonElement>(".fp-item");
    (adding ? items[0] : (items[1] ?? items[0]))?.click();
  });
  render();
  void ctx.people().then((p) => ((people = p), render()));
  input.focus();
};

/** Tags: add one (tags in use first, or a new name), or take one off. Opened from the task's ⚙ menu; tag chips filter. */
const tags: Editor = (anchor, _value, ctx) => {
  const input = el("input", { class: "fp-input", placeholder: "Add a tag…", spellcheck: "false", autocomplete: "off" });
  const list = el("div", { class: "fp-list" });
  const { close } = popover(anchor, ctx, "Tags", el("div", { class: "fp-head" }, icon("hash", 15), input), list);
  const on = ctx.task.meta.tags;
  const has = (t: string) => on.some((o) => normalizeTag(o) === normalizeTag(t));
  const add = (t: string) => saving(close, ctx, { tags: [...on, t] });
  let known: string[] = [];
  const render = () => {
    const q = input.value.trim().replace(/^#/, "");
    const matches = known.filter((t) => !has(t) && t.toLowerCase().includes(q.toLowerCase()));
    const fresh = q && normalizeTag(q) && !has(q) && !known.some((t) => normalizeTag(t) === normalizeTag(q)) ? cleanTag(q) : null;
    list.replaceChildren(
      ...matches.slice(0, 8).map((t) => item(`#${t}`, "hash", add(t))),
      ...(fresh ? [item(`#${fresh}`, "plus", add(fresh))] : []),
      ...on.map((t) => item(`Take #${t} off this task`, "close", saving(close, ctx, { tags: on.filter((o) => o !== t) }))),
    );
    if (!list.childElementCount) list.append(el("div", { class: "fp-empty" }, "Type a tag's name"));
  };
  input.addEventListener("input", render);
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (input.value.trim()) list.querySelector<HTMLButtonElement>(".fp-item")?.click();
  });
  render();
  void api
    .tags()
    .then((all) => ((known = all.filter((t) => t.tasks + t.notes > 0).sort((a, b) => b.tasks - a.tasks || b.notes - a.notes).map((t) => t.display)), render()))
    .catch(() => {});
  input.focus();
};

/** Which chips open an editor. Tag chips filter instead (the ⚙ menu edits tags), and a done date has nothing to edit. */
const EDITORS: Partial<Record<ChipField, Editor>> = { priority, due: date("due"), start: date("start"), rec: repeat, assignees: person };

/** Open the editor for the chip that was clicked; false if that chip has none. */
export function openChipEditor(chip: HTMLElement, ctx: ChipContext): boolean {
  const editor = EDITORS[chip.dataset.field as ChipField];
  if (!editor) return false;
  editor(chip, chip.dataset.value ?? "", ctx);
  return true;
}

export type MenuField = "priority" | "due" | "start" | "rec" | "assignees" | "tags";

/** Open one field's editor under `anchor`, for a value it has or a new one (""). */
export function openFieldEditor(field: MenuField, anchor: HTMLElement, value: string, ctx: ChipContext) {
  (field === "tags" ? tags : EDITORS[field]!)(anchor, value, ctx);
}

/** Every field a task can carry, in chip order, with what it's set to now ("" for nothing). */
const FIELDS: Array<{ field: MenuField; label: string; icon: string; now(m: Task["meta"]): string }> = [
  { field: "priority", label: "Priority", icon: "flag", now: (m) => (m.priority === "high" ? "High" : m.priority === "low" ? "Low" : "") },
  { field: "due", label: "Due", icon: "calendar", now: (m) => (m.due ? dayLabel(m.due) : "") },
  { field: "start", label: "Start", icon: "clock", now: (m) => (m.start ? dayLabel(m.start) : "") },
  { field: "rec", label: "Repeat", icon: "reset", now: (m) => (m.rec ? recLabel(m.rec) : "") },
  { field: "assignees", label: "Person", icon: "at", now: (m) => m.assignees.map((a) => `@${a}`).join(", ") },
  { field: "tags", label: "Tags", icon: "hash", now: (m) => m.tags.map((t) => `#${t}`).join(" ") },
];

/**
 * A task's ⚙ menu: every field, set or not, with its value. Choosing one opens that field's own
 * editor (the same one its chip opens), and a new value goes in at its place among the tokens.
 * One component for task lists and the note editor.
 */
export function openTaskMenu(anchor: HTMLElement, ctx: ChipContext) {
  let handedOff = false;
  const list = el("div", { class: "fp-list" });
  // Closing to open a field's editor isn't the end of the edit: the editor's own close is.
  const { close } = popover(anchor, { ...ctx, onClose: () => handedOff || ctx.onClose?.() }, "Task fields", list);
  const m = ctx.task.meta;
  list.append(
    ...FIELDS.map((f) => {
      const now = f.now(m);
      const value = f.field === "priority" ? (m.priority ?? "") : f.field === "due" ? (m.due ?? "") : f.field === "start" ? (m.start ?? "") : f.field === "rec" ? (m.rec ?? "") : "";
      return el(
        "button",
        {
          type: "button",
          class: "fp-item task-menu-item",
          onclick: () => {
            handedOff = true;
            close();
            openFieldEditor(f.field, anchor, value, ctx);
          },
        },
        icon(f.icon, 14),
        el("span", {}, f.label),
        now ? el("span", { class: "task-menu-value" }, now) : el("span", { class: "task-menu-value is-empty" }, "Add"),
      );
    }),
  );
  list.querySelector<HTMLElement>(".fp-item")?.focus();
}

/** The repeats offered first: in the repeat editor's quick picks and as `rec:` completions. */
export const REPEAT_PICKS: Array<[string, string]> = [
  ["Daily", "daily"],
  ["Weekly", "weekly"],
  ["Every 2 weeks", "2w"],
  ["Monthly", "monthly"],
  ["Yearly", "yearly"],
];
