// The Backlog: a task with `backlog:` on its line is out of the task lists until it's brought back,
// and one that sits idle goes there on its own unless it's tagged #dont-backlog.
import "./dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { editTask, editTaskLines, isIdle, parseTask, patchProblem } from "../src/core/tasks.ts";
import { backlogSettings, readSettings, settingsNote, SETTINGS_NOTE, withSetting } from "../src/core/schema.ts";
import { APP } from "../src/core/vault.ts";
import { handleApi } from "../src/core/api.ts";
import { COMMANDS } from "../src/core/commands/index.ts";
import { parse, type Parsed } from "../src/cli/argv.ts";
import { openTempVault } from "./helpers.ts";
import { api, type Task } from "../web/src/api.ts";
import { taskRow } from "../web/src/taskRow.ts";
import { tokenChip } from "../web/src/taskChips.ts";
import { daysFrom, tagFrom } from "../web/src/backlog.ts";

Object.assign(globalThis, { innerWidth: 1280, innerHeight: 800 }); // the task menu places itself in the window
/** A vault whose clock the test moves: `at(day)` is noon UTC on that day. */
function clocked(files: Record<string, string>, start: string) {
  const clock = { now: Date.parse(`${start}T12:00:00Z`) };
  const { vault } = openTempVault(files, { now: () => clock.now, timeZone: "UTC" });
  return { vault, clock, at: (day: string) => (clock.now = Date.parse(`${day}T12:00:00Z`)) };
}
const texts = (tasks: Array<{ text: string }>) => tasks.map((t) => t.text);

test("backlog: is a token like done:, with the day the task went; anything else that looks like it stays text", () => {
  const t = parseTask("- [ ] Learn the cello #someday backlog:2026-09-01")!;
  assert.equal(t.meta.backlog, "2026-09-01");
  assert.equal(t.summary, "Learn the cello");
  assert.equal(parseTask("- [ ] Groom the backlog:soon")!.meta.backlog, null);
  assert.equal(parseTask("- [ ] Groom it backlog:2026-02-30")!.meta.backlog, null, "not a day");
  assert.equal(editTask("- [ ] Learn the cello due:2026-12-01 #someday", { backlog: "2026-10-03" }), "- [ ] Learn the cello due:2026-12-01 #someday backlog:2026-10-03");
  assert.equal(editTask("- [ ] Learn the cello #someday backlog:2026-10-03", { backlog: null }), "- [ ] Learn the cello #someday");
  assert.match(patchProblem({ backlog: "soon" })!, /"backlog" must be a date/);
});

test("ticking a task in the Backlog takes it out: it's done, not waiting, and a repeat's next one starts in the lists", () => {
  assert.deepEqual(editTaskLines(["- [ ] Water plants due:2026-09-01 rec:weekly backlog:2026-09-20"], 0, { checked: true }, "2026-10-03"), [
    "- [x] Water plants due:2026-09-01 rec:weekly done:2026-10-03",
    "- [ ] Water plants due:2026-10-06 rec:weekly",
  ]);
});

test("the task lists leave the Backlog out unless asked: Tasks, Today and the badge; the Backlog lists only them", async () => {
  const { vault } = openTempVault({
    "Plan.md": "# Plan\n\n- [ ] Ship it due:2026-10-01\n- [ ] Learn the cello due:2026-10-01 backlog:2026-09-01\n- [x] Old and done backlog:2026-08-01\n",
  });
  assert.deepEqual(texts(vault.tasks()), ["Ship it due:2026-10-01"]);
  assert.deepEqual(texts(vault.tasks({ backlog: "include" })), ["Ship it due:2026-10-01", "Learn the cello due:2026-10-01 backlog:2026-09-01", "Old and done backlog:2026-08-01"]);
  assert.deepEqual(texts(vault.tasks({ backlog: "only" })), ["Learn the cello due:2026-10-01 backlog:2026-09-01", "Old and done backlog:2026-08-01"]);
  assert.throws(() => vault.tasks({ backlog: "some" as never }), /"backlog" must be one of exclude, include, only/);
  assert.deepEqual(vault.today("2026-10-03").sections.flatMap((s) => texts(s.tasks)), ["Ship it due:2026-10-01"]);
  assert.equal(vault.openTaskCount(), 1);
  assert.equal(vault.backlogCount(), 1);

  const host = { vault, actor: "t", user: "t", canEditShared: true, info: () => ({}), written() {}, moved() {}, removed() {}, tree() {} };
  const get = async (route: string, query = "") => (await handleApi(host, new Request(`http://localhost/api${route}${query}`), route))!.json();
  assert.deepEqual(await get("/tasks/count"), { open: 1, backlog: 1 });
  assert.deepEqual(texts(await get("/tasks")), ["Ship it due:2026-10-01"]);
  assert.equal((await get("/tasks", "?backlog=only")).length, 2);
});

