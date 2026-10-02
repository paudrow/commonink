import { test } from "node:test";
import assert from "node:assert/strict";
import { lastMonday, quiet, recapDue, recapLines, recapMarkdown, recapPath, weekRecap, type RecapChange } from "../web/src/weekRecap.ts";

const TZ = "UTC";
const at = (day: string, hour = 12) => Date.parse(`${day}T${String(hour).padStart(2, "0")}:00:00Z`);
const me = (who: string) => who === "you";
let id = 0;
const change = (day: string, path: string, op = "edit", o: Partial<RecapChange> = {}): RecapChange => ({
  path,
  op,
  note_id: `n-${path}`,
  person: "you",
  source: "you",
  agent: null,
  ...o,
  ts: o.ts ?? at(day) + id++, // a moment apart, in the order written
});
const task = (done: string | null) => ({ done: !!done, meta: { done } });
// Thursday 2026-10-01: last week is Monday 2026-09-21 to Sunday 2026-09-27.
const TODAY = "2026-10-01";
const LAST = "2026-09-21";

test("last week starts the Monday before this week's, from any day of the week", () => {
  assert.equal(lastMonday(TODAY), LAST);
  assert.equal(lastMonday("2026-09-28"), LAST, "Monday");
  assert.equal(lastMonday("2026-10-04"), LAST, "Sunday");
  assert.equal(lastMonday("2026-01-01"), "2025-12-22", "across a year");
});

test("last week's recap shows once a week, until it's saved or dismissed, and not for a quiet week", () => {
  const busy = weekRecap([change(LAST, "A.md")], [], LAST, me, TZ);
  assert.equal(recapDue(TODAY, "", busy), true);
  assert.equal(recapDue(TODAY, "2026-09-28", busy), false, "dismissed this week");
  assert.equal(recapDue("2026-10-04", "2026-09-28", busy), false, "still this week on Sunday");
  assert.equal(recapDue("2026-10-05", "2026-09-28", busy), true, "a new week");
  assert.equal(recapDue(TODAY, "", weekRecap([], [], LAST, me, TZ)), false, "nothing to recap");
});

test("counts your writing days, notes made and edited, ticks, and agents' edits for you, in that week only", () => {
  const r = weekRecap(
    [
      change("2026-09-21", "A.md", "create"),
      change("2026-09-21", "A.md"), // made then edited: counted as made
      change("2026-09-22", "B.md"),
      change("2026-09-23", "B.md"),
      change("2026-09-23", "C.md"),
      change("2026-09-23", "D.md", "move"), // not writing
      change("2026-09-24", "E.md", "edit", { person: "sam", source: "sam" }), // someone else
      change("2026-09-24", "F.md", "edit", { agent: "Claude" }),
      change("2026-09-25", "F.md", "create", { agent: "Claude" }),
      change("2026-09-25", "G.md", "edit", { agent: "Claude", person: "sam" }), // an agent for someone else
      change("2026-09-28", "H.md"), // this week
      change("2026-09-20", "I.md"), // the week before
    ],
    [task("2026-09-22"), task("2026-09-27"), task("2026-09-28"), task(null), { done: false, meta: { done: "2026-09-22" } }],
    LAST,
    me,
    TZ,
  );
  assert.equal(r.from, "2026-09-21");
  assert.equal(r.to, "2026-09-27");
  assert.equal(r.wrote, 3, "the 21st, 22nd and 23rd; agents' days don't count");
  assert.equal(r.created, 1);
  assert.equal(r.edited, 2, "B and C");
  assert.equal(r.ticked, 2);
  assert.equal(r.agentEdits, 2);
  assert.deepEqual(r.busiest, { day: "2026-09-21", changes: 2 }, "the 21st and 23rd tie: the earlier wins");
  assert.deepEqual(r.revisited, { path: "B.md", days: 2 });
});

test("the note you came back to needs two days", () => {
  const r = weekRecap([change("2026-09-22", "A.md"), change("2026-09-24", "B.md")], [], LAST, me, TZ);
  assert.deepEqual(r.busiest, { day: "2026-09-22", changes: 1 });
  assert.equal(r.revisited, null);
});

test("the note you came back to is the one on the most days, under its latest name", () => {
  const r = weekRecap(
    [
      change("2026-09-21", "Old.md", "edit", { note_id: "x" }),
      change("2026-09-23", "Old.md", "edit", { note_id: "x" }),
      change("2026-09-25", "Folder/New.md", "edit", { note_id: "x" }),
      change("2026-09-21", "Y.md"),
      change("2026-09-22", "Y.md"),
    ],
    [],
    LAST,
    me,
    TZ,
  );
  assert.deepEqual(r.revisited, { path: "Folder/New.md", days: 3 });
});

test("days are where you are: a late Sunday edit in New York is last week, not this", () => {
  const sundayNight = change("2026-09-28", "A.md", "edit", { ts: Date.parse("2026-09-28T03:00:00Z") }); // 11pm Sunday in New York
  assert.equal(weekRecap([sundayNight], [], LAST, me, "America/New_York").busiest?.day, "2026-09-27");
  assert.equal(weekRecap([sundayNight], [], LAST, me, "UTC").wrote, 0);
  assert.equal(weekRecap([sundayNight], [], "2026-09-28", me, "UTC").wrote, 1, "this week's, in UTC");
});

test("a week of only moves, archiving and ticks from other weeks is quiet", () => {
  assert.equal(quiet(weekRecap([], [], LAST, me, TZ)), true);
  assert.equal(quiet(weekRecap([change("2026-09-23", "A.md", "archive")], [task("2026-09-28")], LAST, me, TZ)), true);
  assert.equal(quiet(weekRecap([], [task("2026-09-27")], LAST, me, TZ)), false);
});

test("the lines and the saved note say it in words, leaving out what's zero but the days you wrote", () => {
  const r = weekRecap([change("2026-09-21", "Notes/Plan.md"), change("2026-09-22", "Notes/Plan.md")], [task("2026-09-22")], LAST, me, TZ);
  assert.deepEqual(recapLines(r), ["You wrote on 2 of 7 days", "1 note edited", "1 task ticked off", "Busiest day: Monday, with 1 change"]);
  assert.equal(recapPath(r), "Journal/Week of 2026-09-21.md");
  assert.equal(
    recapMarkdown(r),
    "# Week of 2026-09-21\n\n2026-09-21 to 2026-09-27\n\n- You wrote on 2 of 7 days\n- 1 note edited\n- 1 task ticked off\n- Busiest day: Monday, with 1 change\n- Came back to most: [[Plan]], on 2 days\n",
  );
  assert.deepEqual(recapLines(weekRecap([], [task("2026-09-22"), task("2026-09-23")], LAST, me, TZ)), ["You wrote on 0 of 7 days", "2 tasks ticked off"]);
  const both = weekRecap([change("2026-09-21", "A.md", "create"), change("2026-09-21", "B.md")], [], LAST, me, TZ);
  assert.equal(recapLines(both)[1], "1 note created, 1 more edited");
});
