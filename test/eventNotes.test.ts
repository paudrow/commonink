import { test } from "node:test";
import assert from "node:assert/strict";
import { eventFromNote } from "../src/core/eventNotes.ts";

const times = (front: string) => {
  const ev = eventFromNote("Events/Call.md", `---\n${front}\n---\n# Call\n`);
  return ev && [ev.start, ev.end];
};

test("an end written with its own zone keeps it; one without takes the start's", () => {
  assert.deepEqual(times("start: 2026-10-05T10:00-05:00\nend: 2026-10-05T11:00-08:00"), ["2026-10-05T15:00:00Z", "2026-10-05T19:00:00Z"]);
  assert.deepEqual(times("start: 2026-10-05T10:00Z\nend: 2026-10-05T13:30+02:00"), ["2026-10-05T10:00:00Z", "2026-10-05T11:30:00Z"]);
  // Two hours at +02:00 is the start itself: no length, so an hour, as with no end.
  assert.deepEqual(times("start: 2026-10-05T10:00Z\nend: 2026-10-05T12:00+02:00"), ["2026-10-05T10:00:00Z", "2026-10-05T11:00:00Z"]);
  assert.deepEqual(times("start: 2026-10-05T10:00-05:00\nend: 2026-10-05T11:30"), ["2026-10-05T15:00:00Z", "2026-10-05T16:30:00Z"]);
  assert.deepEqual(times("start: 2026-10-05T10:00-05:00\nend: 11:30"), ["2026-10-05T15:00:00Z", "2026-10-05T16:30:00Z"]);
  // A floating start keeps its end floating, so the event isn't half on one clock and half on another.
  assert.deepEqual(times("start: 2026-10-05 10:00\nend: 2026-10-05T11:30-05:00"), ["2026-10-05T10:00:00", "2026-10-05T11:30:00"]);
});

test("a day that isn't on the calendar isn't a start or an end", () => {
  assert.equal(times("start: 2026-02-30"), null);
  assert.equal(times("start: 2026-02-30T10:00Z"), null);
  assert.equal(times("start: 2026-13-01"), null);
  assert.deepEqual(times("start: 2028-02-29"), ["2028-02-29", "2028-03-01"]);
  // An end that can't be read is left out: an hour, or the one day.
  assert.deepEqual(times("start: 2026-02-27T10:00Z\nend: 2026-02-30T10:00Z"), ["2026-02-27T10:00:00Z", "2026-02-27T11:00:00Z"]);
  assert.deepEqual(times("all_day: true\nstart: 2026-02-27\nend: 2026-02-30"), ["2026-02-27", "2026-02-28"]);
});
