import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDirective, serializeDirective } from "../web/src/widgets/args.ts";
import { fieldValues } from "../web/src/widgets/core.ts";
import { QUERY_FIELDS, query } from "../web/src/widgets/query.ts";
import { formatAttrs, parseAttrs, parseQuery } from "../src/core/query.ts";
import { EditorState } from "@codemirror/state";
import { history, undo } from "@codemirror/commands";
import { taskLineEdit } from "../web/src/editor/taskEdit.ts";
import type { TaskPatch } from "../src/core/tasks.ts";

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
