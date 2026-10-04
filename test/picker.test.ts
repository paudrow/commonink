// What the pickers share (web/src/picker.ts): the fuzzy match, the arrow keys, Enter and Escape,
// the lit row a screen reader hears, and the empty state. Then the pickers built on it, used the
// way someone uses them: the folder picker, a task's chip editors, and the event form's date picks.
import "./dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { el } from "../web/src/dom.ts";
import { arrowFocus, fuzzyRank, listPicker, stepActive } from "../web/src/picker.ts";
import { folderPicker } from "../web/src/folderPicker.ts";
import { datePicks } from "../web/src/taskChips.ts";
import { openFieldEditor, type ChipContext } from "../web/src/taskChipEditors.ts";
import { openEventForm } from "../web/src/calendar/editor.ts";
import type { Task, TaskPatch } from "../web/src/api.ts";
import { parseTask } from "../src/core/tasks.ts";

Object.assign(globalThis, { innerWidth: 1280, innerHeight: 800 }); // the pickers place themselves in the window

const key = (k: string, on: Element = document.activeElement!) => {
  const e = new window.KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true });
  on.dispatchEvent(e);
  return e;
};
const type = (input: HTMLInputElement, text: string) => {
  input.value = text;
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
};
const texts = (sel: string) => [...document.querySelectorAll(sel)].map((n) => n.textContent);
const tick = () => new Promise((r) => setTimeout(r, 0));

test("fuzzyRank: the best match first, on any of an item's texts, and everything with nothing typed", () => {
  const folders = ["Areas/Health and Fitness", "Projects", "Archive/Projects 2024", "Journal"];
  assert.deepEqual(fuzzyRank("", folders, (f) => f), folders, "nothing typed: all, in the order given");
  assert.deepEqual(fuzzyRank("  ", folders, (f) => f), folders);
  assert.deepEqual(fuzzyRank("proj", folders, (f) => f), ["Projects", "Archive/Projects 2024"], "a match at the start comes first");
  assert.deepEqual(fuzzyRank("hfit", folders, (f) => f), ["Areas/Health and Fitness"], "letters in order are enough");
  assert.deepEqual(fuzzyRank("zz", folders, (f) => f), []);
  const people = [
    { name: "Sam Lee", email: ["sam@acme.test"] },
    { name: "Priya Shah", email: ["p@acme.test", "priya@home.test"] },
  ];
  assert.deepEqual(fuzzyRank("home", people, (p) => [p.name, ...p.email]).map((p) => p.name), ["Priya Shah"], "an email counts as much as the name");
  assert.deepEqual(fuzzyRank("acme", people, (p) => [p.name, ...p.email]).map((p) => p.name), ["Priya Shah", "Sam Lee"], "the best of someone's texts is their score (acme is nearer the start of p@acme.test)");
  // Equal matches: `tie` orders them, else they stay as they came.
  const tags = [{ t: "work/a", n: 1 }, { t: "work/b", n: 5 }];
  assert.deepEqual(fuzzyRank("work", tags, (x) => x.t).map((x) => x.t), ["work/a", "work/b"]);
  assert.deepEqual(fuzzyRank("work", tags, (x) => x.t, (a, b) => b.n - a.n).map((x) => x.t), ["work/b", "work/a"]);
});

test("stepActive goes round the ends, and from no row to the first or last", () => {
  assert.equal(stepActive(0, 3, "ArrowDown"), 1);
  assert.equal(stepActive(2, 3, "ArrowDown"), 0);
  assert.equal(stepActive(0, 3, "ArrowUp"), 2);
  assert.equal(stepActive(-1, 3, "ArrowDown"), 0);
  assert.equal(stepActive(-1, 3, "ArrowUp"), 2);
  assert.equal(stepActive(0, 0, "ArrowDown"), -1);
});

