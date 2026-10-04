// The one task input, in each place a task is typed: it reads phrases as you type, shows the chips
// they'll become, keeps a clicked phrase as words, and hands the host what was typed on Enter.
import "./dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorView } from "@codemirror/view";
import { PLACEHOLDER, taskInput, type TaskInputOptions } from "../web/src/taskInput.ts";
import { api, type Task } from "../web/src/api.ts";
import { taskRow } from "../web/src/taskRow.ts";
import { quickAddBar } from "../web/src/quickAdd.ts";
import { today } from "../web/src/taskChips.ts";
import { mountBoard, type BoardHost } from "../web/src/kanban.ts";
import { el } from "../web/src/dom.ts";
import { addDays, parseTask, type TaskPatch } from "../src/core/tasks.ts";
import { openFieldEditor } from "../web/src/taskChipEditors.ts";

const TODAY = today();
const fieldIn = (root: Element) => EditorView.findFromDOM(root.querySelector(".qa-box")!)!;
const typeInto = (view: EditorView, text: string) => view.dispatch({ changes: { from: view.state.doc.length, insert: text }, selection: { anchor: view.state.doc.length + text.length } });
const press = (view: EditorView, k: string, init: KeyboardEventInit = {}) => view.contentDOM.dispatchEvent(new window.KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init }));
const settle = () => new Promise((r) => setTimeout(r, 0));

/** A task input on the page, and its CodeMirror. */
function mount(opts: Partial<TaskInputOptions> = {}) {
  const calls: Array<[string, ...unknown[]]> = [];
  const input = taskInput({ submit: (text, ignore) => calls.push(["submit", text, ignore]), cancel: () => calls.push(["cancel"]), vim: false, ...opts });
  document.body.replaceChildren(input.dom, input.preview);
  const view = EditorView.findFromDOM(input.dom)!;
  const type = (text: string) => view.dispatch({ changes: { from: view.state.doc.length, insert: text }, selection: { anchor: view.state.doc.length + text.length } });
  const key = (k: string, init: KeyboardEventInit = {}) => view.contentDOM.dispatchEvent(new window.KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init }));
  return { input, view, calls, type, key };
}

test("a task input lights the phrases it reads and shows the chips they'll become", () => {
  const { input, view, type } = mount();
  assert.equal(view.contentDOM.getAttribute("aria-label"), PLACEHOLDER);
  type("Pay rent every month on the 1st #home");
  const lit = [...input.dom.querySelectorAll(".qa-hl")].map((n) => [n.textContent, n.className]);
  assert.deepEqual(lit, [["every month on the 1st", "qa-hl is-rec"]]);
  assert.equal(input.preview.querySelector(".qa-words")!.textContent, "Pay rent #home");
  assert.ok(input.preview.querySelector('.tk[data-field="rec"]'), "a repeat chip");
  assert.equal(input.parsed()!.meta.rec, "1st");
});

test("a click on a lit phrase keeps it as words; Enter hands over the text and the kept phrases", () => {
  const { input, view, calls, type, key } = mount();
  type("Call mom tomorrow");
  view.dispatch({ selection: { anchor: "Call mom tom".length } });
  view.contentDOM.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  assert.equal(input.dom.querySelectorAll(".qa-hl").length, 0);
  assert.equal(input.parsed()!.meta.due, null);
  key("Enter");
  assert.deepEqual(calls, [["submit", "Call mom tomorrow", ["tomorrow"]]]);
  assert.equal(view.state.doc.toString(), "Call mom tomorrow", "Enter never breaks the line");
  key("Escape");
  assert.deepEqual(calls.at(-1), ["cancel"]);
});

test("phrases already in the text a field opens with stay words: only what you type is read", () => {
  const { input, calls, type, key } = mount({ value: "Call mom tomorrow" });
  assert.equal(input.dom.querySelectorAll(".qa-hl").length, 0);
  key("Enter");
  assert.deepEqual(calls, [["submit", "Call mom tomorrow", ["tomorrow"]]]);
  type(" every week");
  assert.deepEqual([...input.dom.querySelectorAll(".qa-hl")].map((n) => n.textContent), ["every week"]);
});

