// Whether a tick just cleared Today, kept apart from the page so it can be tested on its own (the
// burst and the toast are in todayCleared.ts).
import type { TodayView } from "./api.ts";

/** How many open tasks Today lists: overdue, due today and starting today. */
export const openToday = (v: TodayView) => v.sections.reduce((n, s) => n + s.tasks.length, 0);

/**
 * Celebrate only when your tick took Today from something to nothing, and not twice in a day.
 * `before` is null when it couldn't be read; `last` is the day this browser last celebrated.
 */
export function shouldCelebrate(before: number | null, after: number, day: string, last: string): boolean {
  return before !== null && before >= 1 && after === 0 && last !== day;
}

/** The toast's second line, a different one now and then. */
export const CHEERS = ["Nice work.", "That's the list.", "Go enjoy the rest of your day.", "Well earned."];
export const cheer = (r = Math.random()) => CHEERS[Math.min(CHEERS.length - 1, Math.floor(r * CHEERS.length))];

/** The Today ring's progress: what's ticked of what Today had (`total` 0 when Today had nothing). */
export interface TodayProgress {
  done: number;
  total: number;
  /** 0 to 1; 1 once Today is clear. */
  fraction: number;
  /** What a screen reader hears, and the tooltip. */
  label: string;
}

/** From the open count and how many of today's tasks were ticked today. */
export function todayProgress(open: number, done: number): TodayProgress {
  const [o, d] = [Math.max(0, open), Math.max(0, done)];
  const total = o + d;
  const fraction = total ? d / total : 0;
  const label = !total ? "Nothing on Today" : !o ? `All ${total} of today's tasks done` : `${d} of ${total} of today's tasks done`;
  return { done: d, total, fraction, label };
}