/** A picker over `names`, in the page: what was picked, and whether it was closed. */
function fruit(names: string[], o: { close?: boolean; start?: number } = {}) {
  const input = document.body.appendChild(el("input", {}));
  const list = document.body.appendChild(el("div", {}));
  const got = { picked: [] as string[], closed: 0 };
  const picker = listPicker({
    input,
    list,
    rows: (q) => [el("div", { class: "line" }), ...fuzzyRank(q, names, (n) => n).map((n) => el("button", { type: "button", onclick: () => got.picked.push(n) }, n))],
    empty: () => "No fruit matches",
    ...(o.start === undefined ? {} : { start: () => o.start! }),
    ...(o.close ? { close: () => got.closed++ } : {}),
  });
  input.focus();
  const lit = () => list.querySelector(".is-active")?.textContent ?? null;
  return { input, list, got, picker, lit, done: () => (input.remove(), list.remove()) };
}

test("a picker: arrows move the lit row round the ends, Enter picks it, and the input says which is lit", () => {
  const p = fruit(["Apple", "Banana", "Cherry"]);
  assert.equal(p.input.getAttribute("role"), "combobox");
  assert.equal(p.input.getAttribute("aria-controls"), p.list.id);
  assert.equal(p.list.getAttribute("role"), "listbox");
  const options = () => [...p.list.querySelectorAll("button")];
  assert.ok(options().every((b) => b.getAttribute("role") === "option"), "each button is an option; the line between isn't");
  assert.equal(p.list.querySelector(".line")!.getAttribute("role"), null);
  assert.equal(p.lit(), "Apple", "the first row is lit to start");
  assert.equal(p.input.getAttribute("aria-activedescendant"), options()[0].id);
  assert.deepEqual(options().map((b) => b.getAttribute("aria-selected")), ["true", "false", "false"]);

  assert.ok(key("ArrowDown").defaultPrevented, "the arrow is the list's, not the caret's");
  assert.equal(p.lit(), "Banana");
  assert.equal(p.input.getAttribute("aria-activedescendant"), options()[1].id);
  key("ArrowUp");
  key("ArrowUp");
  assert.equal(p.lit(), "Cherry", "up from the first goes to the last");
  key("ArrowDown");
  assert.equal(p.lit(), "Apple", "and down from the last to the first");
  assert.equal(document.activeElement, p.input, "the focus stays in the box");

  options()[2].dispatchEvent(new window.MouseEvent("mousemove", { bubbles: true }));
  assert.equal(p.lit(), "Cherry", "the pointer lights the row it's over");
  assert.ok(key("Enter").defaultPrevented);
  assert.deepEqual(p.got.picked, ["Cherry"]);
  p.done();
});

test("a picker: typing filters and starts from the top; nothing fitting says so; redrawing keeps the lit row", () => {
  const p = fruit(["Apple", "Banana", "Cherry", "Blueberry"]);
  key("ArrowDown");
  key("ArrowDown");
  p.picker.render();
  assert.equal(p.lit(), "Cherry", "a redraw (the list loaded) keeps the row");
  type(p.input, "b");
  assert.deepEqual([...p.list.querySelectorAll("button")].map((b) => b.textContent), ["Banana", "Blueberry"]);
  assert.equal(p.lit(), "Banana");
  type(p.input, "zzz");
  assert.equal(p.list.querySelector(".fp-empty")!.textContent, "No fruit matches");
  assert.equal(p.input.getAttribute("aria-activedescendant"), null);
  key("ArrowDown");
  key("Enter");
  assert.deepEqual(p.got.picked, [], "Enter on an empty list picks nothing");
  p.done();
});

test("a picker: Escape closes it when it has a close, and is left to the dialog when it hasn't", () => {
  let heard = 0;
  const hear = () => heard++;
  document.addEventListener("keydown", hear);
  const own = fruit(["Apple"], { close: true });
  assert.ok(key("Escape").defaultPrevented);
  assert.equal(own.got.closed, 1);
  assert.equal(heard, 0, "the Escape stops there: a dialog under the picker stays open");
  own.done();
  const inDialog = fruit(["Apple"]);
  assert.ok(!key("Escape").defaultPrevented);
  assert.equal(heard, 1);
  inDialog.done();
  document.removeEventListener("keydown", hear);
});