test("a monthly day past the 28th gets a note offering the last day of the month, one click away", () => {
  const note = (input: { preview: HTMLElement }) => input.preview.querySelector(".rec-note");
  const words = mount();
  words.type("Pay rent every month on the 31st");
  assert.equal(note(words.input)!.textContent, "Shorter months have no 31st, so it falls on their last day. Use the last day of the month instead");
  note(words.input)!.querySelector("button")!.click();
  assert.equal(words.view.state.doc.toString(), "Pay rent on the last day of every month");
  assert.equal(words.input.parsed()!.meta.rec, "last-day");
  assert.equal(note(words.input), null);
  // A rec: token typed as it is switches as a token.
  const token = mount();
  token.type("Pay rent rec:30th");
  note(token.input)!.querySelector("button")!.click();
  assert.equal(token.view.state.doc.toString(), "Pay rent rec:last-day");
  // A plain monthly from a due date past the 28th skips the months without that day.
  const plain = mount();
  plain.type("Pay rent every month starting oct 31");
  assert.equal(note(plain.input)!.textContent, "Months without a 31st are skipped. Use the last day of the month instead");
  note(plain.input)!.querySelector("button")!.click();
  assert.equal(plain.view.state.doc.toString(), "Pay rent on the last day of every month starting oct 31");
  // The 28th is in every month: no note.
  const fine = mount();
  fine.type("Pay rent every month on the 28th");
  assert.equal(note(fine.input), null);
});

test("the repeat form notes a day past the 28th, and switches it to the last day in one click", async () => {
  Object.assign(globalThis, { innerWidth: window.innerWidth, innerHeight: window.innerHeight }); // where the popover sits
  const saved: TaskPatch[] = [];
  const anchor = el("button");
  document.body.replaceChildren(anchor);
  const meta = parseTask("- [ ] Pay rent due:2026-10-31 rec:31st")!.meta;
  const task = { path: "Bills.md", title: "Bills", line: 0, text: "Pay rent due:2026-10-31 rec:31st", summary: "Pay rent", done: false, heading: null, meta };
  openFieldEditor("rec", anchor, "31st", { task, save: async (p) => void saved.push(p), people: async () => [], showPerson: () => {} }, { more: true });
  const form = document.querySelector<HTMLFormElement>("form.chip-rec")!;
  assert.equal(form.querySelector(".rec-note")!.textContent, "Shorter months have no 31st, so it falls on their last day. Use the last day of the month instead");
  form.querySelector<HTMLButtonElement>(".rec-note button")!.click();
  assert.equal(form.querySelector(".chip-rec-summary")!.textContent, "Every month on the last day");
  assert.equal(form.querySelector(".rec-note"), null);
  form.querySelector<HTMLButtonElement>("button[type=submit]")!.click();
  await settle();
  assert.deepEqual(saved, [{ rec: "last-day", until: null, times: null }]);
});

test("Tab is the host's while typing, and a card's input takes a nested line on Shift+Enter", () => {
  let tabs = 0;
  const bar = mount({ tab: () => (tabs++, true) });
  bar.key("Tab");
  assert.equal(tabs, 1);
  const card = mount({ multiline: true, targets: false });
  card.type("Print badges next fri");
  card.key("Enter", { shiftKey: true });
  assert.deepEqual(card.calls, []);
  card.type("  - bring the lanyards");
  assert.equal(card.view.state.doc.toString(), "Print badges next fri\n  - bring the lanyards");
  assert.equal(card.input.parsed()!.words, "Print badges", "phrases are read on the first line");
});

test("with Vim, the first Esc goes to normal mode and the second leaves; Enter works from either", async () => {
  const { view, calls, type, key, input } = mount({ vim: true });
  input.focus();
  type("Water plants daily");
  key("Escape");
  assert.deepEqual(calls, [], "the first Esc is Vim's");
  key("Enter");
  assert.deepEqual(calls, [["submit", "Water plants daily", []]]);
  key("Escape");
  assert.deepEqual(calls.at(-1), ["cancel"]);
  assert.equal(view.state.doc.toString(), "Water plants daily");
});