test("a task moves to the Backlog and back as an edit to its note, so History shows both and can undo either", () => {
  const { vault, at } = clocked({ "Plan.md": "# Plan\n\n- [ ] Learn the cello #someday\n" }, "2026-10-03");
  const there = vault.backlogTask("Plan", 3, "Learn the cello #someday", true, "Ada");
  assert.equal(vault.read("Plan").content, "# Plan\n\n- [ ] Learn the cello #someday backlog:2026-10-03\n");
  assert.equal(there.text, "Learn the cello #someday backlog:2026-10-03");
  at("2026-10-09");
  assert.equal(vault.backlogTask("Plan", 3, there.text, true, "Ada").change, null, "already there: it keeps the day it went");
  const back = vault.backlogTask("Plan", 3, there.text, false, "Ada");
  assert.equal(vault.read("Plan").content, "# Plan\n\n- [ ] Learn the cello #someday\n");
  assert.deepEqual(vault.changes({ path: "Plan.md" }).map((c) => [c.op, c.source]), [["edit", "Ada"], ["edit", "Ada"]]);
  vault.restore(back.change!.id, "Ada");
  assert.deepEqual(texts(vault.tasks({ backlog: "only" })), [there.text], "undoing the way back puts it in the Backlog again");
  vault.restore(there.change!.id, "Ada");
  assert.deepEqual(texts(vault.tasks()), ["Learn the cello #someday"], "and undoing the move brings it back");
});

test("idle is open, untouched for the days given, with no date still ahead or just past, and not tagged to stay", () => {
  const task = (line: string) => parseTask(line)!;
  assert.equal(isIdle(task("- [ ] Sit"), "2026-09-01", "2026-10-01", 30), true);
  assert.equal(isIdle(task("- [ ] Sit"), "2026-09-02", "2026-10-01", 30), false, "29 days");
  assert.equal(isIdle(task("- [x] Sat"), "2026-01-01", "2026-10-01", 30), false);
  assert.equal(isIdle(task("- [ ] Sit backlog:2026-02-01"), "2026-01-01", "2026-10-01", 30), false, "there already");
  assert.equal(isIdle(task("- [ ] Taxes due:2027-04-15"), "2026-01-01", "2026-10-01", 30), false, "waiting for its date");
  assert.equal(isIdle(task("- [ ] Taxes due:2026-09-20"), "2026-01-01", "2026-10-01", 30), false, "overdue, but not for long");
  assert.equal(isIdle(task("- [ ] Taxes due:2026-04-15"), "2026-01-01", "2026-10-01", 30), true, "overdue for months");
  assert.equal(isIdle(task("- [ ] Trip start:2026-11-01"), "2026-01-01", "2026-10-01", 30), false);
  assert.equal(isIdle(task("- [ ] Keep me #dont-backlog"), "2026-01-01", "2026-10-01", 30), false);
  assert.equal(isIdle(task("- [ ] Keep me #Dont-Backlog/ever"), "2026-01-01", "2026-10-01", 30), false);
  assert.equal(isIdle(task("- [ ] Keep me #keep"), "2026-01-01", "2026-10-01", 30, "keep"), false, "the tag is a setting");
  assert.equal(isIdle(task("- [ ] Sit #dont-backlog"), "2026-01-01", "2026-10-01", 30, "keep"), true);
  assert.equal(isIdle(task("- [ ] Sit"), "2026-01-01", "2026-10-01", 0), false, "0 is never");
});

const NOTE = ["# Home", "", "- [ ] Fix the gate", "- [ ] Call the roofer", "- [ ] Renew passport #dont-backlog", "- [ ] File taxes due:2026-12-01", "- [x] Paint the fence done:2026-09-01", ""].join("\n");

