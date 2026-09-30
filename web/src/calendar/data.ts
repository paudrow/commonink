// Calendar data for everything that shows events: the Calendar page, Today, the ::calendar and
// ::agenda widgets and the editor's completions. Sources and events are fetched once a minute at
// most and dropped when the server says calendars changed (main.ts calls calendarChanged). Also
// what an item on the page is (an event or a task due that day), and the words for its time.
import { api, ApiError, type CalendarEvent, type CalendarSource, type SourceColor, type Task } from "../api.ts";
import { addDays, dayKey, dayStart, spanOf, type Day, type Span } from "./layout.ts";

export type { CalendarEvent, CalendarSource, SourceColor };

/** The colors a calendar can have, in the order the app offers them (the server's SOURCE_COLORS). */
export const COLORS = ["blue", "green", "orange", "purple", "red", "teal", "pink", "brown"] as const satisfies readonly SourceColor[];
type Missing = Exclude<SourceColor, (typeof COLORS)[number]>;
const everyColor: Missing extends never ? true : Missing = true; // a color the server adds must be added here
void everyColor;

/** A color's CSS value (styles.css defines --cal-* for both themes); an unknown one is blue. */
export const colorVar = (c: string | null | undefined) => `var(--cal-${(COLORS as readonly string[]).includes(c ?? "") ? c : "blue"})`;

let editable = true;
/** Whether this person may subscribe, rename, recolor, remove and make meeting notes: editors and owners online, anyone locally. */
export const canEditCalendars = () => editable;
export const setCanEditCalendars = (on: boolean) => (editable = on);

const FRESH = 60_000;
let sourceCache: { at: number; list: Promise<CalendarSource[]> } | null = null;
const eventCache = new Map<string, { at: number; list: Promise<CalendarEvent[]> }>();

/** The calendars this person sees. A server without calendars has none. */
export function calendars(): Promise<CalendarSource[]> {
  if (!sourceCache || Date.now() - sourceCache.at > FRESH) {
    const list = api.calendars().catch((e) => {
      if (e instanceof ApiError && e.status === 404) return [];
      sourceCache = null; // a failure isn't kept: the next ask tries again
      throw e;
    });
    sourceCache = { at: Date.now(), list };
  }
  return sourceCache.list;
}

/** Events overlapping [from, to), soonest first; none without calendars. */
export async function events(from: Date, to: Date): Promise<CalendarEvent[]> {
  if (!(await calendars()).length) return [];
  const key = `${from.getTime()}-${to.getTime()}`;
  const hit = eventCache.get(key);
  if (hit && Date.now() - hit.at <= FRESH) return hit.list;
  const list = api.events(from, to);
  eventCache.set(key, { at: Date.now(), list });
  list.catch(() => eventCache.delete(key));
  if (eventCache.size > 40) eventCache.delete(eventCache.keys().next().value!);
  return list;
}

/** Forget what was fetched: calendars or their events changed, or someone asked to refresh. */
export function calendarChanged() {
  sourceCache = null;
  eventCache.clear();
}

/** The events on a range of days. */
export const eventsOn = (first: Day, last: Day) => events(dayStart(first), dayStart(addDays(last, 1)));

/** Events to link to while writing: from a week back to a month ahead. */
export function linkableEvents(): Promise<CalendarEvent[]> {
  const today = dayKey(new Date());
  return eventsOn(addDays(today, -7), addDays(today, 30)).catch(() => []);
}

// ------------------------------------------------------------------ items

/** Something the calendar shows: an event, or an open task due that day (all day, in no calendar). */
export type Item =
  | { kind: "event"; key: string; title: string; span: Span; color: SourceColor; event: CalendarEvent; source: CalendarSource | null }
  | { kind: "task"; key: string; title: string; span: Span; task: Task };

export function eventItems(list: CalendarEvent[], sources: CalendarSource[]): Item[] {
  const byId = new Map(sources.map((s) => [s.id, s]));
  return list.map((event) => {
    const source = byId.get(event.source) ?? null;
    return { kind: "event", key: event.id, title: event.title || "(No title)", span: spanOf(event), color: source?.color ?? "blue", event, source };
  });
}

