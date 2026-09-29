import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDirective, serializeDirective } from "../web/src/widgets/args.ts";
import { fieldValues } from "../web/src/widgets/core.ts";
import { QUERY_FIELDS, query } from "../web/src/widgets/query.ts";
import { formatAttrs, parseAttrs, parseQuery } from "../src/core/query.ts";
import { EditorState } from "@codemirror/state";
import { history, undo } from "@codemirror/commands";
import { taskLineEdit, taskTools, taskToolsAt } from "../web/src/editor/taskEdit.ts";
import { dayPicks, taskTokenSource } from "../web/src/editor/taskComplete.ts";
import { withTaskChips } from "../web/src/taskChips.ts";
import type { TaskPatch } from "../src/core/tasks.ts";
import { CompletionContext } from "@codemirror/autocomplete";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { WidgetType } from "@codemirror/view";

test("the query fields cover every query key a smart folder keeps, and the widget shows them all", () => {
  const every = parseQuery('q=x folder=A tag=b sort=title limit=5');
  assert.deepEqual(QUERY_FIELDS.map((f) => f.key).sort(), Object.keys(every).filter((k) => k !== "limit").sort());
  assert.deepEqual(query.fields.map((f) => f.key), ["label", ...QUERY_FIELDS.map((f) => f.key), "limit"]);
});

test("the shared fields write a query back as text, leaving out blanks and the default sort", () => {
  const edit = (src: string) => formatAttrs(fieldValues(QUERY_FIELDS, parseAttrs(src)));
  assert.equal(edit('q="launch plan" tag=work sort=title limit=5'), 'q="launch plan" tag=work sort=title');
  assert.equal(edit("folder=Projects sort=modified"), "folder=Projects");
  assert.equal(edit(""), "");
});

test("a chip edit in the editor rewrites only its token on that line, and one undo puts the line back", () => {
  const doc = "# Chores\n\n- [ ] Pay rent !high due:2026-10-01 rec:monthly @jane #admin\n- [ ] Other\n";
  let state = EditorState.create({ doc, extensions: [history()] });
  const line = "- [ ] Pay rent !high due:2026-10-01 rec:monthly @jane #admin";
  const patches: TaskPatch[] = [{ priority: null }, { due: "2026-10-05" }, { rec: "2w" }, { assignees: ["sam"] }];
  for (const patch of patches) {
    state = state.update(taskLineEdit(state, 3, state.doc.line(3).text, patch)!).state;
  }
  assert.equal(state.doc.line(3).text, "- [ ] Pay rent due:2026-10-05 rec:2w @sam #admin");
  assert.equal(state.doc.toString().replace(state.doc.line(3).text, line), doc);
  undo({ state, dispatch: (tr) => (state = tr.state) });
  assert.equal(state.doc.line(3).text, "- [ ] Pay rent due:2026-10-05 rec:2w @jane #admin");
  assert.equal(taskLineEdit(state, 3, state.doc.line(3).text, { priority: null }), null);
  assert.throws(() => taskLineEdit(state, 3, line, { due: null }), /changed while you were editing/);
});

test("ticking a repeating task in the editor adds the next one below, and one undo takes both back", () => {
  const doc = "# Pets\n\n- [ ] Dog medicine due:2026-10-01 rec:after-1m\n- [ ] Walk\n";
  let state = EditorState.create({ doc, extensions: [history()] });
  state = state.update(taskLineEdit(state, 3, state.doc.line(3).text, { checked: true }, "2026-10-08")!).state;
  assert.equal(state.doc.toString(), "# Pets\n\n- [x] Dog medicine due:2026-10-01 rec:after-1m done:2026-10-08\n- [ ] Dog medicine due:2026-11-08 rec:after-1m\n- [ ] Walk\n");
  undo({ state, dispatch: (tr) => (state = tr.state) });
  assert.equal(state.doc.toString(), doc);
  // Unticking (rather than undoing) takes the occurrence back too, and works on the last line.
  state = EditorState.create({ doc: "- [ ] Rent due:2026-10-06 rec:6th" });
  state = state.update(taskLineEdit(state, 1, state.doc.line(1).text, { checked: true }, "2026-10-04")!).state;
  state = state.update(taskLineEdit(state, 1, state.doc.line(1).text, { checked: false }, "2026-10-04")!).state;
  assert.equal(state.doc.toString(), "- [ ] Rent due:2026-10-06 rec:6th");
});

test("a field chosen from a task's ⚙ menu goes in at its place among the tokens, in one undoable change", () => {
  let state = EditorState.create({ doc: "- [ ] Call mom\n- [ ] Pay rent @jane #home\n", extensions: [history()] });
  const set = (n: number, patch: TaskPatch) => (state = state.update(taskLineEdit(state, n, state.doc.line(n).text, patch)!).state);
  set(1, { due: "2026-10-01" });
  set(2, { due: "2026-10-01" });
  set(2, { priority: "high" });
  set(2, { tags: ["home", "bills"] });
  assert.deepEqual(state.doc.toString().split("\n"), ["- [ ] Call mom due:2026-10-01", "- [ ] Pay rent !high due:2026-10-01 @jane #home #bills", ""]);
  undo({ state, dispatch: (tr) => (state = tr.state) });
  assert.equal(state.doc.line(2).text, "- [ ] Pay rent !high due:2026-10-01 @jane #home");
});

/** A markdown editor state with the cursor at the end of `line` (1-based), its syntax tree parsed. */
function at(doc: string, line: number, ch = -1) {
  const state = EditorState.create({ doc, extensions: [markdown()], selection: { anchor: 0 } });
  const l = state.doc.line(line);
  const s = state.update({ selection: { anchor: ch < 0 ? l.to : l.from + ch } }).state;
  ensureSyntaxTree(s, s.doc.length, 5000);
  return s;
}
const complete = (doc: string, line: number, ch = -1) => {
  const s = at(doc, line, ch);
  return taskTokenSource(new CompletionContext(s, s.selection.main.head, false));
};

