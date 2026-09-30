// Calendar data for everything that shows events: the Calendar page, Today, the ::calendar and
// ::agenda widgets and the editor's completions. Sources and events are fetched once a minute at
// most and dropped when the server says calendars changed (main.ts calls calendarChanged). Also
// what an item on the page is (an event or a task due that day), and the words for its time.
import { api, ApiError, type CalendarEvent, type CalendarSource, type SourceColor, type Task } from "../api.ts";
import { addDays, dayKey, dayStart, spanOf, timesOf, type Day, type Span } from "./layout.ts";

export type { CalendarEvent, CalendarSource, SourceColor };

/** The colors a calendar can have, in the order the app offers them (the server's SOURCE_COLORS). */
export const COLORS = ["blue", "green", "orange", "purple", "red", "teal", "pink", "brown"] as const satisfies readonly SourceColor[];
type Missing = Exclude<SourceColor, (typeof COLORS)[number]>;
const everyColor: Missing extends never ? true : Missing = true; // a color the server adds must be added here
void everyColor;

/** A color's CSS value (styles.css defines --cal-* for both themes); an unknown one is blue. */
export const colorVar = (c: string | null | undefined) => `var(--cal-${(COLORS as readonly string[]).includes(c ?? "") ? c : "blue"})`;

/** Who's looking, where: set by main.ts once the workspace is known. */
const context = { canEdit: true, workspace: "" };
/** Whether this person may subscribe the workspace and make meeting notes: editors and owners online, anyone locally. */
export const canEditCalendars = () => context.canEdit;
/** The workspace open, online ("" locally): connecting Google comes back to it. */
export const calendarWorkspace = () => context.workspace;
export const setCalendarContext = (c: Partial<typeof context>) => Object.assign(context, c);

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
 * the Meeting note template). Resolves to its path and, for a new note on a Google event with
 * write-back on, whether its link reached the event.
 */
export async function meetingNote(ev: CalendarEvent): Promise<{ path: string; linkedBack?: { ok: true } | { ok: false; error: string } | null }> {
  if (ev.note) return { path: ev.note.path };
  const r = await api.meetingNote(ev.id);
  calendarChanged();
  return r;
}

// ------------------------------------------------------------------ making and changing events

/** A calendar a new event can go in: `value` is a source's ID, or "local" for the workspace's own before its first event. */
export interface Target {
  value: string;
  name: string;
  color: SourceColor | null;
}

/** The workspace's own calendar's name (LOCAL_NAME on the server). */
export const LOCAL_CALENDAR = "Common Ink";

/** Where this person can add events: the workspace's own calendar (editors), then their writable Google calendars. */
export function eventTargets(sources: CalendarSource[]): Target[] {
  const writable = sources.filter((s) => s.writable).sort((a, b) => Number(b.kind === "local") - Number(a.kind === "local"));
  const local = canEditCalendars() && !sources.some((s) => s.kind === "local") ? [{ value: "local", name: LOCAL_CALENDAR, color: null }] : [];
  return [...local, ...writable.map((s) => ({ value: s.id, name: s.name, color: s.color }))];
}

/** Why an item can't be moved or changed here, or null when it can. */
export function readOnlyReason(item: Item): string | null {
  if (item.kind === "task") return "Change a task's due date in its note";
  const s = item.source;
  if (s?.writable) return null;
  return s?.readOnly ?? "This event can't be changed here";
}

/** What the event form holds, before it's sent. */
export interface EventForm {
  source: string;
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  location: string;
  description: string;
  attendees: Array<{ name: string | null; email: string | null }>;
  meetingNote: boolean;
}

/** The form as the server takes it: its times in the server's form, made in the reader's zone. */
export function eventBody(f: EventForm) {
  return {
    source: f.source,
    title: f.title.trim(),
    ...timesOf(f.start, f.end, f.allDay),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    location: f.location.trim() || null,
    description: f.description.trim() || null,
    attendees: f.attendees,
    ...(f.meetingNote ? { meetingNote: true } : {}),
  };
}

/** An event's own fields as a body, to put it back after a delete (a new ID, the same event). */
export const eventAgain = (ev: CalendarEvent) => ({
  source: ev.source,
  title: ev.title,
  start: ev.start,
  end: ev.end,
  allDay: ev.allDay,
  timeZone: ev.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
  location: ev.location,
  description: ev.description,
  attendees: ev.attendees.map((a) => ({ name: a.name, email: a.email })),
  note: ev.note?.id, // its meeting note, linked again
});
