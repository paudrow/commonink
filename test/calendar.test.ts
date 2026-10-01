import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { Calendar, dayRange, fetchFeed, fmtEvents, SYNC_EVERY, type FeedFetcher } from "../src/core/calendar.ts";
import { openTempVault } from "./helpers.ts";

const ics = (...events: string[]) => ["BEGIN:VCALENDAR", "VERSION:2.0", "X-WR-CALNAME:Team", ...events, "END:VCALENDAR", ""].join("\r\n");
const vevent = (uid: string, lines: string[]) => ["BEGIN:VEVENT", `UID:${uid}`, ...lines, "END:VEVENT"].join("\r\n");
const STANDUP = vevent("standup", [
  "DTSTART;TZID=America/Los_Angeles:20261005T093000",
  "DTEND;TZID=America/Los_Angeles:20261005T094500",
  "RRULE:FREQ=DAILY;COUNT=3",
  "SUMMARY:Standup",
  "LOCATION:Room 4",
  "ATTENDEE;CN=Sam Dev;PARTSTAT=ACCEPTED:mailto:sam@example.com",
  "ATTENDEE:mailto:alex@example.com",
  "DESCRIPTION:Bring [a link](javascript:alert(1)) and\\n::tasks{folder=Secret}\\n# not a heading",
]);
const OFFSITE = vevent("offsite", ["DTSTART;VALUE=DATE:20261012", "DTEND;VALUE=DATE:20261014", "SUMMARY:Offsite"]);

