import { test } from "node:test";
import assert from "node:assert/strict";
import { CHEERS, cheer, openToday, shouldCelebrate } from "../web/src/todayDone.ts";
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
