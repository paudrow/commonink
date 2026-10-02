import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays, dateFilter, dayFrom, dueFilter, editTask, editTaskLines, parseTask, patchProblem, priorityFilter, skipPatch, todaySection, withTasksAdded } from "../src/core/tasks.ts";
import { recLabel } from "../src/core/recurrence.ts";
import { openTempVault } from "./helpers.ts";

test("a note with Windows line endings has its tasks and outline, and keeps its line endings when they change", () => {
  const crlf = (s: string) => s.replace(/\n/g, "\r\n");
  const { vault } = openTempVault({ "Win.md": crlf("# Windows\n\n## Tasks\n\n- [ ] Ship it due:2026-10-01\n- [ ] Water plants due:2026-09-29 rec:weekly\n\n## Log\n") });
  assert.deepEqual(vault.tasks().map((t) => [t.line, t.text, t.heading]), [
    [5, "Ship it due:2026-10-01", "Tasks"],
    [6, "Water plants due:2026-09-29 rec:weekly", "Tasks"],
  ]);
  assert.deepEqual(vault.outline("Win").map((h) => h.text), ["Windows", "Tasks", "Log"]);
  vault.setTask("Win", 6, "Water plants due:2026-09-29 rec:weekly", true, "t", "2026-09-29");
  vault.addTask("Call the plumber tomorrow → [[Win]]", "t", { today: "2026-09-29" });
  assert.equal(
    vault.read("Win").content,
    crlf("# Windows\n\n## Tasks\n\n- [ ] Ship it due:2026-10-01\n- [x] Water plants due:2026-09-29 rec:weekly done:2026-09-29\n- [ ] Water plants due:2026-10-06 rec:weekly\n- [ ] Call the plumber due:2026-09-30\n\n## Log\n"),
  );
});

const LINE = "- [ ] Send invoice to Acme due:2026-10-01 rec:monthly #work/clients @jane !high";

test("a task line's tokens become its metadata, and its text without the trailing ones is its summary", () => {
  assert.deepEqual(parseTask(LINE), {
    done: false,
    text: "Send invoice to Acme due:2026-10-01 rec:monthly #work/clients @jane !high",
    summary: "Send invoice to Acme",
    meta: { due: "2026-10-01", start: null, done: null, rec: "monthly", until: null, times: null, priority: "high", assignees: ["jane"], tags: ["work/clients"] },
  });
  assert.deepEqual(parseTask("  * [x] Renew passport done:2026-09-20 scheduled:2026-09-01T09:30")?.meta, {
    due: null, start: "2026-09-01T09:30", done: "2026-09-20", rec: null, until: null, times: null, priority: null, assignees: [], tags: [],
  });
  assert.equal(parseTask("Not a task due:2026-10-01"), null);
});

test("words that only look like tokens stay text", () => {
  const t = parseTask("- [ ] Email me@example.com about `due:2026-01-01` and !highlight, due:tomorrow, due:2026-13-40 #27")!;
  assert.deepEqual(t.meta, { due: null, start: null, done: null, rec: null, until: null, times: null, priority: null, assignees: [], tags: [] });
  assert.equal(t.summary, t.text);
});

test("a token mid-sentence counts but stays in the summary; only the trailing run is taken out", () => {
  const t = parseTask("- [ ] Ask @sam about the #launch plan !low")!;
  assert.deepEqual([t.summary, t.meta.assignees, t.meta.tags, t.meta.priority], ["Ask @sam about the #launch plan", ["sam"], ["launch"], "low"]);
});

