// Click a task's chip to change just that token: priority from a menu, a date with quick picks, a
// repeat from quick picks or the full rule form, a person from the people already on tasks. Each sends one patch, and
// the core's one writer (editTask) changes that token in place and leaves the rest of the line.
import { api, type Task, type TaskPatch } from "./api.ts";
import { avatar, el, icon } from "./dom.ts";
import { addDays, skipPatch } from "../../src/core/tasks.ts";
import { DAY_NAMES, formatRule, isInterval, MONTH_NAMES, nth, occurrences, parseRule, ruleLabel, ruleProblem, type Freq, type Rule } from "../../src/core/recurrence.ts";
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
  /** Keep it on screen after it grows (the repeat editor's "More options…"). */
  const place = () => {
    const b = box.getBoundingClientRect();
    Object.assign(box.style, { top: `${Math.max(12, Math.min(b.top, innerHeight - b.height - 12))}px`, left: `${Math.max(12, Math.min(b.left, innerWidth - b.width - 12))}px` });
  };
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
  return { box, close, place };
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

/** One-click repeats. */
const QUICK: Array<[string, string]> = [
  ["Daily", "daily"],
  ["Every weekday", "mon,tue,wed,thu,fri"],
  ["Weekly", "weekly"],
  ["Every 2 weeks", "2w"],
  ["Monthly", "monthly"],
  ["Yearly", "yearly"],
];

/** Repeat: quick picks, "Skip this one", "Stop repeating", and "More options…" for any rule there's a token for. */
const repeat: Editor = (anchor, value, ctx) => {
  const now = parseRule(value);
  const list = el("div", { class: "fp-list chip-rec-list" });
  const head = el("div", { class: "fp-head chip-rec-head" }, icon("reset", 15), el("span", {}, now ? ruleLabel(now, true) : value));
  const { box, close, place } = popover(anchor, ctx, "Repeat", head, list);
  const current = now && formatRule(now);
  const skip = ctx.task.done ? null : skipPatch(ctx.task.meta, today());
  const more = () => {
    box.classList.add("is-wide");
    head.remove();
    list.replaceWith(ruleForm(now ?? parseRule("weekly")!, value, ctx, close));
    place();
    box.querySelector<HTMLElement>("input, select")?.focus();
  };
  list.append(
    ...QUICK.map(([label, rec]) => item(label, "reset", saving(close, ctx, { rec }), current === rec)),
    ...(skip ? [item(`Skip this one · due ${dayLabel(skip.due!)}`, "chevron", saving(close, ctx, skip))] : []),
    item("Stop repeating", "close", saving(close, ctx, { rec: null })),
    // A rule the form can't show (a hand-written RRULE) keeps its summary above and opens as text.
    item(now && !formFits(now) ? "Edit as text…" : "More options…", "sliders", more),
  );
  place();
  // Focus the popover itself, so Escape closes it and Tab reaches the first pick, without marking one as chosen.
  box.tabIndex = -1;
  box.focus();
};

const UNITS: Freq[] = ["day", "week", "month", "year"];
const ORDINALS = [1, 2, 3, 4, 5, -1];
const blankRule = (freq: Freq, interval: number, from: Rule["from"]): Rule => ({ freq, interval, from, byDay: [], byMonthDay: [], byMonth: [], byYearDay: [] });

/** Whether the form can show a rule; anything else (a hand-written RRULE) is edited as text. */
function formFits(r: Rule): boolean {
  const none = (...keys: Array<"byDay" | "byMonthDay" | "byMonth" | "byYearDay">) => keys.every((k) => !r[k].length);
  const ordinal = (d: Rule["byDay"][number]) => ORDINALS.includes(d.n);
  switch (r.freq) {
    case "day":
      return isInterval(r);
    case "week":
      return none("byMonthDay", "byMonth", "byYearDay") && r.byDay.every((d) => d.n === 0);
    case "month":
      return none("byMonth", "byYearDay") && (none("byDay") || none("byMonthDay")) && r.byDay.every(ordinal) && r.byMonthDay.every((d) => (d >= 1 && d <= 31) || d === -1);
    case "year":
      if (isInterval(r)) return true;
      if (r.byMonth.length === 1 && r.byMonthDay.length === 1 && none("byDay", "byYearDay")) return r.byMonthDay[0] >= 1;
      if (r.byMonth.length === 1 && r.byDay.length === 1 && none("byMonthDay", "byYearDay")) return ordinal(r.byDay[0]);
      return r.byYearDay.length === 1 && r.byYearDay[0] >= 1 && none("byDay", "byMonth", "byMonthDay");
  }
}

