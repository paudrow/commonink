import "./dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { CompletionContext } from "@codemirror/autocomplete";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";

const { toolSource, linkSource, viewKindFor } = await import("../web/src/editor/complete.ts");
const { pendingConfig } = await import("../web/src/widgets/index.ts");
const { editorContext } = await import("../web/src/editor/blocks.ts");

function menu(q: string) {
  const doc = `/${q}`;
  const state = EditorState.create({ doc, extensions: [markdown()], selection: { anchor: doc.length } });
  ensureSyntaxTree(state, state.doc.length, 5000);
  return { state, options: toolSource(new CompletionContext(state, doc.length, false))!.options };
}

/** The slash menu's first few picks for what's typed after "/". */
function slash(q: string, n = 3) {
  return menu(q).options.slice(0, n).map((o) => `${o.label} (${o.detail})`);
}

/** What picking `label` from the menu for "/q" leaves in the note (the widget's id taken out). */
function pick(q: string, label: string) {
  const { state, options } = menu(q);
  const view = new EditorView({ state, parent: document.body });
  const option = options.find((o) => o.label === label)!;
  (option.apply as (v: EditorView, c: unknown, from: number, to: number) => void)(view, option, 0, state.doc.length);
  const text = view.state.doc.toString();
  view.destroy();
  pendingConfig.clear();
  return text.replace(/ ?id=\w+/, "").replace("{}", "");
}

test("the slash menu tells a checkbox from the list of tasks across notes", () => {
  assert.deepEqual(slash("tas", 2), ["Tasks view (Open tasks from across your notes)", "Checkbox (- [ ])"]);
  assert.deepEqual(slash("todo", 2), ["Checkbox (- [ ])", "Tasks view (Open tasks from across your notes)"]);
  assert.deepEqual(slash("check", 1), ["Checkbox (- [ ])"]);
});

test("a whole word typed in the slash menu beats a longer word it starts", () => {
  assert.deepEqual(slash("time", 2), ["Current time (HH:MM)", "Timer (Countdown with a chime)"]);
  assert.deepEqual(slash("timer", 1), ["Timer (Countdown with a chime)"]);
});

test("the slash menu has one View, and the old widget names pick its kind", () => {
  const all = menu("").options.map((o) => o.label);
  assert.equal(all.filter((l) => /view$/i.test(l)).length, 1);
  assert.ok(all.includes("View") && all.includes("Timer") && all.includes("Stopwatch"));
  const kinds = (qs: string[]) => qs.map((q) => viewKindFor(q));
  assert.deepEqual(kinds(["query", "tasks", "calendar", "agenda", "today", "kanban"]), ["notes", "tasks", "month", "agenda", "today", "board"]);
  assert.deepEqual(kinds(["view", "", "zzz"]), [null, null, null]);
  assert.deepEqual(slash("agenda", 1), ["Agenda view (The next few days of events)"]);
  assert.deepEqual(slash("kanban", 2), ["Kanban board (Columns of cards)", "Board view (The board in another note)"]);
  assert.deepEqual(slash("view", 1), ["View (Notes, tasks, a month, an agenda, today or a board, live)"]);
});

test("picking a View from the slash menu writes its kind first, then that kind's defaults", () => {
  assert.equal(pick("view", "View"), "::view{limit=6}\n");
  assert.equal(pick("query", "Notes view"), "::view{limit=6}\n");
  assert.equal(pick("tasks", "Tasks view"), "::view{show=tasks}\n");
  assert.equal(pick("calendar", "Month view"), "::view{show=month folder=Journal}\n");
  assert.equal(pick("agenda", "Agenda view"), "::view{show=agenda days=3}\n");
  assert.equal(pick("kanban", "Board view"), "::view{show=board}\n");
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