test("a picker that starts with no row lit: a bare Enter picks nothing, an arrow lights the first", () => {
  const p = fruit(["Apple", "Banana"], { start: -1 });
  assert.equal(p.lit(), null);
  key("Enter");
  assert.deepEqual(p.got.picked, []);
  key("ArrowDown");
  key("Enter");
  assert.deepEqual(p.got.picked, ["Apple"]);
  p.done();
});

test("arrowFocus: a popover of buttons moves the focus with the arrows, Home and End, past disabled ones", () => {
  const box = document.body.appendChild(el("div", {}, el("input", { type: "date" }), ...["a", "b", "c", "d"].map((t) => el("button", { type: "button", class: t === "c" ? "" : "fp-item", disabled: t === "b" }, t))));
  box.addEventListener("keydown", (e) => arrowFocus(box, e));
  const [a, , c, d] = [...box.querySelectorAll("button")];
  const at = () => document.activeElement?.textContent;
  a.focus();
  key("ArrowDown");
  assert.equal(at(), "c", "the disabled one is passed over");
  key("ArrowDown");
  key("ArrowDown");
  assert.equal(at(), "a", "round the end");
  key("ArrowUp");
  assert.equal(at(), "d");
  key("Home");
  assert.equal(at(), "a");
  key("End");
  assert.equal(at(), "d");
  assert.ok(!key("ArrowRight").defaultPrevented, "sideways only when asked for");
  // A field keeps its own arrow keys (a date input steps its day with them).
  const input = box.querySelector("input")!;
  input.focus();
  assert.ok(!key("ArrowDown").defaultPrevented);
  assert.equal(document.activeElement, input);
  // Only the buttons a selector names, and sideways when asked.
  d.focus();
  const e = new window.KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true });
  Object.defineProperty(e, "target", { value: d });
  assert.ok(arrowFocus(box, e, ".fp-item", { sideways: true }));
  assert.equal(at(), "a", "c isn't an .fp-item, and b is disabled");
  assert.ok(c);
  box.remove();
});

test("the folder picker matches fuzzily, says when nothing fits, and offers a new folder where it can", () => {
  const anchor = document.body.appendChild(el("button", {}));
  const folders = ["Areas", "Areas/Health and Fitness", "Projects"];
  const picked: string[] = [];
  const items = () => texts(".folder-picker .fp-item");
  const input = () => document.querySelector<HTMLInputElement>(".folder-picker .fp-input")!;

  folderPicker(anchor, { folders, current: "Projects", onPick: (f) => picked.push(f) });
  assert.deepEqual(items(), ["Top level", "Areas", "Areas/Health and Fitness", "Projectshere"]);
  type(input(), "hfit");
  assert.deepEqual(items(), ["Areas/Health and Fitness", "New folder “hfit”"], "letters in order find the folder; the name typed can still be made");
  key("Enter");
  assert.deepEqual(picked, ["Areas/Health and Fitness"]);
  assert.equal(document.querySelector(".folder-picker"), null, "picking closes it");

  // A filter only picks folders that exist: with none fitting, it says so.
  folderPicker(anchor, { folders, current: "", onPick: (f) => picked.push(f), top: "Any folder", create: false });
  type(input(), "zzz");
  assert.deepEqual(items(), []);
  assert.equal(document.querySelector(".folder-picker .fp-empty")!.textContent, "No folder matches");
  type(input(), "ar");
  key("ArrowDown");
  key("Enter");
  assert.deepEqual(picked, ["Areas/Health and Fitness", "Areas/Health and Fitness"], "Areas is lit first, the arrow goes to the next");
  folderPicker(anchor, { folders, current: "", onPick: (f) => picked.push(f) });
  key("Escape");
  assert.equal(document.querySelector(".folder-picker"), null);
  anchor.remove();
});

const task = (text: string): Task => ({ path: "Tasks.md", line: 1, done: false, text, meta: parseTask(`- [ ] ${text}`)!.meta }) as unknown as Task;
function chipContext(text: string, people: string[] = []) {
  const saved: TaskPatch[] = [];
  const ctx: ChipContext = { task: task(text), save: async (p) => void saved.push(p), people: async () => people, showPerson: () => {} };
  return { ctx, saved };
}