test("a task nobody touches for 30 days moves to the Backlog on its own, as a change by Common Ink; one that's edited starts over", () => {
  const { vault, at } = clocked({ "Home.md": NOTE }, "2026-09-01");
  vault.create("Fresh.md", "- [ ] Written today\n", "Ada");
  at("2026-09-20");
  vault.updateTask("Home", 4, "Call the roofer", { priority: "high" }, "Ada"); // touched: its 30 days start again
  at("2026-09-30");
  assert.deepEqual(vault.autoBacklog(), [], "29 days: nothing yet");
  at("2026-10-01");
  const moved = vault.autoBacklog();
  assert.deepEqual(moved.map((m) => [m.path, m.tasks]), [["Fresh.md", 1], ["Home.md", 1]]);
  assert.equal(
    vault.read("Home").content,
    ["# Home", "", "- [ ] Fix the gate backlog:2026-10-01", "- [ ] Call the roofer !high", "- [ ] Renew passport #dont-backlog", "- [ ] File taxes due:2026-12-01", "- [x] Paint the fence done:2026-09-01", ""].join("\n"),
  );
  const change = vault.changes({ path: "Home.md", limit: 1 })[0];
  assert.deepEqual([change.source, change.person, change.agent, change.summary], [APP, "Common Ink", null, "1 idle task to the Backlog"]);
  assert.deepEqual(vault.autoBacklog({ force: true }), [], "nothing left to move");
  at("2026-10-20");
  assert.deepEqual(vault.autoBacklog().map((m) => m.path), ["Home.md"], "the one that was edited, 30 days after the edit");
  assert.match(vault.read("Home").content, /Call the roofer !high backlog:2026-10-20/);

  // Brought back, it's touched: it doesn't go straight back the next day.
  vault.backlogTask("Home", 3, "Fix the gate backlog:2026-10-01", false, "Ada");
  at("2026-10-21");
  assert.deepEqual(vault.autoBacklog(), []);
  assert.deepEqual(texts(vault.tasks({ note: "Home" }).filter((t) => !t.done)), ["Fix the gate", "Renew passport #dont-backlog", "File taxes due:2026-12-01"]);
  // History undoes the app's move like any other change.
  vault.restore(vault.changes({ path: "Home.md" }).find((c) => c.source === APP && c.summary === "1 idle task to the Backlog" && c.ts === Date.parse("2026-10-20T12:00:00Z"))!.id, "Ada");
  assert.match(vault.read("Home").content, /^- \[ \] Call the roofer !high$/m);
});

test("the sweep runs once a day, and again when the settings change; they set the days, the tag, and turn it off", () => {
  const { vault, at } = clocked({ "Home.md": "- [ ] Fix the gate\n- [ ] Renew passport #dont-backlog\n- [ ] Read more #keep\n" }, "2026-09-01");
  at("2026-09-10");
  vault.create(SETTINGS_NOTE, withSetting(settingsNote(), "auto_backlog_days", 0), "Ada");
  at("2026-12-01");
  assert.deepEqual(vault.autoBacklog(), [], "0: off");
  vault.save(SETTINGS_NOTE, withSetting(withSetting(vault.read(SETTINGS_NOTE).content, "auto_backlog_days", 7), "backlog_exempt_tag", "keep"), { source: "Ada" });
  assert.deepEqual(vault.autoBacklog().map((m) => m.tasks), [2], "the same day: the settings changed, so it looks again");
  assert.equal(vault.read("Home").content, "- [ ] Fix the gate backlog:2026-12-01\n- [ ] Renew passport #dont-backlog backlog:2026-12-01\n- [ ] Read more #keep\n");
  vault.create("Late.md", "- [ ] Added later\n", "Ada");
  at("2026-12-01");
  assert.deepEqual(vault.autoBacklog(), [], "once a day");
  assert.deepEqual(backlogSettings(null), { days: 30, tag: "dont-backlog" });
  assert.deepEqual(backlogSettings("---\nauto_backlog_days: 14\nbacklog_exempt_tag: '#Keep'\n---\n"), { days: 14, tag: "Keep" });
  assert.deepEqual(readSettings("---\nauto_backlog_days: soon\nbacklog_exempt_tag: '!!'\n---\n"), {}, "values that aren't valid are left out");
});

test("a card on a board stays, a renamed note's tasks are no newer for it, and archived notes and templates are left alone", () => {
  const board = ["# Board", "", ":::kanban", "## Backlog", "- [ ] A card", "## Doing", ":::", "", "- [ ] Under the board", ""].join("\n");
  const { vault, at } = clocked({ "Board.md": board, "Old name.md": "- [ ] Rename me\n", "Templates/Daily.md": "- [ ] From a template\n", "Gone.md": "- [ ] Archived\n" }, "2026-09-01");
  vault.archive("Gone", "Ada");
  at("2026-09-25");
  vault.move("Old name", "New name", "Ada");
  at("2026-10-05");
  assert.deepEqual(vault.autoBacklog().map((m) => [m.path, m.tasks]), [["Board.md", 1], ["New name.md", 1]]);
  assert.match(vault.read("Board").content, /- \[ \] A card\n/);
  assert.match(vault.read("Board").content, /- \[ \] Under the board backlog:2026-10-05\n/);
  assert.equal(vault.read("Templates/Daily").content, "- [ ] From a template\n");
});

