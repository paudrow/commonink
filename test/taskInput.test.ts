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
  const t: Task = { path: "Home.md", title: "Home", line: 4, text: "Call mom !high due:2026-10-05 #family", summary: "Call mom", done: false, heading: null, meta: { due: "2026-10-05", start: null, done: null, rec: null, until: null, times: null, priority: "high", assignees: [], tags: ["family"] } };
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
