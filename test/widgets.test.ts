import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDirective, serializeDirective } from "../web/src/widgets/args.ts";

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
