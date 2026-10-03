// The workspace's own events are notes in Events/, one per event, named after its day and title:
//
//   Events/2026-10-05 Launch review.md
//   ---
//   start: 2026-10-05T10:00-05:00     (or 2026-10-05 10:00 for that time wherever the reader is)
//   end: 2026-10-05T11:00-05:00       (or just 11:00, the same day; an hour if left out)
//   where: Room 1
//   attendees:
//     - Ana <ana@example.com>
//   ---
//   # Launch review
//
//   The description: whatever's under the title.
//
// All day: `all_day: true` with days, `end` being the last day (inclusive, left out for one day).
// So agents make events with the note tools they already have, and History, Undo and export work on
// events as on any note. Calendar (calendar.ts) reads and writes them through the vault; this file
// is only the format. No Node imports: the Worker runs this too.
import type { Person } from "./ics.ts";
import { frontmatterEntries, frontmatterText, listOf, scalarOf, type Entry } from "./frontmatter.ts";
import { yamlValue } from "./contacts.ts";
import { headingText } from "./prose.ts";

/** The folder the workspace's own events live in. */
export const EVENTS = "Events";

/** An event as its note says it. Times as in CalendarEvent: an instant ("…Z"), a floating time, or a day; `end` exclusive. */
export interface NoteEvent {
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location: string | null;
  description: string | null;
  attendees: Person[];
}

/** The keys this format writes; any others in a note's frontmatter are left alone. */
const KEYS = ["all_day", "start", "end", "where", "location", "attendees"];
const DAY = 86_400_000;
const HOUR = 3_600_000;

/** Whether `rel` is where an event note can be. */
export const inEvents = (rel: string) => rel.startsWith(`${EVENTS}/`) && /\.md$/i.test(rel);

/** A time as written in a note: a day, and maybe a time of day and a zone ("Z", "-05:00"). */
interface Written {
  day: string;
  time: string | null;
  zone: string | null;
}

function written(s: string, sameDayAs?: Written): Written | null {
  const t = s.trim();
  const only = t.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (only && sameDayAs) return { day: sameDayAs.day, time: hms(only[1], only[2], only[3]), zone: sameDayAs.zone };
  const m = t.match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?)?$/i);
  if (!m || Number.isNaN(Date.parse(m[1]))) return null;
  if (m[2] && (Number(m[2]) > 23 || Number(m[3]) > 59)) return null;
  const zone = m[5] ? (m[5].toUpperCase() === "Z" ? "Z" : m[5].replace(/^([+-]\d{2})(\d{2})$/, "$1:$2")) : null;
  return { day: m[1], time: m[2] ? hms(m[2], m[3], m[4]) : null, zone };
}

const hms = (h: string, m: string, s?: string) => `${h.padStart(2, "0")}:${m}:${s ?? "00"}`;

/** As CalendarEvent keeps it: an instant in UTC, or a floating time. */
function stored(w: Written): string {
  const local = `${w.day}T${w.time ?? "00:00:00"}`;
  return w.zone ? new Date(Date.parse(`${local}${w.zone}`)).toISOString().replace(/\.\d{3}Z$/, "Z") : local;
}

const msOf = (t: string) => (t.length === 10 ? Date.parse(`${t}T00:00:00Z`) : Date.parse(t.endsWith("Z") ? t : `${t}Z`));
const plusDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/** "Ana <ana@example.com>", "ana@example.com", "[[People/Ana]]" or "Ana". */
function personOf(s: string): Person | null {
  const t = s.trim().replace(/^\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]$/, (_, p: string) => p.split("/").pop()!);
  const m = t.match(/^(.*?)\s*<([^<>\s]+@[^<>\s]+)>$/);
  if (m) return { name: m[1].replace(/^"|"$/g, "").trim() || null, email: m[2].toLowerCase(), status: null };
  if (/^[^\s@]+@[^\s@]+$/.test(t)) return { name: null, email: t.toLowerCase(), status: null };
  return t ? { name: t, email: null, status: null } : null;
}

