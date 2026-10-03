// The calendar's date math, in the reader's time zone: which days a view shows, which day an event
// falls on, where it sits in a day's time grid, how overlapping ones share the width, and where a
// drag or a key moves one (in 15-minute steps, back in the server's form). No DOM.
//
// Event times come in three shapes (see CalendarEvent in src/core/calendar.ts): an instant in UTC
// ("…Z"), a floating wall time ("2026-09-29T09:00:00", the same clock time wherever you are) and an
// all-day date ("2026-09-29"). All three become local Dates here. Days are "YYYY-MM-DD" strings and
// move by calendar date, never by 24 hours, so a week across a clock change still has seven days.

export type Day = string;
export type View = "month" | "week" | "day" | "agenda";

/** Where an item sits in time, as local Dates; `end` is exclusive. */
export interface Span {
  start: Date;
  end: Date;
  allDay: boolean;
}

/** How many days Agenda lists at once, and moves by. */
export const AGENDA_DAYS = 14;
const MINUTE = 60_000;
const DAY_MINUTES = 24 * 60;

/** An event time as a local Date: an instant as itself, a floating time or a date on the reader's clock. */
export function parseTime(t: string): Date {
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) return new Date(t);
  const [, y, mo, d, h = "0", mi = "0", s = "0"] = m;
  return new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
}

/** An event's span. An end at or before its start is read as a moment (timed) or one day (all day). */
export function spanOf(ev: { start: string; end: string; allDay: boolean }): Span {
  const start = parseTime(ev.start);
  let end = parseTime(ev.end);
  if (ev.allDay && end <= start) end = dayStart(addDays(dayKey(start), 1));
  if (end < start) end = start;
  return { start, end, allDay: ev.allDay };
}

export const dayKey = (d: Date): Day => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Local midnight at the start of a day. */
export function dayStart(day: Day): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(day: Day, n: number): Day {
  const d = dayStart(day);
  return dayKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
}

/** The Monday on or before `day`: weeks start on Monday, like the ::calendar widget. */
export const weekStart = (day: Day): Day => addDays(day, -((dayStart(day).getDay() + 6) % 7));

/** The weeks a month view shows: Monday to Sunday, from the week of the 1st to the week of the last day. */
export function monthWeeks(day: Day): Day[][] {
  const d = dayStart(day);
  const first = dayKey(new Date(d.getFullYear(), d.getMonth(), 1));
  const last = dayKey(new Date(d.getFullYear(), d.getMonth() + 1, 0));
  const weeks: Day[][] = [];
  for (let w = weekStart(first); w <= last; w = addDays(w, 7)) weeks.push(Array.from({ length: 7 }, (_, i) => addDays(w, i)));
  return weeks;
}

/** Every day a view shows around `day`. */
export function viewDays(view: View, day: Day): Day[] {
  if (view === "month") return monthWeeks(day).flat();
  if (view === "week") return Array.from({ length: 7 }, (_, i) => addDays(weekStart(day), i));
  if (view === "day") return [day];
  return Array.from({ length: AGENDA_DAYS }, (_, i) => addDays(day, i));
}

/** The day a view lands on one period later (`dir` 1) or earlier (-1). A month keeps the day of the month where it can. */
export function stepDay(view: View, day: Day, dir: 1 | -1): Day {
  if (view === "week") return addDays(day, 7 * dir);
  if (view === "day") return addDays(day, dir);
  if (view === "agenda") return addDays(day, AGENDA_DAYS * dir);
  const d = dayStart(day);
  const last = new Date(d.getFullYear(), d.getMonth() + dir + 1, 0).getDate();
  return dayKey(new Date(d.getFullYear(), d.getMonth() + dir, Math.min(d.getDate(), last)));
}

/** The instants a list of days covers: from the first day's midnight to the midnight after the last. */
export const daysRange = (days: Day[]) => ({ from: dayStart(days[0]), to: dayStart(addDays(days[days.length - 1], 1)) });

/** All-day items, and timed ones a day or longer, go in the all-day row; the rest in the time grid. */
export const inAllDayRow = (s: Span) => s.allDay || s.end.getTime() - s.start.getTime() >= DAY_MINUTES * MINUTE;

/** Whether a span covers any of a day. A moment (start = end) belongs to the day it's on. */
function touches(s: Span, day: Day): boolean {
  const from = dayStart(day);
  const to = dayStart(addDays(day, 1));
  return s.start < to && (s.end > from || (s.end.getTime() === s.start.getTime() && s.start >= from));
}

/** The order items are listed in on a day: the all-day row first, then by start, longer first. */
export function byStart(a: Span, b: Span): number {
  return Number(inAllDayRow(b)) - Number(inAllDayRow(a)) || a.start.getTime() - b.start.getTime() || b.end.getTime() - a.end.getTime();
}

/** Each of `days` with the items on it, in listing order. */
export function bucket<T>(items: T[], span: (t: T) => Span, days: Day[]): Map<Day, T[]> {
  const out = new Map<Day, T[]>(days.map((d) => [d, []]));
  const sorted = [...items].sort((a, b) => byStart(span(a), span(b)));
  for (const item of sorted) for (const d of days) if (touches(span(item), d)) out.get(d)!.push(item);
  return out;
}