test("editing one field rewrites only that token, and leaves every other byte alone", () => {
  assert.equal(editTask(LINE, { due: "2026-10-02" }), LINE.replace("due:2026-10-01", "due:2026-10-02"));
  assert.equal(editTask(LINE, { priority: null }), LINE.replace(" !high", ""));
  assert.equal(editTask(LINE, { priority: "low", assignees: ["jane", "sam"] }), LINE.replace("!high", "!low").replace("rec:monthly ", "rec:monthly @sam "));
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
  assert.equal(line, "- [ ] a @jane #work #home");
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

test("a new token goes in at its place in the order priority, due, start, repeat, person, tags, done", () => {
  assert.equal(editTask("- [ ] Call due:2026-10-01 @jane #work", { priority: "high" }), "- [ ] Call !high due:2026-10-01 @jane #work");
  assert.equal(editTask("- [ ] Call !high @jane", { due: "2026-10-01", rec: "weekly" }), "- [ ] Call !high due:2026-10-01 rec:weekly @jane");
  assert.equal(editTask("- [ ] Call #work", { assignees: ["jane"] }), "- [ ] Call @jane #work");
  // Only the trailing tokens place a new one: a mid-sentence @sam isn't an anchor.
  assert.equal(editTask("- [ ] Ask @sam about it #launch", { due: "2026-10-01" }), "- [ ] Ask @sam about it due:2026-10-01 #launch");
});

test("each chip editor's change round-trips through the one writer, leaving the rest of the line alone", () => {
  const line = "- [ ] Send invoice #work/clients rec:monthly @jane due:2026-10-01 !high ok";
  const read = (l: string) => parseTask(l)!.meta;
  // Priority menu: High, Normal (no token), Low.
  assert.equal(editTask(line, { priority: "low" }), line.replace("!high", "!low"));
  assert.equal(editTask(line, { priority: null }), line.replace(" !high", ""));
  // Due: a quick pick rewrites the date in place; Clear takes it out.
  const nextWeek = editTask(line, { due: addDays("2026-09-28", 7) });
  assert.deepEqual([nextWeek, read(nextWeek).due], [line.replace("due:2026-10-01", "due:2026-10-05"), "2026-10-05"]);
  assert.equal(editTask(line, { due: null }), line.replace(" due:2026-10-01", ""));
  // Repeat: every N day/week/month/year.
  const everyTwo = editTask(line, { rec: "2w" });
  assert.deepEqual([everyTwo, read(everyTwo).rec], [line.replace("rec:monthly", "rec:2w"), "2w"]);
  assert.equal(editTask(line, { rec: "yearly" }), line.replace("rec:monthly", "rec:yearly"));
  assert.equal(editTask(line, { rec: null }), line.replace(" rec:monthly", ""));
  // Person: picking someone else swaps them in place; Remove takes them out.
  assert.equal(editTask(line, { assignees: ["sam"] }), line.replace("@jane", "@sam"));
  assert.equal(editTask("- [ ] a @jane @ana b", { assignees: ["sam", "ana"] }), "- [ ] a @sam @ana b");
  assert.equal(editTask(line, { assignees: [] }), line.replace(" @jane", ""));
});

test("a repeat's chip label says what it does, and a value it can't read shows as written", () => {
  assert.deepEqual(["weekly", "2w", "1st-tue,3rd-tue", "weekdays"].map(recLabel), ["Weekly", "Every 2 weeks", "1st & 3rd Tue", "weekdays"]);
  assert.equal(parseTask("- [ ] a rec:weekdays")!.meta.rec, null); // not a rule: plain text
  assert.equal(parseTask("- [ ] a rec:RRULE:FREQ=MONTHLY;BYDAY=1TU,3TU")!.meta.rec, "RRULE:FREQ=MONTHLY;BYDAY=1TU,3TU");
});

test("ticking a repeating task marks it done and puts the next one right below; unticking takes it back", () => {
  const bill = ["# Bills", "- [ ] Pay rent due:2026-10-06 start:2026-10-01 rec:6th @jane #home", "- [ ] Other"];
  const ticked = editTaskLines(bill, 1, { checked: true }, "2026-10-04");
  assert.deepEqual(ticked, [
    "# Bills",
    "- [x] Pay rent due:2026-10-06 start:2026-10-01 rec:6th @jane #home done:2026-10-04",
    "- [ ] Pay rent due:2026-11-06 start:2026-11-01 rec:6th @jane #home",
    "- [ ] Other",
  ]);
  assert.deepEqual(editTaskLines(ticked, 1, { checked: false }, "2026-10-05"), bill);

  const dog = ["  - [ ] Dog medicine due:2026-10-01 rec:after-1m"];
  assert.deepEqual(editTaskLines(dog, 0, { checked: true }, "2026-10-08"), ["  - [x] Dog medicine due:2026-10-01 rec:after-1m done:2026-10-08", "  - [ ] Dog medicine due:2026-11-08 rec:after-1m"]);
  // No due date yet: the next one counts from the day it's done.
  assert.deepEqual(editTaskLines(["- [ ] Water plants rec:weekly"], 0, { checked: true }, "2026-10-08")[1], "- [ ] Water plants due:2026-10-15 rec:weekly");
  // A plain task ticks as before; an untick with the next line already changed leaves it alone.
  assert.deepEqual(editTaskLines(["- [ ] Once"], 0, { checked: true }, "2026-10-08"), ["- [x] Once done:2026-10-08"]);
  const edited = [...ticked.slice(0, 2), ticked[2] + " !high", ticked[3]];
  assert.equal(editTaskLines(edited, 1, { checked: false }, "2026-10-05").length, 4);
});

test("skipping moves a repeating task to its next date without completing it", () => {
  assert.deepEqual(skipPatch(parseTask("- [ ] Standup due:2026-10-06 rec:1st-tue,3rd-tue")!.meta, "2026-10-01"), { due: "2026-10-20" });
  assert.deepEqual(skipPatch(parseTask("- [ ] Pills due:2026-10-06 start:2026-10-05 rec:after-1w")!.meta, "2026-10-01"), { due: "2026-10-13", start: "2026-10-12" });
  assert.equal(skipPatch(parseTask("- [ ] Once due:2026-10-06")!.meta, "2026-10-01"), null);
});

test("ticking a repeating task late puts the next one on or after today, not in the past", () => {
  const tick = (line: string, day: string) => editTaskLines([line], 0, { checked: true }, day)[1] ?? null;
  assert.equal(tick("- [ ] a due:2026-01-15 rec:weekly", "2026-03-01"), "- [ ] a due:2026-03-05 rec:weekly");
  assert.equal(tick("- [ ] Stretch due:2026-09-16 start:2026-09-15 rec:daily", "2026-09-30"), "- [ ] Stretch due:2026-09-30 start:2026-09-29 rec:daily");
  // One tick uses one of times:, however many dates it passed; until: still ends it.
  assert.equal(tick("- [ ] a due:2026-01-15 rec:weekly times:3", "2026-03-01"), "- [ ] a due:2026-03-05 rec:weekly times:2");
  assert.equal(tick("- [ ] a due:2026-01-15 rec:weekly until:2026-02-28", "2026-03-01"), null);
  // Unticking straight after still takes it back.
  const lines = editTaskLines(["- [ ] a due:2026-01-15 rec:weekly"], 0, { checked: true }, "2026-03-01");
  assert.deepEqual(editTaskLines(lines, 0, { checked: false }, "2026-03-01"), ["- [ ] a due:2026-01-15 rec:weekly"]);
  // Skipping an overdue one lands on or after today too.
  assert.deepEqual(skipPatch(parseTask("- [ ] a due:2026-01-15 rec:weekly")!.meta, "2026-03-01"), { due: "2026-03-05" });
  assert.deepEqual(skipPatch(parseTask("- [ ] Pills due:2026-01-01 rec:after-1w")!.meta, "2026-03-01"), { due: "2026-03-05" });
});

test("editing a task's text rewrites only the words before its tokens, never the tokens", () => {
  const line = "  - [ ] Send invoice to Acme due:2026-10-01 rec:monthly #work/clients @jane !high";
  assert.equal(editTask(line, { summary: "Send the Q4 invoice" }), "  - [ ] Send the Q4 invoice due:2026-10-01 rec:monthly #work/clients @jane !high");
  // Mid-sentence tokens are part of the text; a task with no text gets some; spaces at either end go.
  assert.equal(editTask("- [x] Ask @sam about it due:2026-10-01 done:2026-10-02", { summary: "Ask @ana about it" }), "- [x] Ask @ana about it due:2026-10-01 done:2026-10-02");
  assert.equal(editTask("- [ ] due:2026-10-01", { summary: "  Call mom " }), "- [ ] Call mom due:2026-10-01");
  assert.equal(editTask("- [ ] Plain", { summary: "Plainer" }), "- [ ] Plainer");
  assert.equal(editTask("- [ ] Plain  ", { summary: "Plain" }), "- [ ] Plain  ");
  // Text and a token in one patch: both land, the token in its place.
  assert.equal(editTask("- [ ] a @jane", { summary: "b", priority: "high" }), "- [ ] b !high @jane");
  assert.equal(patchProblem({ summary: "two\nlines" }), "A task's text is one line");
});

test("a task added to a note goes at the end of its Tasks section, or at the end of the note", () => {
  const add = (content: string, heading = false) => withTasksAdded(content, ["- [ ] New"], heading).content;
  assert.equal(add("# Day\n\n## Tasks\n\n- [ ] Old\n\n## Log\n\n- 09:00 hi\n"), "# Day\n\n## Tasks\n\n- [ ] Old\n- [ ] New\n\n## Log\n\n- 09:00 hi\n");
  assert.equal(add("# Day\n\n## tasks\n\n## Log\n"), "# Day\n\n## tasks\n\n- [ ] New\n\n## Log\n");
  assert.equal(add("# Day\n\n## Tasks\n- [ ] Old\n  - [ ] Sub"), "# Day\n\n## Tasks\n- [ ] Old\n  - [ ] Sub\n- [ ] New\n");
  // No Tasks section: a journal note gets one; any other note gets the task at its end.
  assert.equal(add("# Day\n\n## Log\n\n- 09:00 hi\n", true), "# Day\n\n## Log\n\n- 09:00 hi\n\n## Tasks\n\n- [ ] New\n");
  assert.equal(add("# Launch\n\nNotes.\n"), "# Launch\n\nNotes.\n\n- [ ] New\n");
  assert.equal(add("# Launch\n\n- [ ] Old\n"), "# Launch\n\n- [ ] Old\n- [ ] New\n");
  // A heading inside fenced code isn't the section.
  assert.equal(add("# N\n\n```\n## Tasks\n```\n"), "# N\n\n```\n## Tasks\n```\n\n- [ ] New\n");
});

test("a task added to a note goes above its footer: a closing --- rule, or its footnotes", () => {
  const add = (content: string, heading = false) => withTasksAdded(content, ["- [ ] New"], heading);
  const footer = "# Launch\n\n- [ ] Old\n\n---\n\nSource: Things export · [[Index]]\n";
  assert.deepEqual(add(footer), { content: "# Launch\n\n- [ ] Old\n- [ ] New\n\n---\n\nSource: Things export · [[Index]]\n", line: 4 });
  assert.equal(add("# Launch\n\nNotes.\n\n***\n_Imported_\n").content, "# Launch\n\nNotes.\n\n- [ ] New\n\n***\n_Imported_\n");
  // In the Tasks section when it runs into the footer, and a daily note's new section goes above it too.
  assert.equal(add("# N\n\n## Tasks\n\n- [ ] Old\n\n---\nfooter\n").content, "# N\n\n## Tasks\n\n- [ ] Old\n- [ ] New\n\n---\nfooter\n");
  assert.equal(add("# Day\n\n---\nfooter\n", true).content, "# Day\n\n## Tasks\n\n- [ ] New\n\n---\nfooter\n");
  assert.equal(add("# N\n\nSee this.[^1]\n\n[^1]: A source,\n    on two lines.\n").content, "# N\n\nSee this.[^1]\n\n- [ ] New\n\n[^1]: A source,\n    on two lines.\n");
  // Not a footer: a rule with a section after it, a heading's underline, frontmatter, or a rule in code.
  assert.equal(add("# N\n\n---\n\n## More\n\ntext\n").content, "# N\n\n---\n\n## More\n\ntext\n\n- [ ] New\n");
  assert.equal(add("# N\n\nTitle\n---\ntext\n").content, "# N\n\nTitle\n---\ntext\n\n- [ ] New\n");
  assert.equal(add("---\ntags: [a]\n---\n# N\n").content, "---\ntags: [a]\n---\n# N\n\n- [ ] New\n");
  assert.equal(add("# N\n\n```\n\n---\nx\n```\n").content, "# N\n\n```\n\n---\nx\n```\n\n- [ ] New\n");
});

test("@ names a person only when a letter follows it: @3pm stays a word, and \\@home is escaped", () => {
  assert.deepEqual(parseTask("- [ ] Call the bank @3pm @2x")!.meta.assignees, []);
  assert.deepEqual(parseTask("- [ ] Pack bag \\@home")!.meta.assignees, []);
  assert.deepEqual(parseTask("- [ ] Ask @jane, then @sam_2 @_bot")!.meta.assignees, ["jane", "sam_2", "_bot"]);
  assert.equal(editTask("- [ ] Call @3pm", { assignees: ["jane"] }), "- [ ] Call @3pm @jane");
});

test("a task is in one Today section at most: overdue, then due today, then starting today", () => {
  const at = (line: string) => todaySection(parseTask(line)!.meta, "2026-09-28");
  assert.deepEqual(
    ["- [ ] a due:2026-09-27", "- [ ] a due:2026-09-28T09:00", "- [ ] a start:2026-09-28", "- [ ] a start:2026-09-28 due:2026-09-20", "- [ ] a start:2026-09-28 due:2026-10-01", "- [ ] a due:2026-09-29", "- [ ] a"].map(at),
    ["overdue", "due", "starting", "overdue", "starting", null, null],
  );
});

test("until: and times: are tokens next to rec:, and anything else that looks like them stays text", () => {
  const t = parseTask("- [ ] Pay the loan due:2026-10-06 rec:6th times:3 until:2027-06-30 #bills")!;
  assert.deepEqual([t.meta.times, t.meta.until, t.summary], [3, "2027-06-30", "Pay the loan"]);
  assert.deepEqual([parseTask("- [ ] a times:0 until:someday")!.meta.times, parseTask("- [ ] a times:0 until:someday")!.meta.until], [null, null]);
  // They go in right after the repeat, and come out like any token.
  assert.equal(editTask("- [ ] Pay due:2026-10-06 rec:6th #bills", { times: 3 }), "- [ ] Pay due:2026-10-06 rec:6th times:3 #bills");
  assert.equal(editTask("- [ ] Pay due:2026-10-06 rec:6th #bills", { until: "2027-06-30", times: 3 }), "- [ ] Pay due:2026-10-06 rec:6th until:2027-06-30 times:3 #bills");
  assert.equal(editTask("- [ ] Pay rec:6th times:3 until:2027-06-30", { times: null, until: null }), "- [ ] Pay rec:6th");
  assert.equal(patchProblem({ times: 0 }), '"times" must be a whole number of repeats left, 1 or more');
  assert.equal(patchProblem({ until: "June" }), '"until" must be a date like 2026-10-01, not "June"');
});

test("times: counts down on every tick, and the last one makes no next occurrence", () => {
  let lines = ["- [ ] Pay the loan due:2026-10-06 rec:6th times:3"];
  const tick = (i: number, day: string) => (lines = editTaskLines(lines, i, { checked: true }, day));
  tick(0, "2026-10-06");
  assert.equal(lines[1], "- [ ] Pay the loan due:2026-11-06 rec:6th times:2");
  tick(1, "2026-11-06");
  assert.equal(lines[2], "- [ ] Pay the loan due:2026-12-06 rec:6th times:1");
  tick(2, "2026-12-06");
  assert.deepEqual(lines, [
    "- [x] Pay the loan due:2026-10-06 rec:6th times:3 done:2026-10-06",
    "- [x] Pay the loan due:2026-11-06 rec:6th times:2 done:2026-11-06",
    "- [x] Pay the loan due:2026-12-06 rec:6th times:1 done:2026-12-06", // the last: it stays as it was, ticked
  ]);
  // Unticking straight after still takes the next one back.
  const one = editTaskLines(["- [ ] a due:2026-10-06 rec:weekly times:2"], 0, { checked: true }, "2026-10-06");
  assert.deepEqual(editTaskLines(one, 0, { checked: false }, "2026-10-06"), ["- [ ] a due:2026-10-06 rec:weekly times:2"]);
});

test("until: keeps an occurrence on that day and none after it; with times: too, whichever ends first wins", () => {
  const next = (line: string, day = "2026-10-06") => editTaskLines([line], 0, { checked: true }, day)[1] ?? null;
  assert.equal(next("- [ ] Class due:2026-10-06 rec:6th until:2026-11-06"), "- [ ] Class due:2026-11-06 rec:6th until:2026-11-06");
  assert.equal(next("- [ ] Class due:2026-11-06 rec:6th until:2026-11-06", "2026-11-06"), null);
  assert.equal(next("- [ ] Class due:2026-10-06 rec:6th until:2026-11-05"), null);
  assert.equal(next("- [ ] Class due:2026-10-06 rec:6th times:5 until:2026-11-06"), "- [ ] Class due:2026-11-06 rec:6th times:4 until:2026-11-06");
  assert.equal(next("- [ ] Class due:2026-10-06 rec:6th times:1 until:2027-01-01"), null);
  // Month ends: monthly from Jan 31 skips February, and Mar 31 is still in.
  assert.equal(next("- [ ] Rent due:2026-01-31 rec:monthly until:2026-03-31", "2026-01-31"), "- [ ] Rent due:2026-03-31 rec:monthly until:2026-03-31");
  // after- repeats end too.
  assert.equal(next("- [ ] Pill due:2026-10-06 rec:after-1m until:2026-11-01", "2026-10-06"), null);
});

test("an RRULE's COUNT and UNTIL end it the same way; COUNT counts down in the rule", () => {
  const next = (line: string, day: string) => editTaskLines([line], 0, { checked: true }, day)[1] ?? null;
  assert.equal(next("- [ ] Sync due:2026-10-01 rec:RRULE:FREQ=WEEKLY;COUNT=2", "2026-10-01"), "- [ ] Sync due:2026-10-08 rec:RRULE:FREQ=WEEKLY;COUNT=1");
  assert.equal(next("- [ ] Sync due:2026-10-08 rec:RRULE:FREQ=WEEKLY;COUNT=1", "2026-10-08"), null);
  assert.equal(next("- [ ] Sync due:2026-10-08 rec:RRULE:FREQ=WEEKLY;UNTIL=20261015", "2026-10-08"), "- [ ] Sync due:2026-10-15 rec:RRULE:FREQ=WEEKLY;UNTIL=20261015");
  assert.equal(next("- [ ] Sync due:2026-10-15 rec:RRULE:FREQ=WEEKLY;UNTIL=20261015T235959Z", "2026-10-15"), null);
});

test("skipping a counted repeat uses one up; the last one, or one past until:, can't be skipped", () => {
  const skip = (line: string) => skipPatch(parseTask(line)!.meta, "2026-10-01");
  assert.deepEqual(skip("- [ ] a due:2026-10-06 rec:6th times:3"), { due: "2026-11-06", times: 2 });
  assert.equal(skip("- [ ] a due:2026-10-06 rec:6th times:1"), null);
  assert.equal(skip("- [ ] a due:2026-10-06 rec:6th until:2026-11-01"), null);
  assert.deepEqual(skip("- [ ] a due:2026-10-06 rec:6th until:2026-11-06"), { due: "2026-11-06" });
  assert.deepEqual(skip("- [ ] a due:2026-10-06 rec:RRULE:FREQ=MONTHLY;BYMONTHDAY=6;COUNT=3"), { due: "2026-11-06", rec: "RRULE:FREQ=MONTHLY;BYMONTHDAY=6;COUNT=2" });
});

test("a due filter compares dates, with today, tomorrow and yesterday relative to the day given", () => {
  const due = (expr: string, d: string | null) => dueFilter(expr, "2026-10-01")!(d);
  assert.deepEqual(["2026-09-30", "2026-10-01", "2026-10-01T18:00", "2026-10-02", null].map((d) => due("<=today", d)), [true, true, true, false, false]);
  assert.deepEqual(["2026-10-01", "2026-10-02"].map((d) => due("tomorrow", d)), [false, true]);
  assert.deepEqual(["2026-09-29", "2026-09-30"].map((d) => due(">yesterday", d)), [false, false]);
  assert.equal(due(">=2026-09-01", "2026-09-01"), true);
  assert.deepEqual(["soon", "<=2026-02-31x", "2026-13-01"].map((e) => dueFilter(e, "2026-10-01")), [null, null, null]);
});

test("a date filter takes spans from today and ranges of two comparisons", () => {
  const passes = (expr: string, d: string | null) => dateFilter(expr, "2026-10-01")!(d);
  // The coming week, today included.
  assert.deepEqual(["2026-09-30", "2026-10-01", "2026-10-08", "2026-10-09", null].map((d) => passes(">=today <=+7d", d)), [false, true, true, false, false]);
  assert.deepEqual(["2026-09-24", "2026-09-23"].map((d) => passes(">=-7d", d)), [true, false]);
  assert.equal(passes(">= today, <= +1w", "2026-10-08"), true);
  assert.equal(passes("-2w", "2026-09-17"), true);
  assert.equal(passes("+1y", "2027-10-01"), true);
  assert.deepEqual([dayFrom("+1m", "2026-01-31"), dayFrom("-1m", "2026-03-31"), dayFrom("+13m", "2026-12-15"), dayFrom("+1M", "2026-10-01")], ["2026-02-28", "2026-02-28", "2028-01-15", "2026-11-01"]);
  assert.deepEqual(["+7", "7d", "+7x", ">=today <=soon", ""].map((e) => dateFilter(e, "2026-10-01")), [null, null, null, null, null]);
});

test("a priority filter takes high, low or none, several with commas, and the token's own spelling", () => {
  const passes = (expr: string) => (["high", "low", null] as const).map((p) => priorityFilter(expr)!(p));
  assert.deepEqual(passes("high"), [true, false, false]);
  assert.deepEqual(passes("!high"), [true, false, false]);
  assert.deepEqual(passes("high,none"), [true, false, true]);
  assert.deepEqual(passes("NONE"), [false, false, true]);
  assert.deepEqual(["urgent", "", "high,soon"].map(priorityFilter), [null, null, null]);
});

test("a task that moved is found among the note's tasks, never in a code block's example of one", () => {
  const { vault } = openTempVault({ "N.md": "# N\nintro\n```md\n- [ ] Buy milk\n```\n- [ ] Buy milk\n" });
  // The list said line 5 before "intro" went in above; line 5 is now the fence's closing line.
  vault.updateTask("N", 5, "Buy milk", { checked: true }, "test", "2026-10-02");
  assert.equal(vault.read("N").content, "# N\nintro\n```md\n- [ ] Buy milk\n```\n- [x] Buy milk done:2026-10-02\n");
  // The one in the fence is an example, even when asked for by its own line.
  assert.throws(() => vault.updateTask("N", 4, "Buy milk", { checked: true }, "test", "2026-10-02"), /any more/);
});
