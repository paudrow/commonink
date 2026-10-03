import { test } from "node:test";
import assert from "node:assert/strict";
import { CHEERS, cheer, openToday, shouldCelebrate, todayProgress } from "../web/src/todayDone.ts";
import type { Task, TodayView } from "../web/src/api.ts";

const view = (...counts: number[]): TodayView => ({
  date: "2026-10-01",
  sections: (["overdue", "due", "starting"] as const).map((id, i) => ({ id, title: id, tasks: Array.from({ length: counts[i] ?? 0 }, () => ({}) as Task) })),
  journal: { path: "Journal/2026-10-01.md", exists: false },
});

test("Today's open count is every task it lists: overdue, due and starting today", () => {
  assert.equal(openToday(view(2, 1, 1)), 4);
  assert.equal(openToday(view()), 0);
});

test("a tick celebrates only when it takes Today from something to nothing, once a day", () => {
  const day = "2026-10-01";
  assert.equal(shouldCelebrate(1, 0, day, ""), true);
  assert.equal(shouldCelebrate(3, 0, day, "2026-09-30"), true);
  assert.equal(shouldCelebrate(2, 1, day, ""), false, "something is still left");
  assert.equal(shouldCelebrate(0, 0, day, ""), false, "Today was already empty");
  assert.equal(shouldCelebrate(null, 0, day, ""), false, "Today couldn't be read before the tick");
  assert.equal(shouldCelebrate(1, 0, day, day), false, "already celebrated today in this browser");
});

test("the toast's second line is always one of the cheers", () => {
  for (const r of [0, 0.3, 0.6, 0.999999, 1]) assert.ok(CHEERS.includes(cheer(r)));
  assert.equal(cheer(0), CHEERS[0]);
});

test("the Today ring fills with what's ticked of what Today had, and closes when it's clear", () => {
  assert.deepEqual(todayProgress(2, 3), { done: 3, total: 5, fraction: 0.6, label: "3 of 5 of today's tasks done" });
  assert.deepEqual(todayProgress(4, 0), { done: 0, total: 4, fraction: 0, label: "0 of 4 of today's tasks done" });
  assert.deepEqual(todayProgress(0, 2), { done: 2, total: 2, fraction: 1, label: "All 2 of today's tasks done" });
  assert.equal(todayProgress(0, 0).total, 0, "nothing on Today: no ring");
  assert.equal(todayProgress(0, 0).fraction, 0);
  assert.equal(todayProgress(-1, -1).total, 0, "a bad count isn't drawn as progress");
});