/**
 * A timed item's piece of one day in the time grid: minutes from midnight by the clock; the lane it
 * starts in among the items it overlaps, how many lanes it runs across (the free ones to its right),
 * and how deep it sits on top of earlier items in its lane.
 */
export interface Segment<T> {
  item: T;
  top: number;
  bottom: number;
  lane: number;
  lanes: number;
  span: number;
  indent: number;
}

const clockMinutes = (d: Date) => d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;

/** Minutes apart two overlapping items start before the later one sits on top of the earlier rather than beside it. */
export const NEST = 30;

/**
 * The time grid for one day: each timed item's piece of the day. Items that start at about the same
 * time (under NEST minutes apart) sit side by side, each in the first free lane; one that starts later,
 * inside another, sits on top of it a little indented, so both titles show and neither gets thin.
 * Items that overlap, directly or through a chain, share one set of lanes, and each widens into the
 * lanes to its right that nothing overlapping it uses.
 */
export function timeGrid<T>(items: T[], span: (t: T) => Span, day: Day): Segment<T>[] {
  const from = dayStart(day);
  const to = dayStart(addDays(day, 1));
  const segs = items
    .filter((t) => !inAllDayRow(span(t)) && touches(span(t), day))
    .map((item) => {
      const s = span(item);
      const top = s.start <= from ? 0 : clockMinutes(s.start);
      const bottom = s.end >= to ? DAY_MINUTES : Math.max(top, clockMinutes(s.end));
      return { item, top, bottom, lane: 0, lanes: 1, span: 1, indent: 0 };
    })
    .sort((a, b) => a.top - b.top || b.bottom - a.bottom);
  // A moment or a very short item still takes some room, so what's drawn is what's compared.
  const end = (s: { top: number; bottom: number }) => Math.max(s.bottom, s.top + 15);
  const overlap = (a: Segment<T>, b: Segment<T>) => a.top < end(b) && b.top < end(a);
  let cluster: Segment<T>[] = [];
  let clusterEnd = -1;
  const close = () => {
    const lanes = Math.max(0, ...cluster.map((s) => s.lane)) + 1;
    for (const s of cluster) {
      s.lanes = lanes;
      let next = s.lane + 1;
      while (next < lanes && !cluster.some((o) => o.lane === next && overlap(o, s))) next++;
      s.span = next - s.lane;
    }
    cluster = [];
  };
  for (const seg of segs) {
    if (seg.top >= clusterEnd) close();
    const on = cluster.filter((s) => end(s) > seg.top);
    const taken = on.filter((s) => seg.top - s.top < NEST).map((s) => s.lane);
    let lane = 0;
    while (taken.includes(lane)) lane++;
    seg.lane = lane;
    seg.indent = Math.max(-1, ...on.filter((s) => s.lane === lane).map((s) => s.indent)) + 1;
    cluster.push(seg);
    clusterEnd = Math.max(clusterEnd, end(seg));
  }
  close();
  return segs;
}

/** An all-day-row item as a bar across a row of days: the columns it covers, the row it's in, and whether it goes on past either end. */
export interface Bar<T> {
  item: T;
  from: number;
  to: number;
  row: number;
  before: boolean;
  after: boolean;
}

/** The all-day row for consecutive `days` (a week, or a day): each item as a bar, stacked so no two in a row overlap. */
export function bars<T>(items: T[], span: (t: T) => Span, days: Day[]): Bar<T>[] {
  const out: Bar<T>[] = [];
  const rows: number[] = []; // the last column each row is taken to
  const sorted = items.filter((t) => inAllDayRow(span(t))).sort((a, b) => byStart(span(a), span(b)));
  for (const item of sorted) {
    const cols = days.flatMap((d, i) => (touches(span(item), d) ? [i] : []));
    if (!cols.length) continue;
    const [from, to] = [cols[0], cols[cols.length - 1]];
    let row = rows.findIndex((last) => last < from);
    if (row < 0) row = rows.length;
    rows[row] = to;
    const s = span(item);
    out.push({ item, from, to, row, before: s.start < dayStart(days[from]), after: s.end > dayStart(addDays(days[to], 1)) });
  }
  return out;
}

/**
 * A week of Month: every item as a bar across the days it's on, stacked into rows so no two in a row
 * overlap. Items over more than one day go first, longest first, so they make one straight bar.
 */
export function weekRows<T>(items: T[], span: (t: T) => Span, days: Day[]): Bar<T>[] {
  const out: Bar<T>[] = [];
  const rows: boolean[][] = []; // rows[row][column]: taken
  const placed = items
    .map((item) => ({ item, cols: days.flatMap((d, i) => (touches(span(item), d) ? [i] : [])) }))
    .filter((p) => p.cols.length)
    .sort((a, b) => b.cols.length - a.cols.length || byStart(span(a.item), span(b.item)));
  for (const { item, cols } of placed) {
    const [from, to] = [cols[0], cols[cols.length - 1]];
    let row = rows.findIndex((r) => cols.every((c) => !r[c]));
    if (row < 0) row = rows.push([]) - 1;
    for (const c of cols) rows[row][c] = true;
    const s = span(item);
    out.push({ item, from, to, row, before: s.start < dayStart(days[from]), after: s.end > dayStart(addDays(days[to], 1)) });
  }
  return out;
}

