// The Calendar page's keys, in one table: the page runs them (page.ts) and the shortcut sheet lists
// them (commands.ts). Keys are matched by the character typed (keys.ts), like Google Calendar's.
export type CalendarAction = "today" | "next" | "prev" | "month" | "week" | "day" | "agenda" | "create";

/** How a key moves the event that has the focus (or whose details are open): by days, by minutes, or its end by minutes. */
export type Nudge = { days?: number; minutes?: number; end?: number };

/** The keys that move an event, each through matchKeys. Alt+arrows, since the arrows alone move between days and events. */
export const NUDGE_KEYS: Array<{ keys: string; by: Nudge }> = [
  { keys: "Alt-ArrowUp", by: { minutes: -15 } },
  { keys: "Alt-ArrowDown", by: { minutes: 15 } },
  { keys: "Alt-ArrowLeft", by: { days: -1 } },
  { keys: "Alt-ArrowRight", by: { days: 1 } },
  { keys: "Alt-Shift-ArrowUp", by: { end: -15 } },
  { keys: "Alt-Shift-ArrowDown", by: { end: 15 } },
];

export const CALENDAR_KEYS: Array<{ keys: string[]; label: string; action?: CalendarAction }> = [
  { keys: ["t"], label: "Go to today", action: "today" },
  { keys: ["j", "n"], label: "Next week, month or day", action: "next" },
  { keys: ["k", "p"], label: "Previous week, month or day", action: "prev" },
  { keys: ["m", "w", "d", "a"], label: "Month, week, day or agenda view" },
  { keys: ["c"], label: "New event", action: "create" },
  { keys: ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"], label: "Move between days and events" },
  { keys: ["Enter"], label: "Open the event (on a day in Month: that day)" },
  { keys: ["Escape"], label: "Close the event" },
  { keys: ["Alt-ArrowUp", "Alt-ArrowDown"], label: "Move the event 15 minutes earlier or later" },
  { keys: ["Alt-ArrowLeft", "Alt-ArrowRight"], label: "Move the event a day earlier or later" },
  { keys: ["Alt-Shift-ArrowUp", "Alt-Shift-ArrowDown"], label: "Make the event 15 minutes shorter or longer" },
];

/** The views' keys, which the table above lists as one row. */
export const VIEW_KEYS = { m: "month", w: "week", d: "day", a: "agenda" } as const;
