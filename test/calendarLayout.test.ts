// The calendar's date math (web/src/calendar/layout.ts), read in New York, where the clocks go back
// on 2026-11-01. The zone is set before the module loads, so every Date here is New York's.
process.env.TZ = "America/New_York";
import { test } from "node:test";
import assert from "node:assert/strict";

const L = await import("../web/src/calendar/layout.ts");

type Ev = { title: string; start: string; end: string; allDay: boolean };
const ev = (title: string, start: string, end: string, allDay = false): Ev => ({ title, start, end, allDay });
const span = (e: Ev) => L.spanOf(e);
const grid = (items: Ev[], day: string) => L.timeGrid(items, span, day).map((s) => [s.item.title, s.top, s.bottom, s.lane, s.lanes]);

test("a month is whole weeks from Monday: September 2026 runs from Mon Aug 31 to Sun Oct 4", () => {
  const weeks = L.monthWeeks("2026-09-15");
  assert.equal(weeks.length, 5);
  assert.deepEqual(weeks[0], ["2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05", "2026-09-06"]);
  assert.deepEqual(weeks[4], ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
  assert.deepEqual(L.monthWeeks("2027-02-10").map((w) => w[0]), ["2027-02-01", "2027-02-08", "2027-02-15", "2027-02-22"], "February 2027 starts on a Monday and fills four weeks");
});

test("stepping a month keeps the day of the month where the next month has it", () => {
  assert.equal(L.stepDay("month", "2026-01-31", 1), "2026-02-28");
  assert.equal(L.stepDay("month", "2026-03-15", -1), "2026-02-15");
  assert.equal(L.stepDay("agenda", "2026-09-29", 1), "2026-10-13");
});

test("events that start together sit side by side; one that starts inside another sits on it, indented; each widens into free lanes", () => {
  const items = [ev("A", "2026-09-29T09:00:00", "2026-09-29T10:00:00"), ev("B", "2026-09-29T09:30:00", "2026-09-29T11:00:00"), ev("C", "2026-09-29T09:45:00", "2026-09-29T10:15:00"), ev("D", "2026-09-29T10:30:00", "2026-09-29T11:30:00"), ev("Lunch", "2026-09-29T12:00:00", "2026-09-29T13:00:00")];
  const placed = L.timeGrid(items, span, "2026-09-29").map((s) => [s.item.title, s.top, s.bottom, s.lane, s.lanes, s.span, s.indent]);
  assert.deepEqual(placed, [
    ["A", 540, 600, 0, 2, 1, 0],
    ["B", 570, 660, 0, 2, 1, 1], // half an hour into A: on top of it
    ["C", 585, 615, 1, 2, 1, 0], // a quarter hour after B: beside it
    ["D", 630, 690, 0, 2, 2, 2], // inside B; C is over by then, so D takes the whole width
    ["Lunch", 720, 780, 0, 1, 1, 0],
  ]);
  const together = [ev("Standup", "2026-09-29T09:00:00", "2026-09-29T09:15:00"), ev("Review", "2026-09-29T09:00:00", "2026-09-29T10:00:00"), ev("Call", "2026-09-29T09:20:00", "2026-09-29T09:50:00")];
  assert.deepEqual(grid(together, "2026-09-29"), [
    ["Review", 540, 600, 0, 2],
    ["Standup", 540, 555, 1, 2],
    ["Call", 560, 590, 1, 2],
  ], "starting within half an hour of Review, Call goes beside it, in the lane Standup is done with");
});

test("in Month, a week's items are bars on rows, longest first, and a full day shows one fewer to make room for +N more", () => {
  const week = L.viewDays("week", "2026-09-30");
  const items = [
    ev("Standup", "2026-09-29T09:00:00", "2026-09-29T09:15:00"),
    ev("Offsite", "2026-09-29", "2026-10-02", true),
    ev("Lunch", "2026-09-29T12:00:00", "2026-09-29T13:00:00"),
    ev("Gym", "2026-09-28T07:00:00", "2026-09-28T08:00:00"),
  ];
  const rows = L.weekRows(items, span, week);
  assert.deepEqual(rows.map((b) => [b.item.title, b.from, b.to, b.row]), [
    ["Offsite", 1, 3, 0],
    ["Gym", 0, 0, 0],
    ["Standup", 1, 1, 1],
    ["Lunch", 1, 1, 2],
  ]);
  const fit = L.fitRows(rows, 2);
  assert.deepEqual(fit.shown.map((b) => b.item.title), ["Offsite", "Gym"]);
  assert.deepEqual(fit.hidden, [0, 2, 0, 0, 0, 0, 0]);
  assert.deepEqual(L.fitRows(rows, 3).hidden, [0, 0, 0, 0, 0, 0, 0]);
});

test("an all-day event over three days is a bar across those three columns of the week", () => {
  const week = L.viewDays("week", "2026-09-30");
  const offsite = ev("Offsite", "2026-09-28", "2026-10-01", true);
  const trip = ev("Trip", "2026-09-25", "2026-09-30", true);
  const standup = ev("Standup", "2026-09-29T13:00:00Z", "2026-09-29T13:15:00Z");
  const placed = L.bars([standup, offsite, trip], span, week).map((b) => [b.item.title, b.from, b.to, b.row, b.before, b.after]);
  assert.deepEqual(placed, [
    ["Trip", 0, 1, 0, true, false],
    ["Offsite", 0, 2, 1, false, false],
  ]);
  const days = L.bucket([standup, offsite], span, week);
  assert.deepEqual([...days].map(([d, list]) => `${d}:${list.map((e) => e.title).join("+")}`), [
    "2026-09-28:Offsite",
    "2026-09-29:Offsite+Standup",
    "2026-09-30:Offsite",
    "2026-10-01:",
    "2026-10-02:",
    "2026-10-03:",
    "2026-10-04:",
  ]);
});

test("a floating time is the reader's own clock time", () => {
  assert.deepEqual(grid([ev("Gym", "2026-09-29T07:30:00", "2026-09-29T08:15:00")], "2026-09-29"), [["Gym", 450, 495, 0, 1]]);
});

test("a UTC time late in the evening in New York is on the New York day, and one across midnight is on both days", () => {
  const late = ev("Late call", "2026-09-30T02:30:00Z", "2026-09-30T03:30:00Z"); // 22:30 to 23:30 on the 29th
  const night = ev("Deploy", "2026-09-30T03:30:00Z", "2026-09-30T05:00:00Z"); // 23:30 to 01:00
  const days = L.bucket([late, night], span, ["2026-09-29", "2026-09-30"]);
  assert.deepEqual([...days].map(([d, list]) => [d, list.map((e) => e.title)]), [
    ["2026-09-29", ["Late call", "Deploy"]],
    ["2026-09-30", ["Deploy"]],
  ]);
  assert.deepEqual(grid([late, night], "2026-09-29"), [["Late call", 1350, 1410, 0, 1], ["Deploy", 1410, 1440, 0, 1]]);
  assert.deepEqual(grid([late, night], "2026-09-30"), [["Deploy", 0, 60, 0, 1]]);
});

test("the week the clocks go back still has seven days, and times keep to the clock", () => {
  assert.deepEqual(L.viewDays("week", "2026-11-01"), ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"]);
  assert.equal(L.stepDay("week", "2026-11-01", 1), "2026-11-08");
  assert.equal(L.addDays("2026-11-01", 1), "2026-11-02");
  const range = L.daysRange(L.viewDays("week", "2026-11-01"));
  assert.deepEqual([range.from.toISOString(), range.to.toISOString()], ["2026-10-26T04:00:00.000Z", "2026-11-02T05:00:00.000Z"]);
  // 9:00 EST is 14:00 UTC after the change; 9:00 EDT was 13:00 UTC the day before.
  assert.deepEqual(grid([ev("Sunday", "2026-11-01T14:00:00Z", "2026-11-01T15:00:00Z")], "2026-11-01"), [["Sunday", 540, 600, 0, 1]]);
  assert.deepEqual(grid([ev("Saturday", "2026-10-31T13:00:00Z", "2026-10-31T14:00:00Z")], "2026-10-31"), [["Saturday", 540, 600, 0, 1]]);
});

test("a timed event a day or longer goes in the all-day row, not the grid", () => {
  const conf = ev("Conference", "2026-09-29T14:00:00Z", "2026-10-01T20:00:00Z");
  assert.deepEqual(grid([conf], "2026-09-30"), []);
  assert.deepEqual(L.bars([conf], span, ["2026-09-29", "2026-09-30", "2026-10-01"]).map((b) => [b.from, b.to, b.before, b.after]), [[0, 2, false, false]]);
});