test("typing a task's token offers its values, only in a task's text and never in code", () => {
  const labels = (doc: string, line = 1, ch = -1) => complete(doc, line, ch)?.options.map((o) => o.label) ?? null;
  const days = labels("- [ ] Call mom due:")!;
  assert.deepEqual([days.length, days[0], days[1], days.at(-2), days.at(-1)], [9, "Today", "Tomorrow", "Next week", "Pick a date…"]);
  assert.deepEqual(labels("- [ ] Call mom start:"), days);
  assert.equal(labels("- [ ] Call mom rec:")!.at(-1), "More options…");
  assert.ok(labels("- [ ] Call mom rec:")!.includes("Weekly"));
  assert.deepEqual(labels("- [ ] Call mom !"), ["!high", "!low"]);
  assert.equal(complete("- [ ] Call mom due:", 1)!.from, "- [ ] Call mom due:".length);
  // Not a task line, not in code (fenced or inline), not mid-word.
  assert.equal(labels("Call mom due:"), null);
  assert.equal(labels("- Call mom due:"), null);
  assert.equal(labels("```\n- [ ] Call mom due:\n```", 2), null);
  assert.equal(labels("- [ ] Call `mom due:` now", 1, "- [ ] Call `mom due:".length), null);
  assert.equal(labels("- [ ] Call mom!"), null);
});

test("the days offered after due: count from today: tomorrow, then the coming weekdays by name, then a week out", () => {
  assert.deepEqual(dayPicks("2026-09-28"), [ // a Monday
    { label: "Today", date: "2026-09-28" },
    { label: "Tomorrow", date: "2026-09-29" },
    { label: "Next Wednesday", date: "2026-09-30" },
    { label: "Next Thursday", date: "2026-10-01" },
    { label: "Next Friday", date: "2026-10-02" },
    { label: "Next Saturday", date: "2026-10-03" },
    { label: "Next Sunday", date: "2026-10-04" },
    { label: "Next week", date: "2026-10-05" },
  ]);
});

test("the task line's tools and hint are drawn at the end of the cursor's task line, and are never in the document", () => {
  class Dummy extends WidgetType {
    constructor(readonly hint: boolean) {
      super();
    }
    toDOM() {
      return null as unknown as HTMLElement;
    }
  }
  const field = taskTools((hint) => new Dummy(hint));
  const doc = "# List\n- [ ] Call mom\n- [ ] Pay rent due:2026-10-01\nProse\n```\n- [ ] in code\n```";
  const widgets = (line: number) => {
    const s = at(doc, line).update({}).state;
    const state = EditorState.create({ doc: s.doc, selection: s.selection, extensions: [markdown(), field] });
    ensureSyntaxTree(state, state.doc.length, 5000);
    const found: Array<{ pos: number; hint: boolean }> = [];
    state.field(field).between(0, state.doc.length, (from, _to, d) => void found.push({ pos: from, hint: (d.spec.widget as Dummy).hint }));
    assert.equal(state.doc.toString(), doc); // drawn, never written
    return found;
  };
  assert.deepEqual(widgets(2), [{ pos: doc.indexOf("Call mom") + "Call mom".length, hint: true }]);
  assert.deepEqual(widgets(3), [{ pos: doc.indexOf("2026-10-01") + 10, hint: false }]);
  assert.deepEqual(widgets(1), []);
  assert.deepEqual(widgets(4), []);
  assert.equal(taskToolsAt(at(doc, 6)), null); // a task-looking line in code
  assert.equal(taskToolsAt(EditorState.create({ doc: "- [ ] a", extensions: [EditorState.readOnly.of(true)] })), null);
});

test("a Notes card shows a task's words, then its chips where its tokens were; code keeps its text", () => {
  const md = "Intro\n- [ ] Send invoice to Acme due:2026-10-01 rec:monthly #work/clients @jane !high\n  - [x] Renew passport done:2026-09-20\n```\n- [ ] Keep due:2026-10-01\n```";
  const { md: out, tasks } = withTaskChips(md);
  assert.deepEqual(out.split("\n"), ["Intro", "- [ ] Send invoice to Acme \uE0000\uE001", "  - [x] Renew passport \uE0001\uE001", "```", "- [ ] Keep due:2026-10-01", "```"]);
  assert.deepEqual(tasks.map((t) => [t.summary, t.meta.due, t.meta.assignees, t.done]), [["Send invoice to Acme", "2026-10-01", ["jane"], false], ["Renew passport", null, [], true]]);
});

test("a widget arg can compare with <, <=, > or >= and round-trips through its markdown line", () => {
  const line = '::tasks{tag=work due<=today assignee=jane label="This week" id=k3x9q}';
  const d = parseDirective(line)!;
  assert.deepEqual(d.args, { tag: "work", due: "<=today", assignee: "jane", label: "This week", id: "k3x9q" });
  assert.equal(serializeDirective(d), line);
  assert.deepEqual(parseDirective("::tasks{due=2026-10-01 due>2026-01-01}")!.args, { due: ">2026-01-01" });
  assert.equal(serializeDirective({ name: "tasks", args: { due: ">= tomorrow", label: "a<b c" } }), '::tasks{due>=tomorrow label="a<b c"}');
});

test("only a key that compares is written with its operator; any other value starting with < or > is quoted", () => {
  const d = { name: "query", args: { label: "<3 launch", q: ">foo" } };
  assert.equal(serializeDirective(d), '::query{label="<3 launch" q=">foo"}');
  assert.deepEqual(parseDirective(serializeDirective(d))!.args, d.args);
});
