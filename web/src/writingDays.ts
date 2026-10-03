// "Your writing days": which days you wrote. Pure date math, so it can be tested without a browser:
// the Today page's week card (writingHeatmap.ts) draws what this works out. Days are calendar days
// where you are (localDate), and stepping from one to the next goes by date, not by 24 hours, so a clock change never skips or doubles a day.
import { addDays, localDate } from "../../src/core/tasks.ts";

/** How many weeks the heatmap shows. */
export const WEEKS = 12;

/** How many changes each day has, by YYYY-MM-DD in `timeZone` (this machine's zone by default). */
export function countByDay(times: number[], timeZone?: string): Map<string, number> {
  const days = new Map<string, number>();
  for (const ts of times) {
    const day = localDate(ts, timeZone);
    days.set(day, (days.get(day) ?? 0) + 1);
  }
  return days;
}

/** The Monday of `day`'s week (weeks start on Monday, as on the Calendar page). */
export function mondayOf(day: string): string {
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay(); // 0 is Sunday
  return addDays(day, -((weekday + 6) % 7));
}

/** The heatmap's days: `weeks` columns of Monday to Sunday, the last one this week. Days after today are null. */
export function heatmapWeeks(today: string, weeks = WEEKS): Array<Array<string | null>> {
  const first = addDays(mondayOf(today), -7 * (weeks - 1));
  return Array.from({ length: weeks }, (_, w) =>
    Array.from({ length: 7 }, (_, i) => {
      const d = addDays(first, 7 * w + i);
      return d <= today ? d : null;
    }),
  );
}

/** How dark a day's square is, 0 (nothing written) to 4, from how many changes it had. */
export const level = (n: number) => (n <= 0 ? 0 : n === 1 ? 1 : n <= 3 ? 2 : n <= 7 ? 3 : 4);

/** "1 day", "3 days". */
export const daysText = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;
