import "./dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { CompletionContext } from "@codemirror/autocomplete";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";

const { toolSource, linkSource } = await import("../web/src/editor/complete.ts");
const { editorContext } = await import("../web/src/editor/blocks.ts");

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

test("[[ offers notes, then tags; a tag replaces the brackets with #tag", async () => {
  const notes = [{ path: "Launch plan.md", title: "Launch plan", kind: "md" }, { path: "Groceries.md", title: "Groceries", kind: "md" }];
  const tags = [{ tag: "launch", display: "launch", notes: 3, tasks: 0, assets: 0 }, { tag: "food", display: "food", notes: 1, tasks: 0, assets: 0 }];
  const env = { path: "Today.md", notes: () => notes, tags: () => tags } as never;
  const doc = "See [[lau]]";
  const state = EditorState.create({ doc, extensions: [markdown(), editorContext.of(env)], selection: { anchor: doc.length - 2 } });
  const result = (await linkSource(new CompletionContext(state, doc.length - 2, false)))!;
  assert.deepEqual(result.options.map((o) => o.label), ["Launch plan", "#launch"]);
  const tag = result.options[1];
  assert.equal(typeof tag.section === "object" && tag.section.name, "Tags");
  let changes: { from: number; to: number; insert: string } | undefined;
  const view = { dispatch: (tr: { changes: typeof changes }) => (changes = tr.changes) };
  (tag.apply as Function)(view, tag, result.from, doc.length - 2);
  assert.deepEqual(changes, { from: 4, to: doc.length, insert: "#launch" });
});

test("![[ embeds offer no tags", async () => {
  const env = { path: "Today.md", notes: () => [], tags: () => [{ tag: "launch", display: "launch", notes: 3, tasks: 0, assets: 0 }] } as never;
  const doc = "![[lau";
  const state = EditorState.create({ doc, extensions: [markdown(), editorContext.of(env)], selection: { anchor: doc.length } });
  const result = (await linkSource(new CompletionContext(state, doc.length, false)))!;
  assert.deepEqual(result.options, []);
});