test("the quick-add bar is a task input: Enter adds what was typed, Tab (from a note) sends it there", async () => {
  const added: unknown[][] = [];
  api.addTask = async (text, ignore = [], to) => (added.push([text, ignore, to]), { path: to ?? `Journal/${TODAY}.md`, version: "1", line: 3, text });
  const bar = quickAddBar({ added: () => {}, open: () => {}, note: "Projects/Launch.md" });
  document.body.replaceChildren(bar.root);
  const view = fieldIn(bar.root);
  assert.equal(view.contentDOM.getAttribute("aria-label"), PLACEHOLDER);
  typeInto(view, "Print badges next fri");
  assert.equal(bar.root.querySelector(".qa-hl")!.textContent, "next fri");
  assert.equal(bar.root.querySelector(".qa-where")!.textContent, `→ Journal/${TODAY}`);
  press(view, "Tab");
  assert.equal(bar.root.querySelector(".qa-where")!.textContent, "→ Launch");
  press(view, "Enter");
  await settle();
  assert.deepEqual(added, [["Print badges next fri", [], "Projects/Launch.md"]]);
  assert.equal(view.state.doc.toString(), "", "cleared for the next one");
  assert.equal(bar.root.querySelector(".qa-done")!.textContent, "Added to Projects/Launch");
});

test("the Tasks page's inline edit is a task input: phrases typed there become the task's tokens", async () => {
  const t: Task = { path: "Home.md", title: "Home", line: 4, text: "Call mom !high due:2026-10-05 #family", summary: "Call mom", done: false, heading: null, meta: { due: "2026-10-05", start: null, done: null, rec: null, until: null, times: null, priority: "high", assignees: [], tags: ["family"], backlog: null } };
  const saved: unknown[] = [];
  api.updateTask = async (_t, patch) => (saved.push(patch), { path: t.path, version: "2", line: t.line, text: t.text });
  const row = taskRow(t, { open() {}, openTag() {}, openPerson() {}, reload() {} }, null);
  document.body.replaceChildren(row);
  const edit = () => row.querySelector<HTMLElement>(".qt-words")!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  edit();
  const view = fieldIn(row);
  assert.equal(view.state.doc.toString(), "Call mom");
  assert.equal(row.querySelector<HTMLElement>(".qa-preview")!.hidden, true, "nothing read, nothing to preview");
  typeInto(view, " every week #trip");
  assert.equal(row.querySelector(".qa-hl")!.textContent, "every week");
  assert.equal(row.querySelector<HTMLElement>(".qa-preview")!.hidden, false, "the chips it'll become");
  press(view, "Enter");
  await settle();
  assert.deepEqual(saved, [{ summary: "Call mom", rec: "weekly", tags: ["family", "trip"] }]);
  assert.equal(row.querySelector(".qt-edit"), null, "the words are back");
  // Escape puts the words back and saves nothing.
  edit();
  typeInto(fieldIn(row), " tomorrow");
  press(fieldIn(row), "Escape");
  assert.equal(saved.length, 1);
  assert.equal(row.querySelector(".qt-words")!.textContent, "Call mom");
});

test("a Kanban card's add and edit fields are task inputs: phrases on the first line become tokens", async () => {
  let md = ":::kanban\n## To do\n- [ ] Water plants every day\n\n## Done\n:::\n";
  const root = el("div");
  document.body.replaceChildren(root);
  const host: BoardHost = {
    ctx: {} as BoardHost["ctx"],
    path: "Board.md",
    text: () => md,
    write: (next) => ((md = next), board.update(0)),
    undo() {}, redo() {}, readOnly: false, editText() {}, resized() {},
  };
  const board = mountBoard(root, host, 0);
  // Add: what's typed goes in as tokens, details stay under it, and the field stays open for the next card.
  root.querySelector<HTMLElement>(".kb-add")!.click();
  let view = fieldIn(root);
  assert.equal(view.contentDOM.getAttribute("aria-label"), PLACEHOLDER);
  typeInto(view, "Print badges tomorrow");
  assert.equal(root.querySelector(".qa-hl")!.textContent, "tomorrow");
  press(view, "Enter", { shiftKey: true });
  typeInto(view, "bring lanyards");
  press(view, "Enter");
  await settle();
  const due = addDays(TODAY, 1);
  assert.match(md, new RegExp(`- \\[ \\] Print badges due:${due}\\n  bring lanyards\\n`));
  assert.equal(fieldIn(root).state.doc.toString(), "", "ready for the next card");
  press(fieldIn(root), "Escape");
  await settle();
  // Edit: the card's own words stay words ("every day" was written before); what's typed is read.
  root.querySelector<HTMLElement>(".kb-card")!.click();
  view = fieldIn(root);
  assert.equal(view.state.doc.toString(), "Water plants every day");
  assert.equal(root.querySelectorAll(".qa-hl").length, 0);
  typeInto(view, " !high");
  press(view, "Enter");
  await settle();
  assert.match(md, /- \[ \] Water plants every day !high\n/);
});
