import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDirective, serializeDirective } from "../web/src/widgets/args.ts";
import { EditorState } from "@codemirror/state";
import { history, undo } from "@codemirror/commands";
import { taskLineEdit } from "../web/src/editor/taskEdit.ts";
import type { TaskPatch } from "../src/core/tasks.ts";

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
