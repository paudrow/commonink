import "./dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorState, type Transaction } from "@codemirror/state";
import { markdownWithFrontmatter } from "../web/src/editor/language.ts";
import { blockWidgets, hiddenSource, selectSource, stepIntoBlocks } from "../web/src/editor/blocks.ts";

const at = (doc: string, anchor: number, head = anchor) => EditorState.create({ doc, selection: { anchor, head }, extensions: [markdownWithFrontmatter(), blockWidgets, stepIntoBlocks] });

const NOTE = "Intro\n::timer{duration=25m}\nNext\n\n![[margin.svg]]\n\nhttps://example.com\nAfter";
const lineStart = (doc: string, n: number) => EditorState.create({ doc }).doc.line(n).from;
const lineEnd = (doc: string, n: number) => EditorState.create({ doc }).doc.line(n).to;

test("a widget's or embed's markdown line is hidden until the cursor is on it", () => {
  const hidden = (state: EditorState) => [1, 2, 3, 4, 5, 6, 7, 8].filter((n) => hiddenSource(state, n));
  assert.deepEqual(hidden(at(NOTE, 0)), [2, 5, 7]);
  assert.deepEqual(hidden(at(NOTE, lineStart(NOTE, 2) + 3)), [5, 7]);
  assert.deepEqual(hidden(at(NOTE, lineEnd(NOTE, 5))), [2, 7], "the cursor at the end of the line counts");
  assert.deepEqual(hidden(at(NOTE, lineStart(NOTE, 1), lineStart(NOTE, 8))), [], "a selection across them shows them all");
});

const run = (state: EditorState, dir: -1 | 1) => {
  let tr: Transaction | null = null;
  const handled = selectSource(dir)({ state, dispatch: (t) => (tr = t) });
  const next = (tr as Transaction | null)?.state;
  return { handled, doc: next?.doc.toString(), selected: next ? next.sliceDoc(next.selection.main.from, next.selection.main.to) : null };
};

test("Backspace after a hidden markdown line, or Delete before one, selects it instead of joining onto it", () => {
  assert.deepEqual(run(at(NOTE, lineStart(NOTE, 3)), -1), { handled: true, doc: NOTE, selected: "::timer{duration=25m}" });
  assert.deepEqual(run(at(NOTE, lineEnd(NOTE, 1)), 1), { handled: true, doc: NOTE, selected: "::timer{duration=25m}" });
  assert.deepEqual(run(at(NOTE, lineStart(NOTE, 8)), -1), { handled: true, doc: NOTE, selected: "https://example.com" });
  assert.equal(run(at(NOTE, lineStart(NOTE, 6)), -1).handled, false, "from an empty line Backspace works as usual");
  assert.equal(run(at(NOTE, lineStart(NOTE, 3) + 1), -1).handled, false, "not at the start of the line");
  assert.equal(run(at(NOTE, lineEnd(NOTE, 3)), 1).handled, false, "the next line is empty, not a card");
  assert.equal(run(at(NOTE, lineStart(NOTE, 3), lineStart(NOTE, 3) + 2), -1).handled, false, "a selection deletes as usual");
});

test("one arrow press past a hidden markdown line lands on it; a click lands where it was clicked", () => {
  const move = (from: number, to: number, userEvent = "select") => at(NOTE, lineStart(NOTE, from)).update({ selection: { anchor: lineStart(NOTE, to) }, userEvent }).state;
  const line = (s: EditorState) => s.doc.lineAt(s.selection.main.head).number;
  assert.equal(line(move(1, 3)), 2);
  assert.equal(line(move(3, 1)), 2);
  assert.equal(line(move(6, 8)), 7);
  assert.equal(line(move(4, 6)), 5);
  assert.equal(line(move(1, 4)), 4, "a longer jump is left alone");
  assert.equal(line(at(NOTE, 0).update({ selection: { anchor: lineStart(NOTE, 3) } }).state), 2, "vim's j, which has no user event");
  assert.equal(line(move(1, 3, "select.pointer")), 3, "a click");
});