test("agents: list_tasks leaves the Backlog out unless asked, and update_task moves a task there and back", async () => {
  const { vault } = openTempVault({ "Plan.md": "- [ ] Ship it\n- [ ] Learn the cello backlog:2026-09-01\n" }, { now: () => Date.parse("2026-10-03T12:00:00Z"), timeZone: "UTC" });
  const host = { vault, user: "t", source: "Claude\u001fAda", canEditShared: true };
  const run = (mcp: string, input: Record<string, unknown>) => Promise.resolve(COMMANDS.find((c) => c.mcp === mcp)!.run(host as never, input as never));
  assert.equal((await run("list_tasks", {})).text, "- [ ] Ship it — Plan.md:1");
  assert.equal((await run("list_tasks", { backlog: "only" })).text, "- [ ] Learn the cello backlog:2026-09-01 — Plan.md:2");
  assert.equal(((await run("list_tasks", { backlog: "include" })).data as unknown[]).length, 2);
  await run("update_task", { path: "Plan", line: 1, text: "Ship it", backlog: true });
  await run("update_task", { path: "Plan", line: 2, text: "Learn the cello backlog:2026-09-01", backlog: false });
  assert.equal(vault.read("Plan").content, "- [ ] Ship it backlog:2026-10-03\n- [ ] Learn the cello\n");
  assert.equal(vault.changes({ limit: 1 })[0].agent, "Claude");
  // The CLI names a task by its line, in the Backlog or not.
  const io = { stdin: () => null, readFile: () => { throw new Error("no files"); } };
  const cli = (...argv: string[]) => parse(argv, io) as Parsed;
  assert.deepEqual(cli("tasks", "--backlog", "only").input, { backlog: "only" });
  assert.deepEqual(cli("task", "Plan", "1", "--from-backlog").input, { path: "Plan", line: 1, backlog: false });
  const back = cli("task", "Plan", "1", "--from-backlog");
  await back.command.run(host as never, back.input as never);
  assert.equal(vault.read("Plan").content, "- [ ] Ship it\n- [ ] Learn the cello\n");
});

test("in a list, a task in the Backlog shows since when and its way back; its menu moves one there", async () => {
  const meta = { due: null, start: null, done: null, rec: null, until: null, times: null, priority: null, assignees: [], tags: [], backlog: null };
  const waiting: Task = { path: "Plan.md", title: "Plan", line: 2, text: "Learn the cello backlog:2026-09-01", summary: "Learn the cello", done: false, heading: null, meta: { ...meta, backlog: "2026-09-01" } };
  const saved: unknown[] = [];
  let reloads = 0;
  api.updateTask = async (t, patch) => (saved.push(patch), { path: t.path, version: "2", line: t.line, text: "Learn the cello" });
  const row = taskRow(waiting, { open() {}, openTag() {}, openPerson() {}, reload: () => reloads++ }, null);
  document.body.replaceChildren(row);
  assert.match(row.querySelector(".tk-backlog")!.textContent!, /^Backlog · /);
  const back = row.querySelector<HTMLButtonElement>(".qt-back")!;
  assert.equal(back.textContent, "Bring back");
  back.click();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(saved, [{ backlog: null }]);
  assert.equal(waiting.meta.backlog, null);
  assert.equal(reloads, 1);
  assert.match(document.querySelector(".toast")?.textContent ?? "", /Back in your tasks: Learn the cello/);

  const open: Task = { ...waiting, text: "Ship it", summary: "Ship it", meta };
  const plain = taskRow(open, { open() {}, openTag() {}, openPerson() {}, reload() {} }, null);
  document.body.append(plain);
  assert.equal(plain.querySelector(".qt-back"), null);
  plain.querySelector<HTMLButtonElement>('.qt-act[aria-label="Task fields"]')!.click();
  const item = [...document.querySelectorAll<HTMLButtonElement>(".fp-item")].find((b) => b.textContent === "Move to the Backlog")!;
  item.click();
  await new Promise((r) => setTimeout(r, 0));
  assert.match(JSON.stringify(saved.at(-1)), /^\{"backlog":"\d{4}-\d{2}-\d{2}"\}$/);
  assert.equal(tokenChip("backlog", "2026-09-01").dataset.field, "backlog");
});

test("Settings reads the idle days and the tag the way people type them", () => {
  assert.deepEqual(["30", " 14 days ", "0", "off", "", "soon", "-3", "99999"].map(daysFrom), [30, 14, 0, 0, 0, null, null, null]);
  assert.deepEqual(["#dont-backlog", "keep", "#work/keep", "!!"].map(tagFrom), ["dont-backlog", "keep", "work/keep", null]);
});