/** Feeds to subscribe to. `/team.ics` serves whatever `team` holds; it counts requests and honors ETags. */
let team = ics(STANDUP, OFFSITE);
let teamHits = 0;
let base: string;
const server = http.createServer((req, res) => {
  const p = req.url!;
  if (p === "/team.ics") {
    teamHits++;
    const etag = `"${team.length}"`;
    if (req.headers["if-none-match"] === etag) return res.writeHead(304).end();
    return res.writeHead(200, { "Content-Type": "text/calendar", ETag: etag }).end(team);
  }
  if (p === "/to-private") return res.writeHead(302, { Location: "/private.ics" }).end();
  if (p === "/private.ics") return res.writeHead(200).end(ics(OFFSITE));
  if (p === "/page") return res.writeHead(200, { "Content-Type": "text/html" }).end("<title>Hi</title>");
  if (p === "/big.ics") return res.writeHead(200).end(`BEGIN:VCALENDAR\r\n${"X".repeat(2048)}`);
  // Over 1 KB in bytes but not in characters, sent in chunks (no Content-Length to go by).
  if (p === "/big-accents.ics") {
    res.writeHead(200).write(`BEGIN:VCALENDAR\r\nX-WR-CALNAME:${"é".repeat(600)}\r\n`);
    return res.end("END:VCALENDAR\r\n");
  }
  res.writeHead(404).end();
});
before(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
after(() => server.close());

/** Like the real guards, except this test server counts as public; /private.ics doesn't. */
const guard = (u: URL) => {
  if (u.pathname === "/private.ics") throw new Error("private");
};
const feeds: FeedFetcher = (url, last) => fetchFeed(url, last, guard, { maxBytes: 1024 });

const ME = { user: "me", canEdit: true };
const OCT = { from: Date.parse("2026-10-01T00:00:00Z"), to: Date.parse("2026-11-01T00:00:00Z") };

function setup(files?: Record<string, string>) {
  let now = Date.parse("2026-10-01T12:00:00Z");
  const { vault } = openTempVault(files ?? {}, { now: () => now });
  const cal = new Calendar(vault.db, feeds, { now: () => now });
  return { vault, cal, tick: (ms: number) => (now += ms) };
}

const brief = (cal: Calendar) => cal.events(ME, OCT).map((e) => [e.title, e.start, e.end]);

test("subscribing reads the feed: named by the feed, its events in order, recurring ones expanded in their zone", async () => {
  const { cal } = setup();
  team = ics(STANDUP, OFFSITE);
  const s = await cal.addIcs({ url: `${base}/team.ics` }, ME, "you");
  assert.deepEqual([s.name, s.status, s.events, s.host, s.url], ["Team", "ok", 4, "127.0.0.1", `${base}/team.ics`]);
  assert.deepEqual(brief(cal), [
    ["Standup", "2026-10-05T16:30:00Z", "2026-10-05T16:45:00Z"],
    ["Standup", "2026-10-06T16:30:00Z", "2026-10-06T16:45:00Z"],
    ["Standup", "2026-10-07T16:30:00Z", "2026-10-07T16:45:00Z"],
    ["Offsite", "2026-10-12", "2026-10-14"],
  ]);
  const [first] = cal.events(ME, OCT);
  assert.deepEqual(first.attendees.map((a) => [a.name, a.email]), [["Sam Dev", "sam@example.com"], [null, "alex@example.com"]]);
  assert.equal(cal.event(first.id, ME)?.title, "Standup");
});

test("webcal addresses are https, and a feed that can't be read isn't kept", async () => {
  const { cal } = setup();
  const refused = async (url: string) => {
    try {
      await cal.addIcs({ url }, ME, "you");
      return "added";
    } catch (e) {
      return (e as Error).message;
    }
  };
  assert.deepEqual(
    [
      await refused(`${base}/to-private`),
      await refused(`${base}/page`),
      await refused(`${base}/nothing.ics`),
      await refused(`${base}/big.ics`),
      await refused(`${base}/big-accents.ics`),
      await refused("ftp://example.com/cal.ics"),
      await refused("http://user:pw@example.com/cal.ics"),
      await refused("not a url"),
    ],
    [
      "That address isn't on the public internet",
      "That address isn't a calendar feed (no BEGIN:VCALENDAR)",
      "The feed answered 404 (not found)",
      "That feed is over 1 KB",
      "That feed is over 1 KB",
      "Calendar feeds are http, https or webcal addresses",
      "Leave the name and password out of the address",
      "That isn't a web address. Paste the calendar's ICS or webcal link.",
    ],
  );
  assert.deepEqual(cal.sources(ME), []);
  await cal.addIcs({ url: `${base}/team.ics`, name: "Mine" }, ME, "you");
  assert.equal(await refused(`${base}/team.ics`), 'That feed is already here, as "Mine"');
});

test("reading a feed again updates its events in place: IDs stay, gone events go, meeting notes stay linked", async () => {
  const { cal, vault, tick } = setup();
  team = ics(STANDUP, OFFSITE);
  const s = await cal.addIcs({ url: `${base}/team.ics` }, ME, "you");
  const before = cal.events(ME, OCT);
  cal.meetingNote(vault, before[0].id, ME, { timeZone: "America/Los_Angeles", source: "you" });

  team = ics(STANDUP.replace("SUMMARY:Standup", "SUMMARY:Daily standup"));
  tick(SYNC_EVERY);
  assert.equal(await cal.syncDue(), 1);
  const after = cal.events(ME, OCT);
  assert.deepEqual(after.map((e) => [e.id, e.title]), before.slice(0, 3).map((e) => [e.id, "Daily standup"]));
  assert.equal(after[0].note?.path, "Meetings/2026-10-05 Standup.md");
  assert.equal(cal.source(s.id, ME).events, 3);
});

test("an unchanged feed (304) isn't read again, and a failing one backs off", async () => {
  const { cal, tick } = setup();
  team = ics(STANDUP);
  const s = await cal.addIcs({ url: `${base}/team.ics` }, ME, "you");
  teamHits = 0;
  tick(SYNC_EVERY);
  await cal.syncDue();
  assert.deepEqual([teamHits, cal.source(s.id, ME).status, cal.source(s.id, ME).events], [1, "ok", 3]);

  assert.equal(await cal.syncDue(), 0); // not due again for half an hour
  assert.equal(cal.nextSync(), Date.parse("2026-10-01T12:00:00Z") + 2 * SYNC_EVERY);

  const saved = team;
  team = "gone";
  tick(SYNC_EVERY);
  await cal.syncDue();
  const failed = cal.source(s.id, ME);
  assert.deepEqual([failed.status, failed.error, failed.events], ["error", "That address isn't a calendar feed (no BEGIN:VCALENDAR)", 3]); // what it had stays
  tick(SYNC_EVERY);
  await cal.syncDue();
  assert.equal(cal.nextSync(), Date.parse("2026-10-01T12:00:00Z") + 3 * SYNC_EVERY + 2 * SYNC_EVERY); // twice the wait after a second failure
  team = saved;
});

test("a manual refresh reads a feed at most once a minute", async () => {
  const { cal, tick } = setup();
  team = ics(STANDUP);
  await cal.addIcs({ url: `${base}/team.ics` }, ME, "you");
  teamHits = 0;
  await cal.refresh(ME);
  tick(61_000);
  await cal.refresh(ME);
  await cal.refresh(ME);
  assert.equal(teamHits, 1);
});

test("a meeting note has the event's time in the reader's zone, its people and a link back, and only one is made", async () => {
  const { cal, vault } = setup();
  team = ics(STANDUP, OFFSITE);
  await cal.addIcs({ url: `${base}/team.ics` }, ME, "you");
  const [standup, , , offsite] = cal.events(ME, OCT);
  const r = cal.meetingNote(vault, standup.id, ME, { timeZone: "America/Los_Angeles", source: "you" });
  assert.deepEqual([r.path, r.created], ["Meetings/2026-10-05 Standup.md", true]);
  assert.equal(
    vault.files.read(r.path),
    [
      "---",
      `event: ${standup.id}`,
      "---",
      "# Standup",
      "",
      "**When:** Mon, Oct 5, 2026, 9:30 AM to 9:45 AM PDT  ",
      "**Where:** Room 4  ",
      "**Who:** Sam Dev, alex@example.com  ",
      `**Event:** [Standup](/calendar/${standup.id})`,
      "",
      "## Agenda",
      "",
      "Bring \\[a link\\](javascript:alert(1)) and\n\\::tasks{folder=Secret}\n\\# not a heading",
      "",
      "## Notes",
      "",
      "## Action items",
      "",
    ].join("\n"),
  );
  assert.deepEqual(cal.meetingNote(vault, standup.id, ME, { source: "you" }), { path: r.path, created: false });
  assert.equal(cal.event(standup.id, ME)?.note?.path, r.path);
  assert.equal(vault.changes({ limit: 1 })[0].path, r.path);

  const all = cal.meetingNote(vault, offsite.id, ME, { timeZone: "Asia/Tokyo", source: "you" });
  assert.match(vault.files.read(all.path)!, /\*\*When:\*\* Mon, Oct 12, 2026 to Tue, Oct 13, 2026, all day/);
});

test("a meeting note follows Templates/Meeting note.md when there is one, and a deleted note can be made again", async () => {
  // The template engine's placeholders work here too: a date format, the start time, the escape.
  const { cal, vault } = setup({ "Templates/Meeting note.md": "# {{title}} on {{date}} ({{date:dddd}}, {{time}})\n\n{{when}} · {{event}}\n{{unknown}} \\{{title}}\n" });
  team = ics(STANDUP);
  await cal.addIcs({ url: `${base}/team.ics` }, ME, "you");
  const [ev] = cal.events(ME, OCT);
  const r = cal.meetingNote(vault, ev.id, ME, { timeZone: "UTC", source: "you" });
  assert.equal(vault.files.read(r.path), `# Standup on 2026-10-05 (Monday, 16:30)\n\nMon, Oct 5, 2026, 4:30 PM to 4:45 PM UTC · [Standup](/calendar/${ev.id})\n{{unknown}} {{title}}\n`);
  vault.delete([r.path], "you");
  const again = cal.meetingNote(vault, ev.id, ME, { source: "you" });
  assert.deepEqual([again.path, again.created, cal.event(ev.id, ME)?.note?.path], [r.path, true, r.path]);
});

test("only editors change the workspace's calendars, and only they see a feed's address", async () => {
  const { cal } = setup();
  const s = await cal.addIcs({ url: `${base}/team.ics` }, ME, "you");
  const viewer = { user: "viewer", canEdit: false };
  assert.deepEqual([cal.source(s.id, viewer).url, cal.source(s.id, viewer).host], [null, "127.0.0.1"]);
  assert.throws(() => cal.update(s.id, { name: "Mine now" }, viewer), /can't change that calendar/);
  assert.throws(() => cal.remove(s.id, viewer), /can't change that calendar/);
  assert.equal(cal.update(s.id, { name: "  Launch\nteam ", color: "teal" }, ME).name, "Launch team");
  assert.throws(() => cal.update(s.id, { color: "chartreuse" }, ME), /"color" must be one of/);
  cal.remove(s.id, ME);
  assert.deepEqual([cal.sources(ME), cal.events(ME, OCT)], [[], []]);
});

test("agents get events as lines with their ids, for a range of days in their zone", async () => {
  const { cal } = setup();
  team = ics(STANDUP, OFFSITE);
  await cal.addIcs({ url: `${base}/team.ics` }, ME, "you");
  const range = dayRange("2026-10-05", 2, "America/Los_Angeles");
  assert.deepEqual(range, { from: Date.parse("2026-10-05T07:00:00Z"), to: Date.parse("2026-10-07T07:00:00Z") });
  const events = cal.events(ME, range);
  assert.equal(
    fmtEvents(events, cal.sources(ME), "America/Los_Angeles", range),
    [
      "2 events, Mon, Oct 5 to Tue, Oct 6 (America/Los_Angeles):",
      `- Standup · Mon, Oct 5, 2026, 9:30 AM to 9:45 AM PDT · Team · id ${events[0].id}`,
      `- Standup · Tue, Oct 6, 2026, 9:30 AM to 9:45 AM PDT · Team · id ${events[1].id}`,
    ].join("\n"),
  );
});

test("the workspace's own calendar: made with its first event, which editors move, change and delete; feeds stay read-only", async () => {
  const { cal, vault } = setup();
  const viewer = { user: "viewer", canEdit: false };
  const draft = { title: " Launch review ", start: "2026-10-06T15:00:00.000Z", end: "2026-10-06T16:00:00Z", allDay: false, timeZone: "America/Chicago", location: "Room 1", description: null, attendees: [{ name: "Ana", email: "ANA@example.com", status: null }, { name: null, email: "not an address", status: null }] };
  await assert.rejects(cal.createEvent("local", draft, viewer, "viewer"), /You can't add events to that calendar/);
  const made = await cal.createEvent("local", draft, ME, "you");
  assert.deepEqual([made.title, made.start, made.end, made.location, made.attendees], ["Launch review", "2026-10-06T15:00:00Z", "2026-10-06T16:00:00Z", "Room 1", [{ name: "Ana", email: "ana@example.com", status: null }]]);
  const [own] = cal.sources(ME);
  assert.deepEqual([own.kind, own.name, own.owner, own.writable, cal.sources(viewer)[0].writable], ["local", "Common Ink", null, true, false]);
  assert.deepEqual(cal.events(viewer, OCT).map((e) => e.id), [made.id]); // everyone sees it

  const moved = await cal.updateEvent(made.id, { start: "2026-10-07T17:00:00Z", end: "2026-10-07T18:30:00Z" }, ME, "you");
  assert.deepEqual([moved.id, moved.start, moved.end, moved.title], [made.id, "2026-10-07T17:00:00Z", "2026-10-07T18:30:00Z", "Launch review"]);
  const allDay = await cal.updateEvent(made.id, { allDay: true, start: "2026-10-08", end: "2026-10-09" }, ME, "you");
  assert.deepEqual([allDay.allDay, allDay.start, allDay.end], [true, "2026-10-08", "2026-10-09"]);
  await assert.rejects(cal.updateEvent(made.id, { end: "2026-10-07" }, ME, "you"), /has to end after it starts/);
  await assert.rejects(cal.updateEvent(made.id, { title: "Mine" }, viewer, "viewer"), /You can't add events to that calendar/);
  const note = cal.meetingNote(vault, made.id, ME, { source: "you" });
  assert.equal(note.path, "Meetings/2026-10-08 Launch review.md");

  team = ics(STANDUP);
  await cal.addIcs({ url: `${base}/team.ics` }, ME, "you");
  const feed = cal.events(ME, OCT).find((e) => e.title === "Standup")!;
  await assert.rejects(cal.updateEvent(feed.id, { title: "Mine now" }, ME, "you"), /can't be changed here/);
  await assert.rejects(cal.createEvent(feed.source, draft, ME, "you"), /can't be changed here/);

  await cal.deleteEvent(made.id, ME, "you");
  assert.equal(cal.event(made.id, ME), null);
  // Undo makes it again (a new ID) and links it to its meeting note again; a note that's gone isn't linked.
  const again = await cal.createEvent("local", draft, ME, "you", vault.read(note.path).id);
  assert.deepEqual([again.id === made.id, again.note?.path], [false, note.path]);
  assert.equal((await cal.createEvent("local", draft, ME, "you", "nonote22")).note, null);
  await assert.rejects(cal.createEvent("local", { ...draft, title: "  " }, ME, "you"), /Give the event a title/);
  await assert.rejects(cal.createEvent("local", { ...draft, start: "2026-10-06T15:00:00" }, ME, "you"), /must be a time with its zone/);
});