export function taskItems(tasks: Task[], first: Day, last: Day): Item[] {
  return tasks.flatMap((task): Item[] => {
    const due = task.meta.due?.slice(0, 10);
    if (task.done || !due || due < first || due > last) return [];
    const span = { start: dayStart(due), end: dayStart(addDays(due, 1)), allDay: true };
    return [{ kind: "task", key: `task:${task.path}:${task.line}`, title: task.summary || task.text, span, task }];
  });
}

/** Open tasks due on the days from `first` to `last`. */
export async function dueTasks(first: Day, last: Day): Promise<Item[]> {
  const tasks = await api.tasks({ due: `>=${first}`, today: dayKey(new Date()) }).catch(() => []);
  return taskItems(tasks, first, last);
}

// ------------------------------------------------------------------ words

export const timeText = (d: Date) => d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
export const dayText = (d: Date, opts: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" }) => d.toLocaleDateString(undefined, opts);

/** When an item is, in words: "Tue, Sep 29, 9:00 AM to 10:00 AM", "Tue, Sep 29, all day", "Mon, Sep 28 to Wed, Sep 30". */
export function whenText(s: Span): string {
  const lastDay = s.allDay ? new Date(s.end.getTime() - 1) : s.end;
  const sameDay = dayKey(s.start) === dayKey(lastDay);
  if (s.allDay) return sameDay ? `${dayText(s.start)}, all day` : `${dayText(s.start)} to ${dayText(lastDay)}`;
  if (s.end.getTime() === s.start.getTime()) return `${dayText(s.start)}, ${timeText(s.start)}`;
  return sameDay ? `${dayText(s.start)}, ${timeText(s.start)} to ${timeText(s.end)}` : `${dayText(s.start)}, ${timeText(s.start)} to ${dayText(s.end)}, ${timeText(s.end)}`;
}

/** An item's time on one day's list: "All day", or its start ("9:00 AM"), or "Until 11:00 AM" for the rest of one that began the day before. */
export function timeOnDay(s: Span, day: Day): string {
  if (s.allDay || s.end.getTime() - s.start.getTime() >= 86_400_000) return "All day";
  if (dayKey(s.start) !== day) return `Until ${timeText(s.end)}`;
  return timeText(s.start);
}

/** A web address an event's text holds on its own (a video call as its `location`), or null. */
export const webAddress = (s: string | null) => (s && /^https?:\/\/\S+$/i.test(s.trim()) ? s.trim() : null);
export function hostOf(href: string): string {
  try {
    return new URL(href).hostname.replace(/^www\./, "");
  } catch {
    return href;
  }
}
/** Where an event is, short: a place as written, a video call by its site. */
export const placeText = (location: string | null) => (location && webAddress(location) ? hostOf(location) : location);

/** Text a feed wrote, as plain text: tags some feeds leave in become line breaks or nothing. Shown with textContent only. */
export function plainText(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li)>/gi, "\n")
    .replace(/<[^<>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ------------------------------------------------------------------ links

/** The address of an event in the app: `[Standup](/calendar/abc…)` in a note opens it. */
export const eventHref = (id: string) => `/calendar/${id}`;

/** A markdown link to an event, as completions insert it: "[Standup · Tue Sep 29](/calendar/abc…)". */
export function eventLink(ev: CalendarEvent): string {
  const title = (ev.title || "Event").replace(/[\r\n]+/g, " ").replace(/[[\]\\]/g, "\\$&").trim();
  const day = spanOf(ev).start.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }).replace(/,/g, "");
  return `[${title} · ${day}](${eventHref(ev.id)})`;
}

/**
 * The event's meeting note: the one it has, or a new one (editors only; the server makes it from
 * the Meeting note template). Resolves to its path.
 */
export async function meetingNote(ev: CalendarEvent): Promise<string> {
  if (ev.note) return ev.note.path;
  const r = await api.meetingNote(ev.id);
  calendarChanged();
  return r.path;
}
