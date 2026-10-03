// Your writing days: changes grouped by the calendar day where you are, and the 12 weeks the heatmap shows.
import { test } from "node:test";
import assert from "node:assert/strict";
import { countByDay, daysText, heatmapWeeks, level, mondayOf } from "../web/src/writingDays.ts";


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