/**
 * Which of a week's bars show when each day has room for `lines`: a day with more than that shows one
 * fewer, for its "+N more". A bar shows only where it fits on every day it crosses. Returns the bars
 * that show, and how many each day hides.
 */
export function fitRows<T>(rows: Bar<T>[], lines: number, columns = 7): { shown: Bar<T>[]; hidden: number[] } {
  const on = Array.from({ length: columns }, (_, c) => rows.filter((b) => b.from <= c && c <= b.to).length);
  const limit = on.map((n) => (n > lines ? Math.max(0, lines - 1) : lines));
  const shown = rows.filter((b) => on.every((_, c) => c < b.from || c > b.to || b.row < limit[c]));
  const hidden = on.map((n, c) => n - shown.filter((b) => b.from <= c && c <= b.to).length);
  return { shown, hidden };
}

/** Where the now line sits in today's grid, in minutes from midnight. */
export const nowMinutes = (now: Date) => clockMinutes(now);

// ------------------------------------------------------------------ changing times (drags, keys, the form)

/** Times as the server takes them: instants in UTC ("…Z"), or days ("YYYY-MM-DD", end exclusive) all day. */
export interface Times {
  start: string;
  end: string;
  allDay: boolean;
}

/** The step drags and keys move by, in minutes. */
export const SNAP = 15;
const MINUTE_MS = 60_000;

export const snap = (minutes: number) => Math.round(minutes / SNAP) * SNAP;

/** The local time `minutes` after a day's midnight, by the clock (so 9:00 is 9:00 on a day the clocks change). */
export function atMinutes(day: Day, minutes: number): Date {
  const d = dayStart(day);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, minutes);
}

const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");
export const timesOf = (start: Date, end: Date, allDay: boolean): Times => (allDay ? { start: dayKey(start), end: dayKey(end), allDay } : { start: iso(start), end: iso(end), allDay });

/**
 * Where a new event starts, half an hour long: the next half hour today, or 9 in the morning on a day
 * ahead. Never in the past: a day gone by (focused earlier, or still showing from yesterday) means today.
 */
export function defaultSlot(now: Date, day?: Day): { start: Date; end: Date } {
  const today = dayKey(now);
  const start = !day || day <= today ? atMinutes(today, Math.floor(clockMinutes(now) / 30) * 30 + 30) : atMinutes(day, 9 * 60);
  return { start, end: new Date(start.getTime() + 30 * MINUTE_MS) };
}

/** The slot a drag down a day's column covers, between two points in minutes from midnight: widened to the grid, one step at least. */
export function dragSlot(day: Day, a: number, b: number): { start: Date; end: Date } {
  const lo = Math.max(0, Math.floor(Math.min(a, b) / SNAP) * SNAP);
  const hi = Math.min(DAY_MINUTES, Math.max(lo + SNAP, Math.ceil(Math.max(a, b) / SNAP) * SNAP));
  return { start: atMinutes(day, Math.min(lo, DAY_MINUTES - SNAP)), end: atMinutes(day, hi) };
}

const shift = (d: Date, days: number, minutes: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, d.getHours(), d.getMinutes() + minutes, d.getSeconds());

/** A span moved by whole days and clock minutes, the same length; all day, by days only. */
export function moved(s: Span, by: { days?: number; minutes?: number }): Times {
  const days = by.days ?? 0;
  if (s.allDay) return timesOf(shift(s.start, days, 0), shift(s.end, days, 0), true);
  const start = shift(s.start, days, by.minutes ?? 0);
  return timesOf(start, new Date(start.getTime() + s.end.getTime() - s.start.getTime()), false);
}

/** A timed span dropped on a day at `minutes` from its midnight (snapped to the grid), the same length. */
export function movedTo(s: Span, day: Day, minutes: number): Times {
  const start = atMinutes(day, Math.max(0, Math.min(DAY_MINUTES - SNAP, snap(minutes))));
  return timesOf(start, new Date(start.getTime() + s.end.getTime() - s.start.getTime()), false);
}

/** A timed span whose end moves by `minutes`, one step long at least. */
export function resizedBy(s: Span, minutes: number): Times {
  const end = Math.max(s.start.getTime() + SNAP * MINUTE_MS, shift(s.end, 0, minutes).getTime());
  return timesOf(s.start, new Date(end), false);
}

/** A timed span whose end is dragged to `minutes` from the midnight of `day` (snapped to the grid), one step long at least. */
export function endAt(s: Span, day: Day, minutes: number): Times {
  const end = Math.max(s.start.getTime() + SNAP * MINUTE_MS, atMinutes(day, Math.min(DAY_MINUTES, snap(minutes))).getTime());
  return timesOf(s.start, new Date(end), false);
}
