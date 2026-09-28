import { test } from "node:test";
import assert from "node:assert/strict";
import { dueFilter, editTask, parseTask } from "../src/core/tasks.ts";

const LINE = "- [ ] Send invoice to Acme due:2026-10-01 rec:monthly #work/clients @jane !high";

test("a task line's tokens become its metadata, and its text without the trailing ones is its summary", () => {
  assert.deepEqual(parseTask(LINE), {
    done: false,
    text: "Send invoice to Acme due:2026-10-01 rec:monthly #work/clients @jane !high",
    summary: "Send invoice to Acme",
    meta: { due: "2026-10-01", start: null, done: null, rec: "monthly", priority: "high", assignees: ["jane"], tags: ["work/clients"] },
  });
  assert.deepEqual(parseTask("  * [x] Renew passport done:2026-09-20 scheduled:2026-09-01T09:30")?.meta, {
    due: null, start: "2026-09-01T09:30", done: "2026-09-20", rec: null, priority: null, assignees: [], tags: [],
  });
  assert.equal(parseTask("Not a task due:2026-10-01"), null);
});

test("words that only look like tokens stay text", () => {
  const t = parseTask("- [ ] Email me@example.com about `due:2026-01-01` and !highlight, due:tomorrow, due:2026-13-40 #27")!;
  assert.deepEqual(t.meta, { due: null, start: null, done: null, rec: null, priority: null, assignees: [], tags: [] });
  assert.equal(t.summary, t.text);
});

test("a token mid-sentence counts but stays in the summary; only the trailing run is taken out", () => {
  const t = parseTask("- [ ] Ask @sam about the #launch plan !low")!;
  assert.deepEqual([t.summary, t.meta.assignees, t.meta.tags, t.meta.priority], ["Ask @sam about the #launch plan", ["sam"], ["launch"], "low"]);
});

test("editing one field rewrites only that token, and leaves every other byte alone", () => {
  assert.equal(editTask(LINE, { due: "2026-10-02" }), LINE.replace("due:2026-10-01", "due:2026-10-02"));
  assert.equal(editTask(LINE, { priority: null }), LINE.replace(" !high", ""));
  assert.equal(editTask(LINE, { priority: "low", assignees: ["jane", "sam"] }), LINE.replace("!high", "!low") + " @sam");
  assert.equal(editTask(LINE, { tags: [] }), LINE.replace(" #work/clients", ""));
  assert.equal(editTask("- [ ] Call mom  ", { due: "2026-01-02" }), "- [ ] Call mom due:2026-01-02  ");
  assert.equal(editTask("- [ ] Plan `due:x` day", { start: "2026-01-02" }), "- [ ] Plan `due:x` day start:2026-01-02");
  assert.equal(editTask("- [ ] Water plants scheduled:2026-01-01", { start: "2026-02-01" }), "- [ ] Water plants scheduled:2026-02-01");
  assert.equal(editTask(LINE, { checked: true, done: "2026-10-01" }), LINE.replace("[ ]", "[x]") + " done:2026-10-01");
});

test("setting every field to what it already is changes nothing", () => {
  for (const line of [LINE, "- [x] Renew passport done:2026-09-20", "\t+ [ ] Ask @Sam about the #launch plan !LOW due:2026-01-01T08:00", "- [ ] plain"]) {
    const { done, meta } = parseTask(line)!;
    assert.equal(editTask(line, { checked: done, ...meta }), line, line);
  }
});

test("a person ends at a word boundary and never inside a [[link]], and an impossible date isn't a date", () => {
  const t = parseTask("- [ ] prep [[Call with @jane]] and ask @sam's team, then @ana. due:2026-04-31 start:2026-02-28")!;
  assert.deepEqual([t.meta.assignees, t.meta.due, t.meta.start], [["ana"], null, "2026-02-28"]);
  assert.equal(editTask("- [ ] prep [[Call with @jane]] now", { assignees: [] }), "- [ ] prep [[Call with @jane]] now");
});

test("values come in as people write them (#tag, @person, repeats) and go out as tokens that read back", () => {
  const line = editTask("- [ ] a", { tags: ["#work", " home ", "Work"], assignees: ["@jane"] });
  assert.equal(line, "- [ ] a #work #home @jane");
  assert.deepEqual(parseTask(line)!.meta.tags, ["work", "home"]);
});

test("cutting a token takes the whitespace before it, and a tag's trailing slash goes with it", () => {
  assert.equal(editTask("- [ ] a\tdue:2026-01-01", { due: null }), "- [ ] a");
  assert.equal(editTask("- [ ] a  due:2026-01-01  b", { due: null }), "- [ ] a  b");
  assert.equal(editTask("- [ ] due:2026-01-01 a", { due: null }), "- [ ] a");
  assert.equal(editTask("- [ ] a #work/", { tags: [] }), "- [ ] a");
  assert.equal(parseTask("- [ ] a #work/")!.summary, "a");
});

test("setting a field to the value it has leaves a second token for it alone", () => {
  const line = "- [ ] a due:2026-01-01 b due:2026-02-02";
  assert.equal(editTask(line, { due: "2026-01-01" }), line);
  assert.equal(editTask(line, { due: "2026-03-03" }), "- [ ] a due:2026-03-03 b due:2026-02-02");
  assert.equal(editTask(line, { due: null }), "- [ ] a b");
});

test("a due filter compares dates, with today, tomorrow and yesterday relative to the day given", () => {
  const due = (expr: string, d: string | null) => dueFilter(expr, "2026-10-01")!(d);
  assert.deepEqual(["2026-09-30", "2026-10-01", "2026-10-01T18:00", "2026-10-02", null].map((d) => due("<=today", d)), [true, true, true, false, false]);
  assert.deepEqual(["2026-10-01", "2026-10-02"].map((d) => due("tomorrow", d)), [false, true]);
  assert.deepEqual(["2026-09-29", "2026-09-30"].map((d) => due(">yesterday", d)), [false, false]);
  assert.equal(due(">=2026-09-01", "2026-09-01"), true);
  assert.deepEqual(["soon", "<=2026-02-31x", "2026-13-01"].map((e) => dueFilter(e, "2026-10-01")), [null, null, null]);
});
