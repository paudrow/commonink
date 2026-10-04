// The phone's toolbar above the keyboard: what its buttons do to the note, and how the keyboard's
// height is read from the two ways a browser makes room for it.
import "./dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorView } from "@codemirror/view";
import { EditorSelection, EditorState } from "@codemirror/state";
import { keyboard, toggleLinePrefix, typeTrigger, wrapSelection } from "../web/src/touchKeyboard.ts";

function editor(doc: string, anchor: number, head = anchor) {
  const view = new EditorView({ state: EditorState.create({ doc, selection: EditorSelection.single(anchor, head), extensions: [EditorState.allowMultipleSelections.of(true)] }), parent: document.body });
  return { view, text: () => view.state.doc.toString(), selected: () => view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to) };
}

test("Task makes the cursor's line a task, a list item a task, and a task plain again", () => {
  const e = editor("Buy milk\n- Call mom\n", 3);
  toggleLinePrefix(e.view, "- [ ] ");
  assert.equal(e.text(), "- [ ] Buy milk\n- Call mom\n");
  toggleLinePrefix(e.view, "- [ ] ");
  assert.equal(e.text(), "Buy milk\n- Call mom\n");
  e.view.dispatch({ selection: { anchor: e.text().indexOf("Call") } });
  toggleLinePrefix(e.view, "- [ ] ");
  assert.equal(e.text(), "Buy milk\n- [ ] Call mom\n");
});

test("on an empty line the cursor lands after the new marker", () => {
  const e = editor("One\n", 4);
  toggleLinePrefix(e.view, "- [ ] ");
  assert.deepEqual([e.text(), e.view.state.selection.main.head], ["One\n- [ ] ", 10]);
});

test("a ticked task counts as a task, and an indented line keeps its indent", () => {
  const e = editor("  - [x] Done thing\n", 8);
  toggleLinePrefix(e.view, "- [ ] ");
  assert.equal(e.text(), "  Done thing\n");
  toggleLinePrefix(e.view, "- ");
  assert.equal(e.text(), "  - Done thing\n");
  toggleLinePrefix(e.view, "- ");
  assert.equal(e.text(), "  Done thing\n");
});

test("every selected line gets the marker, once", () => {
  const e = editor("one\ntwo\nthree\n", 1, 9);
  toggleLinePrefix(e.view, "- ");
  assert.equal(e.text(), "- one\n- two\n- three\n");
});

test("Heading goes #, ##, ###, then back to plain text", () => {
  const e = editor("Plan\n", 2);
  const steps = [1, 2, 3, 4].map(() => (toggleLinePrefix(e.view, "# "), e.text()));
  assert.deepEqual(steps, ["# Plan\n", "## Plan\n", "### Plan\n", "Plan\n"]);
});

test("Bold wraps the selection and keeps it selected; again takes the stars off", () => {
  const e = editor("a big deal", 2, 5);
  wrapSelection(e.view, "**");
  assert.deepEqual([e.text(), e.selected()], ["a **big** deal", "big"]);
  wrapSelection(e.view, "**");
  assert.deepEqual([e.text(), e.selected()], ["a big deal", "big"]);
});

test("Bold with nothing selected leaves the cursor between the stars", () => {
  const e = editor("word ", 5);
  wrapSelection(e.view, "**");
  assert.deepEqual([e.text(), e.view.state.selection.main.head], ["word ****", 7]);
});

test("[[ after a word gets a space before it, and none at the start of a line or after a space", () => {
  const e = editor("See", 3);
  typeTrigger(e.view, "[[");
  assert.equal(e.text(), "See [[");
  const start = editor("", 0);
  typeTrigger(start.view, "/");
  assert.equal(start.text(), "/");
  const spaced = editor("Ask ", 4);
  typeTrigger(spaced.view, "@");
  assert.equal(spaced.text(), "Ask @");
});

test("the keyboard's height: the visual viewport shrinking (iOS), or the window (Android)", () => {
  // iOS: the window keeps its 800px and the visual viewport is what's above the keyboard.
  assert.deepEqual(keyboard({ innerWidth: 390, innerHeight: 800, visualViewport: { height: 800 } as VisualViewport }), { height: 0, behind: 0 });
  assert.deepEqual(keyboard({ innerWidth: 390, innerHeight: 800, visualViewport: { height: 480 } as VisualViewport }), { height: 320, behind: 320 });
  // Android: the window itself gets shorter, and nothing is laid out behind the keyboard.
  assert.deepEqual(keyboard({ innerWidth: 390, innerHeight: 500, visualViewport: { height: 500 } as VisualViewport }), { height: 300, behind: 0 });
  // Turned on its side, the phone is a new width: its height starts over.
  assert.deepEqual(keyboard({ innerWidth: 800, innerHeight: 390, visualViewport: { height: 390 } as VisualViewport }), { height: 0, behind: 0 });
});
