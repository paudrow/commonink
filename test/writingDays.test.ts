// Your writing days: changes grouped by the calendar day where you are, the streak (which waits for
// you until tonight rather than breaking at 9am), and the 12 weeks the heatmap shows.
import { test } from "node:test";
import assert from "node:assert/strict";
import { countByDay, daysText, heatmapWeeks, inFolder, level, mondayOf, streakOf, streakTitle, thisWeek } from "../web/src/writingDays.ts";

const days = (...list: string[]) => new Map(list.map((d) => [d, 1]));

test("changes count toward the day they were made where you are, not the UTC day", () => {
  // 02:30 UTC on Oct 2 is still the evening of Oct 1 in New York, and already the morning in Tokyo.
  const ts = Date.UTC(2026, 9, 2, 2, 30);
  assert.deepEqual([...countByDay([ts], "America/New_York")], [["2026-10-01", 1]]);
  assert.deepEqual([...countByDay([ts], "Asia/Tokyo")], [["2026-10-02", 1]]);
  assert.deepEqual([...countByDay([ts, ts + 60_000, Date.UTC(2026, 9, 3, 15)], "UTC")], [["2026-10-02", 2], ["2026-10-03", 1]]);
});

test("a day a clock changes on is one day: no day is skipped or counted twice", () => {
  const zone = "America/New_York";
  // Spring forward (Mar 8, 2026, a 23-hour day) and fall back (Nov 1, 2026, a 25-hour day).
  const spring = countByDay([Date.UTC(2026, 2, 8, 5, 0), Date.UTC(2026, 2, 9, 3, 59)], zone); // 00:00 EST, 23:59 EDT
  assert.deepEqual([...spring], [["2026-03-08", 2]]);
  const fall = countByDay([Date.UTC(2026, 10, 1, 4, 0), Date.UTC(2026, 10, 2, 4, 59)], zone); // 00:00 EDT, 23:59 EST
  assert.deepEqual([...fall], [["2026-11-01", 2]]);
  assert.equal(streakOf(days("2026-03-07", "2026-03-08", "2026-03-09"), "2026-03-09").current, 3);
  assert.equal(streakOf(days("2026-10-31", "2026-11-01", "2026-11-02"), "2026-11-02").current, 3);
});

test("with no history there is no streak", () => {
  assert.deepEqual(streakOf(new Map(), "2026-10-01"), { current: 0, longest: 0, wroteToday: false });
});

test("the streak counts back from today, or from yesterday until you've written today", () => {
  const wrote = days("2026-09-28", "2026-09-29", "2026-09-30");
  assert.deepEqual(streakOf(wrote, "2026-10-01"), { current: 3, longest: 3, wroteToday: false });
  wrote.set("2026-10-01", 4);
  assert.deepEqual(streakOf(wrote, "2026-10-01"), { current: 4, longest: 4, wroteToday: true });
  // A whole day missed (yesterday) ends it.
  assert.equal(streakOf(days("2026-09-28", "2026-09-29"), "2026-10-01").current, 0);
});

test("a gap day splits runs, and the longest run is found wherever it is", () => {
  const wrote = days("2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-06", "2026-09-30", "2026-10-01");
  assert.deepEqual(streakOf(wrote, "2026-10-01"), { current: 2, longest: 4, wroteToday: true });
  // A day listed with no changes isn't a day written.
  wrote.set("2026-09-05", 0);
  assert.equal(streakOf(wrote, "2026-10-01").longest, 4);
});

test("the heatmap is 12 weeks of Monday to Sunday ending this week, with days to come left empty", () => {
  assert.equal(mondayOf("2026-10-01"), "2026-09-28"); // a Thursday
  assert.equal(mondayOf("2026-09-28"), "2026-09-28");
  assert.equal(mondayOf("2026-10-04"), "2026-09-28"); // a Sunday
  const weeks = heatmapWeeks("2026-10-01");
  assert.equal(weeks.length, 12);
  assert.ok(weeks.every((w) => w.length === 7));
  assert.equal(weeks[0][0], "2026-07-13");
  assert.deepEqual(weeks[11], ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", null, null, null]);
  // Across the fall-back weekend the days still run one after another.
  const fall = heatmapWeeks("2026-11-03").flat().filter(Boolean);
  assert.deepEqual(fall.slice(-4), ["2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03"]);
  assert.equal(new Set(fall).size, fall.length);
});

test("a day's square darkens with its changes, and counts read as words", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 7, 8, 40].map(level), [0, 1, 2, 2, 3, 3, 4, 4]);
  assert.equal(daysText(1), "1 day");
  assert.equal(daysText(3), "3 days");
});

test("this week counts the days you wrote since Monday, so a missed day lowers it by one", () => {
  const wrote = days("2026-09-27", "2026-09-28", "2026-09-30", "2026-10-01"); // Sunday, then Mon, Wed, Thu
  assert.equal(thisWeek(wrote, "2026-10-01"), 3);
  assert.equal(streakOf(wrote, "2026-10-01").current, 2, "Tuesday ended the run");
  assert.equal(thisWeek(wrote, "2026-09-28"), 1, "on Monday, only Monday");
  assert.equal(thisWeek(new Map(), "2026-10-01"), 0);
});

test("a folder filter counts notes in that folder or under it, archived ones toward where they came from", () => {
  assert.ok(inFolder("Journal/2026-10-01.md", "Journal"));
  assert.ok(inFolder("Journal/2026/Oct.md", "Journal/"));
  assert.ok(inFolder("Archive/Journal/2026-01-01.md", "Journal"));
  assert.ok(!inFolder("Journals/x.md", "Journal"), "a folder whose name starts the same isn't it");
  assert.ok(!inFolder("Journal.md", "Journal"));
  assert.ok(inFolder("anything.md", ""), "no folder is every note");
});

test("the header says what's counted", () => {
  assert.equal(streakTitle({}), "Writing days");
  assert.equal(streakTitle({ folder: "Journal/" }), "Writing days in Journal");
  assert.equal(streakTitle({ tag: "#work" }), "Writing days tagged #work");
  assert.equal(streakTitle({ folder: "Projects", tag: "work" }), "Writing days in Projects tagged #work");
});