/** The title and description from a note's body: its first `# heading`, and the rest. */
function bodyParts(body: string): { heading: string | null; rest: string } {
  const m = body.match(/^\s*#[ \t]+(.+)\n?/);
  return m ? { heading: headingText(m[1]).trim() || null, rest: body.slice(m[0].length) } : { heading: null, rest: body };
}

/** A note's file name without its day in front ("2026-10-05 Launch review" is "Launch review"). */
const nameOf = (rel: string) => rel.split("/").pop()!.replace(/\.md$/i, "").replace(/^\d{4}-\d{2}-\d{2}\s+/, "").trim();

/** The event a note in Events/ is, or null if it isn't one (no `start:` it can read). */
export function eventFromNote(rel: string, md: string): NoteEvent | null {
  const { entries, body } = frontmatterEntries(md);
  const get = (k: string) => entries.find((e) => e.key.toLowerCase() === k);
  const start = written(scalarOf(get("start")));
  if (!start) return null;
  const endText = scalarOf(get("end"));
  const end = endText ? written(endText, start) : null;
  const allDay = /^(true|yes)$/i.test(scalarOf(get("all_day"))) || !start.time;
  let s: string, e: string;
  if (allDay) {
    s = start.day;
    e = plusDays(end && end.day > start.day ? end.day : start.day, 1);
  } else {
    // An end without a zone is in the start's; an end with one, beside a start with none, isn't.
    s = stored(start);
    e = end ? stored({ ...end, zone: start.zone, time: end.time ?? "00:00:00" }) : "";
    if (!e || msOf(e) <= msOf(s)) e = s.endsWith("Z") ? new Date(msOf(s) + HOUR).toISOString().replace(/\.\d{3}Z$/, "Z") : new Date(msOf(s) + HOUR).toISOString().slice(0, 19);
  }
  const { heading, rest } = bodyParts(body);
  const title = (scalarOf(get("title")) || heading || nameOf(rel) || "Event").replace(/[\x00-\x1f\x7f]/g, " ").trim().slice(0, 500);
  const where = scalarOf(get("where")) || scalarOf(get("location"));
  return {
    title,
    start: s,
    end: e,
    allDay,
    location: where || null,
    description: rest.trim() || null,
    attendees: listOf(get("attendees")).flatMap((a) => personOf(a) ?? []).slice(0, 100),
  };
}

/** The offset a note's `start:` is written with ("-05:00", "Z"), so a change keeps the times on that clock; null if none. */
export function zoneIn(md: string): string | null {
  const w = written(scalarOf(frontmatterEntries(md).entries.find((e) => e.key.toLowerCase() === "start")));
  return w?.zone ?? null;
}

/** How far `zone` (an IANA zone, "Z", or an offset like "-05:00") is ahead of UTC at instant `t`, in minutes. */
function offsetMinutes(t: number, zone: string): number {
  if (zone === "Z") return 0;
  const fixed = zone.match(/^([+-])(\d{2}):(\d{2})$/);
  if (fixed) return (fixed[1] === "-" ? -1 : 1) * (Number(fixed[2]) * 60 + Number(fixed[3]));
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric" })
      .formatToParts(t)
      .map((x) => [x.type, Number(x.value)]),
  );
  return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - Math.floor(t / 60_000) * 60_000) / 60_000);
}

/** A time as a note shows it: on the clock of `zone` (UTC if none) with its offset, "2026-10-05T10:00-05:00". */
function clock(t: string, zone: string | null): string {
  if (!t.endsWith("Z")) return t.replace(/:00$/, "");
  const ms = msOf(t);
  const off = zone ? offsetMinutes(ms, zone) : 0;
  const local = new Date(ms + off * 60_000).toISOString().slice(0, 19).replace(/:00$/, "");
  if (!off) return `${local}Z`;
  const a = Math.abs(off);
  return `${local}${off < 0 ? "-" : "+"}${String(Math.floor(a / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")}`;
}

/** The day an event's note is named after: its start's, on the clock of `zone`. */
export function dayOf(ev: Pick<NoteEvent, "start">, zone: string | null): string {
  return clock(ev.start, zone).slice(0, 10);
}

/** An event's note name, without the folder: "2026-10-05 Launch review". */
export function noteName(ev: Pick<NoteEvent, "start" | "title">, zone: string | null): string {
  const title = ev.title.replace(/[\\/:*?"<>|#^[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80).replace(/^\.+/, "") || "Event";
  return `${dayOf(ev, zone)} ${title}`;
}

const personText = (p: Person) => (p.name && p.email ? `${p.name} <${p.email}>` : (p.name ?? p.email ?? ""));

/**
 * An event's note: `existing` (its current text) with the event's keys written into its
 * frontmatter, other keys left as they are. Its title is the note's `# heading`; `body` false keeps
 * the words under it (a move or a new time doesn't touch them), true writes the description there.
 */
export function eventNote(ev: NoteEvent, zone: string | null, existing?: string, body = true): string {
  const { entries: had, body: oldBody } = existing === undefined ? { entries: [] as Entry[], body: "" } : frontmatterEntries(existing);
  const out: Entry[] = [];
  const put = (key: string, value: string) => out.push({ key, lines: [`${key}: ${yamlValue(value)}`] });
  // A `title:` wins over the heading when the note is read, so it changes with the title.
  if (had.some((e) => e.key.toLowerCase() === "title")) put("title", ev.title);
  if (ev.allDay) {
    out.push({ key: "all_day", lines: ["all_day: true"] });
    put("start", ev.start);
    const last = plusDays(ev.end, -1);
    if (last > ev.start) put("end", last);
  } else {
    put("start", clock(ev.start, zone));
    put("end", clock(ev.end, zone));
  }
  if (ev.location) put("where", ev.location);
  if (ev.attendees.length) out.push({ key: "attendees", lines: ["attendees:", ...ev.attendees.map((a) => `  - ${yamlValue(personText(a))}`)] });
  out.push(...had.filter((e) => !KEYS.includes(e.key.toLowerCase()) && e.key.toLowerCase() !== "title"));
  const last = out.at(-1)?.lines;
  while (last && last.length > 1 && !last.at(-1)!.trim()) last.pop();
  const heading = `# ${ev.title}\n`;
  let text: string;
  if (body || existing === undefined) text = ev.description ? `${heading}\n${ev.description.trim()}\n` : heading;
  else {
    // The title is the heading: a new title replaces it (or goes on top); the words under it stay.
    const parts = bodyParts(oldBody);
    text = parts.heading === ev.title ? oldBody : `${heading}${parts.heading === null ? (parts.rest.trim() ? "\n" : "") : ""}${parts.rest}`;
  }
  return frontmatterText(out) + text;
}
