// The Calendar page's keys, in one table: the page runs them (page.ts) and the shortcut sheet lists
// them (commands.ts). Keys are matched by the character typed (keys.ts), like Google Calendar's.
export type CalendarAction = "today" | "next" | "prev" | "month" | "week" | "day" | "agenda";

export const CALENDAR_KEYS: Array<{ keys: string[]; label: string; action?: CalendarAction }> = [
  { keys: ["t"], label: "Go to today", action: "today" },
  { keys: ["j", "n"], label: "Next week, month or day", action: "next" },
  { keys: ["k", "p"], label: "Previous week, month or day", action: "prev" },
  { keys: ["m", "w", "d", "a"], label: "Month, week, day or agenda view" },
  { keys: ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"], label: "Move between days and events" },
  { keys: ["Enter"], label: "Open the event (on a day in Month: that day)" },
  { keys: ["Escape"], label: "Close the event" },
];

/** The views' keys, which the table above lists as one row. */
export const VIEW_KEYS = { m: "month", w: "week", d: "day", a: "agenda" } as const;
