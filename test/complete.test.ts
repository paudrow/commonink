import "./dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { CompletionContext } from "@codemirror/autocomplete";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";

const { toolSource } = await import("../web/src/editor/complete.ts");

/** The slash menu's first few picks for what's typed after "/". */
function slash(q: string, n = 3) {
  const doc = `/${q}`;
  const state = EditorState.create({ doc, extensions: [markdown()], selection: { anchor: doc.length } });
  ensureSyntaxTree(state, state.doc.length, 5000);
  return toolSource(new CompletionContext(state, doc.length, false))!.options.slice(0, n).map((o) => `${o.label} (${o.detail})`);
}

test("the slash menu tells a checkbox from the list of tasks across notes", () => {
  assert.deepEqual(slash("tas", 2), ["Task list (Open tasks from across your notes)", "Checkbox (- [ ])"]);
  assert.deepEqual(slash("todo", 2), ["Checkbox (- [ ])", "Task list (Open tasks from across your notes)"]);
  assert.deepEqual(slash("check", 1), ["Checkbox (- [ ])"]);
});

test("a whole word typed in the slash menu beats a longer word it starts", () => {
  assert.deepEqual(slash("time", 2), ["Current time (HH:MM)", "Timer (Countdown with a chime)"]);
  assert.deepEqual(slash("timer", 1), ["Timer (Countdown with a chime)"]);
});
