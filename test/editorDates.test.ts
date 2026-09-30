// Dates typed on a task line in the editor: a phrase typed at the end becomes its token when the
// cursor leaves the line, a toast says what it became, and one undo (or the toast's Undo) puts the
// words back.
import "./dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { history, undo } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { taskLineTools } from "../web/src/editor/taskTools.ts";
import { editorContext, type EditorContext } from "../web/src/editor/blocks.ts";
import { addDays, localDate } from "../src/core/tasks.ts";

const settle = () => new Promise((r) => setTimeout(r, 0));

function editor(doc: string, line: number) {
  const state = EditorState.create({ doc, extensions: [markdown(), history(), editorContext.of({ path: "Errands.md" } as EditorContext), taskLineTools] });
  const view = new EditorView({ state, parent: document.body });
  ensureSyntaxTree(view.state, view.state.doc.length, 5000);
  view.dispatch({ selection: { anchor: view.state.doc.line(line).to } });
  const type = (text: string) => {
    const head = view.state.selection.main.head;
    view.dispatch({ changes: { from: head, insert: text }, selection: { anchor: head + text.length }, userEvent: "input.type" });
  };
  const move = (to: number) => view.dispatch({ selection: { anchor: view.state.doc.line(to).to } });
  return { view, type, move, line: (n: number) => view.state.doc.line(n).text };
}

test("in the editor, a date typed at the end of a task is its due date once you leave the line, with a toast and one undo", async () => {
  const tomorrow = addDays(localDate(Date.now()), 1);
  const { view, type, move, line } = editor("# Errands\n- [ ] \n", 2);
  type("Buy milk tomorrow");
  move(3);
  await settle();
  assert.equal(line(2), `- [ ] Buy milk due:${tomorrow}`);
  const shown = [...document.querySelectorAll(".toast")].at(-1)!;
  assert.equal(shown.querySelector(".toast-text")!.textContent, "Buy milk: due Tomorrow");
  assert.equal(shown.querySelector(".toast-action")!.textContent, "Undo");
  // One undo takes back the conversion alone: the words are back, and the cursor stays where it went.
  undo(view);
  assert.equal(line(2), "- [ ] Buy milk tomorrow");
  assert.equal(view.state.doc.lineAt(view.state.selection.main.head).number, 3);
  // Coming back through the line doesn't convert it again: those words weren't just typed.
  move(2);
  move(3);
  await settle();
  assert.equal(line(2), "- [ ] Buy milk tomorrow");
  view.destroy();
});

test("the toast's Undo puts the words back, unless the line has changed since", async () => {
  const tomorrow = addDays(localDate(Date.now()), 1);
  const { view, type, move, line } = editor("- [ ] \n\n", 1);
  type("Call mom tomorrow");
  move(2);
  await settle();
  const undoButton = () => [...document.querySelectorAll<HTMLButtonElement>(".toast .toast-action")].at(-1)!;
  undoButton().click();
  assert.equal(line(1), "- [ ] Call mom tomorrow");
  // Again, but edit the line before pressing Undo: it leaves the line as it is.
  const second = editor("- [ ] \n\n", 1);
  second.type("Call mom tomorrow");
  second.move(2);
  await settle();
  second.view.dispatch({ changes: { from: 0, to: second.line(1).length, insert: `- [ ] Call dad due:${tomorrow}` } });
  undoButton().click();
  assert.equal(second.line(1), `- [ ] Call dad due:${tomorrow}`);
  view.destroy();
  second.view.destroy();
});