const select = (options: Array<[string | number, string]>, value: string | number, onchange: (v: string) => void, label: string) => {
  const s = el("select", { class: "qw-select", "aria-label": label }, ...options.map(([v, text]) => el("option", { value: String(v) }, text)));
  s.value = String(value);
  s.addEventListener("change", () => onchange(s.value));
  return s;
};
const ordinalSelect = (n: number, on: (n: number) => void) => select(ORDINALS.map((o) => [o, nth(o)]), n, (v) => on(+v), "Which");
const daySelect = (d: number, on: (d: number) => void) => select(DAY_NAMES.map((name, i) => [i, name]), d, (v) => on(+v), "Weekday");
const monthSelect = (m: number, on: (m: number) => void) => select(MONTH_NAMES.map((name, i) => [i + 1, name]), m, (v) => on(+v), "Month");

/**
 * "More options…": the whole rule as a form (how often, which days, repeat from due or completion)
 * with a live summary and the next dates, or as its `rec:` text for what the form can't show.
 */
function ruleForm(start: Rule, value: string, ctx: ChipContext, close: () => void): HTMLFormElement {
  let r: Rule = structuredClone(start);
  let asText = !formFits(r);
  const due = ctx.task.meta.due;
  // Defaults for a new calendar part come from the due date: its weekday, day and month.
  const at = new Date(`${(due ?? today()).slice(0, 10)}T12:00:00Z`);
  const dueDay = (at.getUTCDay() + 6) % 7;
  const dueDate = at.getUTCDate();
  const dueMonth = at.getUTCMonth() + 1;

  const body = el("div", { class: "chip-rec-body" });
  const summary = el("div", { class: "chip-rec-summary", "aria-live": "polite" });
  const dates = el("div", { class: "chip-rec-dates" });
  const text = el("input", { class: "chip-rec-text", "aria-label": "Repeat as text", spellcheck: "false", autocomplete: "off", value: value || formatRule(r) });
  const swap = el("button", { type: "button", class: "qw-btn" });
  const save = el("button", { type: "submit", class: "qw-btn primary" }, "Save");
  const form = el("form", { class: "chip-rec" }, body, el("div", { class: "chip-rec-about" }, summary, dates), el("div", { class: "qw-config-foot" }, swap, el("span", { class: "spacer" }), save));

  /** The rule the form or the text says now, or why the text isn't one. */
  const rule = (): Rule | string => (asText ? (parseRule(text.value) ?? ruleProblem(text.value.trim()) ?? "Not a repeat") : r);
  const refresh = () => {
    const now = rule();
    save.disabled = typeof now === "string";
    summary.classList.toggle("is-error", typeof now === "string");
    if (typeof now === "string") {
      summary.textContent = now;
      dates.textContent = "";
      return;
    }
    summary.textContent = ruleLabel(now, true);
    const from = now.from === "done" || !due ? today() : due;
    const next = occurrences(now, from, 3).map((d) => dayLabel(d));
    const lead = now.from === "done" ? "If done today:" : due ? "After this one:" : "Next:";
    dates.textContent = next.length ? `${lead} ${next.join(", ")}` : "No more dates";
  };
  /** Redraw for a new rule, keeping focus on the same control (a select or toggle is redrawn under it). */
  const change = (next: Rule) => {
    const controls = () => [...body.querySelectorAll<HTMLElement>("input, select, button")];
    const at = controls().indexOf(document.activeElement as HTMLElement);
    r = next;
    draw();
    if (at >= 0) controls()[Math.min(at, controls().length - 1)]?.focus();
  };
  /** A calendar part repeats from the due date: completion only goes with a plain gap. */
  const calendar = (next: Partial<Rule>) => change({ ...r, from: "due", ...next });

  const rows = (): HTMLElement[] => {
    const n = el("input", { type: "number", class: "chip-n", min: "1", max: "999", value: String(r.interval), "aria-label": "Every how many" });
    n.addEventListener("input", () => {
      const v = Math.round(Number(n.value));
      if (v >= 1 && v <= 999) (r = { ...r, interval: v }), refresh();
    });
    const plural = r.interval === 1 ? "" : "s";
    const out: HTMLElement[] = [
      el("div", { class: "chip-rec-row" }, el("span", {}, "Every"), n, select(UNITS.map((u) => [u, `${u}${plural}`]), r.freq, (f) => change(blankRule(f as Freq, r.interval, r.from)), "Unit")),
    ];
    if (r.freq === "week") {
      const on = new Set(r.byDay.map((d) => d.day));
      out.push(
        el(
          "div",
          { class: "chip-rec-days", role: "group", "aria-label": "On" },
          ...DAY_NAMES.map((name, i) =>
            el("button", { type: "button", "aria-pressed": String(on.has(i)), title: name, "aria-label": name, onclick: () => {
              on.has(i) ? on.delete(i) : on.add(i);
              calendar({ byDay: [...on].sort().map((day) => ({ n: 0, day })) });
            } }, name.slice(0, 2)),
          ),
        ),
      );
    }
    if (r.freq === "month") {
      const mode = r.byMonthDay.length ? "days" : r.byDay.length ? "weekdays" : "same";
      out.push(
        el("div", { class: "chip-rec-row" }, el("span", {}, "On"), select([["same", `the ${nth(dueDate)} (from the due date)`], ["days", "day…"], ["weekdays", "the…"]], mode, (m) =>
          calendar({ byMonthDay: m === "days" ? [dueDate] : [], byDay: m === "weekdays" ? [{ n: Math.min(Math.ceil(dueDate / 7), 4), day: dueDay }] : [] }), "Repeat on")),
      );
      const list = <T,>(items: T[], put: (items: T[]) => void, draw: (item: T, set: (v: T) => void) => HTMLElement[], fresh: T, what: string) => {
        items.forEach((it, i) =>
          out.push(
            el("div", { class: "chip-rec-row chip-rec-sub" }, ...draw(it, (v) => put(items.map((o, j) => (j === i ? v : o)))),
              items.length > 1 ? el("button", { type: "button", class: "icon-btn small", title: `Remove this ${what}`, "aria-label": `Remove this ${what}`, onclick: () => put(items.filter((_, j) => j !== i)) }, icon("close", 13)) : null),
          ),
        );
        out.push(el("button", { type: "button", class: "chip-rec-add", onclick: () => put([...items, fresh]) }, icon("plus", 13), `Another ${what}`));
      };
      if (mode === "days")
        list(r.byMonthDay, (byMonthDay) => calendar({ byMonthDay }), (d, set) => [
          el("span", {}, "Day"),
          select([...Array.from({ length: 31 }, (_, i): [number, string] => [i + 1, nth(i + 1)]), [-1, "last day"]], d, (v) => set(+v), "Day of the month"),
        ], r.byMonthDay.includes(-1) ? 1 : -1, "day");
      if (mode === "weekdays")
        list(r.byDay, (byDay) => calendar({ byDay }), (d, set) => [
          el("span", {}, "The"),
          ordinalSelect(d.n, (n) => set({ ...d, n })),
          daySelect(d.day, (day) => set({ ...d, day })),
        ], { n: -1, day: dueDay }, "weekday");
    }
    if (r.freq === "year") {
      const mode = r.byYearDay.length ? "yearday" : r.byMonthDay.length ? "date" : r.byDay.length ? "weekday" : "same";
      out.push(
        el("div", { class: "chip-rec-row" }, el("span", {}, "On"), select([["same", `${MONTH_NAMES[dueMonth - 1]} ${dueDate} (from the due date)`], ["date", "a date…"], ["weekday", "the…"], ["yearday", "a day of the year…"]], mode, (m) =>
          calendar({
            byMonth: m === "date" || m === "weekday" ? [dueMonth] : [],
            byMonthDay: m === "date" ? [dueDate] : [],
            byDay: m === "weekday" ? [{ n: 1, day: dueDay }] : [],
            byYearDay: m === "yearday" ? [1] : [],
          }), "Repeat on")),
      );
      if (mode === "date") {
        const day = el("input", { type: "number", class: "chip-n", min: "1", max: "31", value: String(r.byMonthDay[0]), "aria-label": "Day" });
        day.addEventListener("input", () => {
          const v = Math.round(Number(day.value));
          if (v >= 1 && v <= 31) (r = { ...r, byMonthDay: [v] }), refresh();
        });
        out.push(el("div", { class: "chip-rec-row chip-rec-sub" }, monthSelect(r.byMonth[0], (m) => calendar({ byMonth: [m] })), day));
      }
      if (mode === "weekday")
        out.push(el("div", { class: "chip-rec-row chip-rec-sub" }, el("span", {}, "The"), ordinalSelect(r.byDay[0].n, (n) => calendar({ byDay: [{ ...r.byDay[0], n }] })), daySelect(r.byDay[0].day, (d) => calendar({ byDay: [{ ...r.byDay[0], day: d }] })), el("span", {}, "of"), monthSelect(r.byMonth[0], (m) => calendar({ byMonth: [m] }))));
      if (mode === "yearday") {
        const day = el("input", { type: "number", class: "chip-n", min: "1", max: "366", value: String(r.byYearDay[0]), "aria-label": "Day of the year" });
        day.addEventListener("input", () => {
          const v = Math.round(Number(day.value));
          if (v >= 1 && v <= 366) (r = { ...r, byYearDay: [v] }), refresh();
        });
        out.push(el("div", { class: "chip-rec-row chip-rec-sub" }, el("span", {}, "Day"), day, el("span", {}, "of the year")));
      }
    }
    const gap = isInterval(r);
    const from = (f: Rule["from"], label: string) =>
      el("button", { type: "button", "aria-pressed": String(r.from === f), disabled: !gap, onclick: () => change({ ...r, from: f }) }, label);
    out.push(
      el("div", { class: "chip-rec-row" }, el("span", {}, "Repeat from"), el("div", { class: "chip-rec-seg", role: "group", "aria-label": "Repeat from" }, from("due", "Due date"), from("done", "Completion"))),
      ...(gap ? [] : [el("div", { class: "chip-rec-hint" }, "A calendar rule repeats from the due date.")]),
    );
    return out;
  };

  const draw = () => {
    body.replaceChildren(...(asText ? [text] : rows()));
    const fits = asText ? (() => { const p = parseRule(text.value); return !!p && formFits(p); })() : true;
    swap.textContent = asText ? "Use the form" : "Edit as text";
    swap.disabled = !fits;
    swap.title = fits ? "" : "The form can't show this rule";
    refresh();
  };
  text.addEventListener("input", () => {
    const p = parseRule(text.value);
    swap.disabled = !(p && formFits(p));
    refresh();
  });
  swap.addEventListener("click", () => {
    if (asText) r = parseRule(text.value)!;
    else text.value = formatRule(r);
    asText = !asText;
    draw();
    (asText ? text : body.querySelector<HTMLElement>("input, select"))?.focus();
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const now = rule();
    if (typeof now === "string") return;
    // As text, keep what was typed (a spelling of the same rule stays as written); from the form, the shortest token.
    const rec = asText ? text.value.trim() : formatRule(now);
    if (rec === value) close();
    else void saving(close, ctx, { rec })();
  });
  draw();
  return form;
}

/** A person: swap in someone already on tasks (or a new name), take them off, or show their tasks. */
const person: Editor = (anchor, value, ctx) => {
  const input = el("input", { class: "fp-input", placeholder: "Someone else…", spellcheck: "false", autocomplete: "off" });
  const list = el("div", { class: "fp-list" });
  const { close } = popover(anchor, ctx, "Person", el("div", { class: "fp-head" }, icon("at", 15), input), list);
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
    if (e.key !== "Enter") return;
    e.preventDefault(); // the Enter is the pick's, not whatever takes focus next
    (list.querySelectorAll<HTMLButtonElement>(".fp-item")[1] ?? list.querySelector<HTMLButtonElement>(".fp-item"))?.click();
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
