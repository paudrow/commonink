// Calendar events: records from the workspace's calendar feeds and Google, notes in Events/ for its own, and the meeting
// notes made from them. They need the host's calendars (CommandHost.calendar).
import { dayRange, fmtEvent, fmtEvents, fmtSources, type Calendar } from "../calendar.ts";
import { notePath } from "../ids.ts";
import { VaultError } from "../paths.ts";
import { command, num, str, type CommandHost } from "./types.ts";

const calendarOf = (h: CommandHost): Calendar => {
  if (!h.calendar) throw new VaultError("Calendars aren't available here");
  return h.calendar;
};
const viewer = (h: CommandHost) => ({ user: h.user, canEdit: h.canEditShared });
const zoneOf = (zone?: string) => zone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const ZONE = { flag: "tz", label: "zone", describe: "IANA time zone to write times in, e.g. America/Los_Angeles (default: this computer's or server's)" } as const;
const PEOPLE = "people choose their calendars, on the Calendar page";

export const calendar = [
  command({
    cli: "events",
    mcp: "list_events",
    route: "GET /calendar/events",
    title: "List calendar events",
    summary: "Calendar events, soonest first (default: the next 7 days); feeds that are due are read first",
    description:
      "Events from the calendars this workspace subscribes to (and the user's own), soonest first, for a range of days. Each has an id " +
      "for get_event and create_meeting_note, and the meeting note it's linked to, if any. Feed and Google events are records; the workspace's own are notes in Events/ (create one there to add an event).",
    examples: ["commonink events", "commonink events --from 2026-10-05 --days 1 --tz America/Los_Angeles", "commonink events --query standup --json"],
    readOnly: true,
    needs: "calendar",
    args: {
      from: str({ label: "YYYY-MM-DD", describe: "First day, YYYY-MM-DD (default: today)" }),
      days: num({ min: 1, max: 90, describe: "How many days (default 7)" }),
      query: str({ label: "words", describe: "Only events whose title contains this" }),
      time_zone: str(ZONE),
    },
    run: async (h, a) => {
      const cal = calendarOf(h);
      await cal.syncDue(); // anything that's come due since, so the list isn't stale
      const zone = zoneOf(a.time_zone);
      const range = dayRange(a.from, a.days ?? 7, zone);
      const events = cal.events(viewer(h), { ...range, zone, q: a.query });
      return { text: fmtEvents(events, cal.sources(viewer(h)), zone, range), data: events };
    },
  }),
  command({
    cli: "event",
    mcp: "get_event",
    route: "GET /calendar/event",
    title: "Get calendar event",
    summary: "One event in full, with its meeting note",
    description: "One event in full: time, place, organizer, attendees, description, and its meeting note if it has one.",
    examples: ["commonink event k3m9x2p7q4rt", "commonink event k3m9x2p7q4rt --json"],
    readOnly: true,
    needs: "calendar",
    args: { id: str({ required: true, pos: 0, describe: "The event's id from list_events (commonink events)" }), time_zone: str(ZONE) },
    run: (h, a) => {
      const cal = calendarOf(h);
      const ev = cal.event(a.id, viewer(h));
      if (!ev) throw new VaultError(`No event ${a.id}; commonink events (list_events) lists them with their ids`, "not_found");
      return { text: fmtEvent(ev, cal.sources(viewer(h)), zoneOf(a.time_zone)), data: ev };
    },
  }),
  command({
    cli: "meeting-note",
    mcp: "create_meeting_note",
    route: "POST /calendar/meeting-note",
    title: "Create meeting note",
    summary: "The event's meeting note in Meetings/, made and linked if new",
    description:
      "The event's meeting note: a new note in Meetings/ (from Templates/Meeting note.md if there is one) with its time, place, " +
      "attendees, agenda and a link back to the event, linked to the event (its frontmatter `event:` names the event). If the event already has one, returns that note instead.",
    examples: ["commonink meeting-note k3m9x2p7q4rt", "commonink meeting-note k3m9x2p7q4rt --tz Europe/Berlin"],
    needs: "calendar",
    args: { id: str({ required: true, pos: 0, describe: "The event's id from list_events (commonink events)" }), time_zone: str(ZONE) },
    run: async (h, a) => {
      const cal = calendarOf(h);
      const r = cal.meetingNote(h.vault, a.id, viewer(h), { timeZone: zoneOf(a.time_zone), source: h.source });
      const data = { path: r.path, created: r.created };
      if (!r.created) return { text: `The event already has a meeting note: ${r.path}`, data };
      // Online, the note's link goes back into the event in Google Calendar, where it came from there.
      const linked = h.origin && r.noteId ? await cal.linkBack(a.id, viewer(h), `${h.origin}${notePath(h.vault.read(r.path).title, r.noteId)}`) : null;
      const back = !linked ? "" : linked.ok ? "; its link was added to the event in Google Calendar" : `; the link couldn't be added in Google Calendar (${linked.error})`;
      return { text: `Created ${r.path}, linked to the event${back}`, data };
    },
  }),
  command({
    cli: "calendars",
    mcp: { none: `list_events names each event's calendar; ${PEOPLE}` },
    route: "GET /calendar/sources",
    title: "Calendars",
    summary: "The calendars (ICS feeds) this vault subscribes to",
    examples: ["commonink calendars", "commonink calendars --json"],
    readOnly: true,
    args: {},
    run: (h) => {
      const list = calendarOf(h).sources(viewer(h));
      return { text: fmtSources(list), data: list };
    },
  }),
  command({
    cli: "calendars add",
    mcp: { none: `subscribing reads whatever address it's given; ${PEOPLE}` },
    route: "POST /calendar/sources",
    title: "Subscribe to a calendar",
    summary: "Subscribe to an ICS or webcal feed",
    examples: ["commonink calendars add webcal://example.com/team.ics --name Team"],
    args: { url: str({ required: true, pos: 0, describe: "An ICS or webcal address" }), name: str({ describe: "What to call it (default: the feed's own name)" }) },
    run: async (h, a) => {
      const cal = calendarOf(h);
      await cal.addIcs({ url: a.url, name: a.name }, viewer(h), h.source);
      const list = cal.sources(viewer(h));
      return { text: fmtSources(list), data: list };
    },
  }),
  command({
    cli: "calendars refresh",
    mcp: { none: "list_events reads the feeds that are due before it answers" },
    route: "POST /calendar/refresh",
    title: "Read calendars again",
    summary: "Read every calendar feed again now",
    examples: ["commonink calendars refresh"],
    args: {},
    run: async (h) => {
      const cal = calendarOf(h);
      await cal.refresh(viewer(h));
      const list = cal.sources(viewer(h));
      return { text: fmtSources(list), data: list };
    },
  }),
  command({
    cli: "calendars remove",
    mcp: { none: `unsubscribing is the person's: ${PEOPLE}` },
    route: "POST /calendar/sources/remove",
    title: "Unsubscribe from a calendar",
    summary: "Unsubscribe from a calendar (its id from commonink calendars)",
    examples: ["commonink calendars remove c7h2k9"],
    destructive: true,
    args: { id: str({ required: true, pos: 0, describe: "Its id, from commonink calendars" }) },
    run: (h, a) => {
      const cal = calendarOf(h);
      cal.remove(a.id, viewer(h));
      const list = cal.sources(viewer(h));
      return { text: fmtSources(list), data: list };
    },
  }),
];
