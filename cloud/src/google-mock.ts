// A stand-in for Google Calendar on Previews and in local development, where there's no Google OAuth
// client: the same GoogleApi, with three calendars of events that repeat from January 2026 (so every
// week has some). It's used only where DEV_LOGIN is "1" and Google isn't configured
// (googleMode in connections.ts), so production never reaches it. Descriptions written back are kept
// in the workspace's database, so write-back can be tried end to end.
import type { SqlDb } from "../../src/core/store.ts";
import type { GoogleApi, GoogleCalendar, GoogleEvent } from "./google.ts";

const LA = "America/Los_Angeles";
const at = (day: string, time: string) => ({ dateTime: `${day}T${time}:00-08:00`, timeZone: LA });

const CALENDARS: GoogleCalendar[] = [
  { id: "primary", summary: "Dev (demo Google)", primary: true, accessRole: "owner", timeZone: LA },
  { id: "family@demo", summary: "Family (demo Google)", primary: false, accessRole: "writer", timeZone: LA },
  { id: "holidays@demo", summary: "Company holidays (demo Google)", primary: false, accessRole: "reader", timeZone: LA },
];

const EVENTS: Record<string, GoogleEvent[]> = {
  primary: [
    {
      id: "gweekly1", iCalUID: "gweekly1@google.demo", summary: "Product sync", location: "https://meet.example.com/abc-defg-hij",
      description: "Roadmap, then blockers.", start: at("2026-01-06", "13:00"), end: at("2026-01-06", "13:30"), recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=TU,TH"],
      organizer: { email: "dev@example.com", displayName: "Dev User" },
      attendees: [{ email: "dev@example.com", displayName: "Dev User", responseStatus: "accepted" }, { email: "ana@example.com", displayName: "Ana Lima", responseStatus: "tentative" }],
      htmlLink: "https://calendar.google.com/calendar/event?eid=demo1",
    },
    {
      id: "gfocus", iCalUID: "gfocus@google.demo", summary: "Focus time", start: at("2026-01-05", "08:00"), end: at("2026-01-05", "10:00"),
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR"], htmlLink: "https://calendar.google.com/calendar/event?eid=demo2",
    },
    {
      id: "gretro", iCalUID: "gretro@google.demo", summary: "Retro", location: "Room 3", start: at("2026-01-09", "15:00"), end: at("2026-01-09", "16:00"),
      recurrence: ["RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=FR"], htmlLink: "https://calendar.google.com/calendar/event?eid=demo3",
    },
  ],
  "family@demo": [
    { id: "gdinner", iCalUID: "gdinner@google.demo", summary: "Family dinner", start: at("2026-01-04", "18:00"), end: at("2026-01-04", "19:30"), recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=SU"] },
    { id: "gbin", iCalUID: "gbin@google.demo", summary: "Take the bins out", start: { date: "2026-01-07" }, end: { date: "2026-01-08" }, recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=WE"] },
  ],
  "holidays@demo": [
    { id: "gsummit", iCalUID: "gsummit@google.demo", summary: "Company summit", start: { date: "2026-01-19" }, end: { date: "2026-01-21" }, recurrence: ["RRULE:FREQ=MONTHLY;INTERVAL=4;BYDAY=3MO"] },
  ],
};

/** Occurrence starts as Google writes them in instance IDs: "20261006T210000Z", or "20261007" all day. */
function instanceStart(series: GoogleEvent, instance: string): { start: GoogleEvent["start"]; end: GoogleEvent["end"] } | null {
  const s = series.start!;
  const e = series.end!;
  if (/^\d{8}$/.test(instance) && s.date) {
    const day = `${instance.slice(0, 4)}-${instance.slice(4, 6)}-${instance.slice(6)}`;
    const len = Date.parse(e.date!) - Date.parse(s.date);
    return { start: { date: day }, end: { date: new Date(Date.parse(day) + len).toISOString().slice(0, 10) } };
  }
  const m = instance.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!m || !s.dateTime) return null;
  const startAt = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  const len = Date.parse(e.dateTime!) - Date.parse(s.dateTime);
  return { start: { dateTime: new Date(startAt).toISOString(), timeZone: s.timeZone }, end: { dateTime: new Date(startAt + len).toISOString(), timeZone: s.timeZone } };
}

export class MockGoogle implements GoogleApi {
  /** `token` stands for signing in to Google: it throws if the person has no connection, like the real API would refuse them. */
  constructor(
    private token: () => Promise<string>,
    private db?: SqlDb,
  ) {
    db?.exec("CREATE TABLE IF NOT EXISTS google_mock(calendar TEXT NOT NULL, id TEXT NOT NULL, description TEXT NOT NULL, version INTEGER NOT NULL, PRIMARY KEY(calendar, id))");
  }

  private written(calendar: string): Array<{ id: string; description: string; version: number }> {
    return this.db?.all("SELECT id, description, version FROM google_mock WHERE calendar = ?", calendar) ?? [];
  }

  private all(calendar: string): GoogleEvent[] {
    const series = EVENTS[calendar] ?? [];
    const out = series.map((e) => ({ ...e }));
    for (const w of this.written(calendar)) {
      const own = out.find((e) => e.id === w.id);
      if (own) own.description = w.description;
      else {
        const [seriesId, instance] = w.id.split("_");
        const of = series.find((e) => e.id === seriesId);
        const when = of && instanceStart(of, instance);
        if (of && when) out.push({ ...of, id: w.id, recurrence: undefined, recurringEventId: of.id, originalStartTime: when.start, ...when, description: w.description });
      }
    }
    return out;
  }

  async calendars() {
    await this.token();
    return CALENDARS;
  }

  async changes(calendar: string, syncToken: string | null) {
    await this.token();
    const version = this.written(calendar).reduce((n, w) => Math.max(n, w.version), 0);
    const since = syncToken?.match(/^mock:(\d+)$/) ? Number(syncToken.slice(5)) : null;
    const changed = new Set(this.written(calendar).filter((w) => since === null || w.version > since).map((w) => w.id));
    const events = this.all(calendar).filter((e) => since === null || changed.has(e.id));
    const cal = CALENDARS.find((c) => c.id === calendar);
    return { events, syncToken: `mock:${version}`, zone: cal?.timeZone ?? null, name: cal?.summary ?? null };
  }

  async event(calendar: string, eventId: string) {
    await this.token();
    const found = this.all(calendar).find((e) => e.id === eventId);
    if (found) return found;
    const [seriesId, instance] = eventId.split("_");
    const of = (EVENTS[calendar] ?? []).find((e) => e.id === seriesId);
    const when = of && instanceStart(of, instance ?? "");
    if (!of || !when) throw new Error("feed:Google Calendar: that event isn't there any more");
    return { ...of, id: eventId, recurrence: undefined, recurringEventId: of.id, originalStartTime: when.start, ...when };
  }

  async describe(calendar: string, eventId: string, description: string) {
    await this.token();
    if (!this.db) throw new Error("feed:Google Calendar: can't write here");
    const version = this.written(calendar).reduce((n, w) => Math.max(n, w.version), 0) + 1;
    this.db.run(
      "INSERT INTO google_mock(calendar, id, description, version) VALUES (?,?,?,?) ON CONFLICT(calendar, id) DO UPDATE SET description = excluded.description, version = excluded.version",
      calendar, eventId, description, version,
    );
  }
}