test("a task's chip editors take the arrow keys: a menu of picks, and a person found fuzzily", async () => {
  const anchor = document.body.appendChild(el("button", {}));
  const menu = chipContext("Call Sam");
  openFieldEditor("priority", anchor, "", menu.ctx);
  assert.equal(document.activeElement?.textContent, "Normalnow", "the one it is now has the focus");
  key("ArrowUp");
  assert.equal(document.activeElement?.textContent, "High");
  key("ArrowUp");
  assert.equal(document.activeElement?.textContent, "Low", "round the end");
  (document.activeElement as HTMLElement).click();
  await tick();
  assert.deepEqual(menu.saved, [{ priority: "low" }]);

  // Due: the date field keeps its own arrows; the quick picks under it take them.
  const due = chipContext("Call Sam");
  openFieldEditor("due", anchor, "", due.ctx);
  assert.deepEqual(texts(".chip-pop .fp-item").map((t) => t!.replace(/ · .*/, "")), ["Today", "Tomorrow", "Next week", "Clear"]);
  assert.ok(!key("ArrowDown").defaultPrevented, "in the date field the arrow is the date's");
  document.querySelector<HTMLElement>(".chip-pop .fp-item")!.focus();
  key("ArrowDown");
  assert.equal(document.activeElement?.textContent, "Tomorrow");
  key("Escape");
  assert.equal(document.querySelector(".chip-pop"), null);

  const who = chipContext("Call Sam", ["Priya", "Sam-Lee", "Sandeep"]);
  openFieldEditor("assignees", anchor, "", who.ctx);
  await tick();
  const names = () => texts(".chip-pop .fp-item").map((t) => t!.slice(t!.indexOf("@"))); // past the avatar's initials
  assert.deepEqual(names(), ["@Priya", "@Sam-Lee", "@Sandeep"]);
  type(document.activeElement as HTMLInputElement, "sl");
  assert.deepEqual(names(), ["@Sam-Lee", "@sl"], "s…l finds Sam-Lee; the name typed is someone new");
  key("ArrowDown");
  key("ArrowUp");
  key("Enter");
  await tick();
  assert.deepEqual(who.saved, [{ assignees: ["Sam-Lee"] }]);
  anchor.remove();
});

test("the date quick picks are the same days everywhere: today, tomorrow, a week on", () => {
  assert.deepEqual(datePicks("2026-10-30").map((p) => p.day), ["2026-10-30", "2026-10-31", "2026-11-06"]);
  assert.deepEqual(datePicks("2026-10-30").map((p) => p.label.replace(/ · .*/, "")), ["Today", "Tomorrow", "Next week"]);
  assert.match(datePicks("2026-10-30")[2].label, /^Next week · .*6/);
});

test("the event form offers the date quick picks; one moves the start and the end with it", () => {
  const start = new Date(2026, 0, 5, 10, 0);
  const form = openEventForm({
    mode: "new",
    initial: { source: "local", title: "Review", start, end: new Date(2026, 0, 5, 10, 30), allDay: false, location: "", description: "", attendees: [], meetingNote: false },
    targets: [{ value: "local", name: "Notes" }] as never,
    save: async () => {},
  });
  const picks = [...document.querySelectorAll<HTMLButtonElement>(".cal-f-picks button")];
  assert.deepEqual(picks.map((b) => b.textContent!.replace(/ · .*/, "")), ["Today", "Tomorrow", "Next week"]);
  const [today, tomorrow] = datePicks();
  const field = (label: string) => document.querySelector<HTMLInputElement>(`.cal-f input[aria-label="${label}"]`)!;
  picks[1].click();
  assert.equal(field("Start date").value, tomorrow.day);
  assert.equal(field("End date").value, tomorrow.day, "the end keeps the event's length");
  assert.equal(field("Start time").value, "10:00", "and the time of day stays");
  picks[0].click();
  assert.equal(field("Start date").value, today.day);
  form.close();
});
