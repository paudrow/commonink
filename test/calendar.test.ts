import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { Calendar, dayRange, fetchFeed, fmtEvents, SYNC_EVERY, type FeedFetcher, type NoteWrite } from "../src/core/calendar.ts";
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
  const cal = new Calendar(vault.db, feeds, { now: () => now, vault });
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

test("searching events ignores case, accented letters too", async () => {
  const { cal } = setup();
  const sync = (uid: string, day: string, title: string) => vevent(uid, [`DTSTART:202610${day}T150000Z`, `DTEND:202610${day}T153000Z`, `SUMMARY:${title}`]);
  team = ics(STANDUP, OFFSITE, sync("e1", "08", "Équipe Sync"), sync("e2", "09", "ÉQUIPE planning"), sync("e3", "10", "Café"));
  await cal.addIcs({ url: `${base}/team.ics` }, ME, "you");
  const titles = (q: string, limit?: number) => cal.events(ME, { ...OCT, q, limit }).map((e) => e.title);
  assert.deepEqual(titles("équipe"), ["Équipe Sync", "ÉQUIPE planning"]);
  assert.deepEqual(titles("Équipe"), ["Équipe Sync", "ÉQUIPE planning"]);
  assert.deepEqual(titles("équipe", 1), ["Équipe Sync"]);
  assert.deepEqual(titles("SYNC"), ["Équipe Sync"]);
  assert.deepEqual(titles("standup", 2), ["Standup", "Standup"]);
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

test("two events sharing a UID both show, and the one already there keeps its ID", async () => {
  const { cal, tick } = setup();
  const copy = (day: string, title: string) => vevent("dup", [`DTSTART:202610${day}T150000Z`, `DTEND:202610${day}T153000Z`, `SUMMARY:${title}`]);
  team = ics(copy("09", "Review"));
  await cal.addIcs({ url: `${base}/team.ics` }, ME, "you");
  const [review] = cal.events(ME, OCT);

  team = ics(copy("08", "Review prep"), copy("09", "Review"));
  tick(SYNC_EVERY);
  assert.equal(await cal.syncDue(), 1);
  const both = cal.events(ME, OCT);
  assert.deepEqual(both.map((e) => e.title), ["Review prep", "Review"]);
  assert.equal(both[1].id, review.id);
  assert.notEqual(both[0].id, review.id);
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

test("the workspace's own events are notes in Events/: made, moved, renamed and deleted through the vault", async () => {
  const { cal, vault } = setup();
  const draft = { title: "Launch review", start: "2026-10-06T15:00:00Z", end: "2026-10-06T16:00:00Z", allDay: false, timeZone: "America/Chicago", location: "Room 1: north", description: "Bring the numbers.", attendees: [{ name: "Ana", email: "ana@example.com", status: null }, { name: null, email: "sam@example.com", status: null }] };
  const writes: NoteWrite[] = [];
  const made = await cal.createEvent("local", draft, ME, "you", undefined, writes);
  const rel = "Events/2026-10-06 Launch review.md";
  assert.deepEqual(writes.map((w) => [w.op, w.path]), [["written", rel]]);
  assert.equal(
    vault.read(rel).content,
    ["---", "start: 2026-10-06T10:00-05:00", "end: 2026-10-06T11:00-05:00", 'where: "Room 1: north"', "attendees:", "  - Ana <ana@example.com>", "  - sam@example.com", "---", "# Launch review", "", "Bring the numbers.", ""].join("\n"),
  );
  assert.deepEqual(made.file, { id: vault.read(rel).id, path: rel });
  assert.deepEqual([made.title, made.start, made.end, made.location, made.description], ["Launch review", "2026-10-06T15:00:00Z", "2026-10-06T16:00:00Z", "Room 1: north", "Bring the numbers."]);
  assert.equal(vault.changes({ path: rel })[0].source, "you");

  // Words added under the title stay when the event moves; the note keeps the offset it's written in.
  vault.append(rel, "## Notes\n\n- agreed on Friday", "you");
  const moved = await cal.updateEvent(made.id, { start: "2026-10-06T17:00:00Z", end: "2026-10-06T18:30:00Z" }, ME, "you");
  assert.equal(moved.id, made.id);
  assert.match(vault.read(rel).content, /^---\nstart: 2026-10-06T12:00-05:00\nend: 2026-10-06T13:30-05:00\n[\s\S]*Bring the numbers\.\n\n## Notes\n\n- agreed on Friday\n$/);

  // A new title or day renames a note named after them, links to it and all; its ID, and so the event's, stay.
  vault.create("Plan.md", "See [[2026-10-06 Launch review]].\n", "you");
  const renamed: NoteWrite[] = [];
  const again = await cal.updateEvent(made.id, { title: "Launch go/no-go", start: "2026-10-07T15:00:00Z", end: "2026-10-07T16:00:00Z", timeZone: "America/Chicago" }, ME, "you", renamed);
  const next = "Events/2026-10-07 Launch go no-go.md";
  assert.deepEqual([again.id, again.title, again.file?.path], [made.id, "Launch go/no-go", next]);
  assert.deepEqual(renamed.map((w) => w.op), ["written", "moved"]);
  assert.match(vault.read(next).content, /# Launch go\/no-go\n\nBring the numbers\./);
  assert.equal(vault.read("Plan.md").content, "See [[2026-10-07 Launch go no-go]].\n");
  // One someone named themselves keeps its name.
  vault.move(next, "Events/Go-no-go.md", "you");
  assert.equal((await cal.updateEvent(made.id, { title: "Go/no-go" }, ME, "you")).file?.path, "Events/Go-no-go.md");

  const gone: NoteWrite[] = [];
  await cal.deleteEvent(made.id, ME, "you", gone);
  assert.deepEqual(gone.map((w) => [w.op, w.path]), [["removed", "Events/Go-no-go.md"]]);
  assert.equal(cal.event(made.id, ME), null);
  assert.equal(vault.trash().length, 1); // in Trash, where it can come back
});

test("a note written in Events/ is an event: agents make them with the note tools, in any of the ways people write times", async () => {
  const { cal, vault } = setup();
  assert.deepEqual(cal.sources(ME), []);
  vault.create("Events/2026-10-05 Dentist.md", '---\nstart: 2026-10-05 14:00\nend: 15:30\nlocation: Main St\nattendees: ["[[People/Jane Doe]]", Bo <BO@x.org>]\n---\n', "Claude\u001fyou");
  vault.create("Events/Offsite.md", "---\nall_day: true\nstart: 2026-10-12\nend: 2026-10-13\n---\n# Team offsite\n", "you");
  vault.create("Events/Quick call.md", "---\nstart: 2026-10-08T09:00Z\n---\nAbout the launch.\n", "you");
  vault.create("Events/README.md", "What goes here: one note per event.\n", "you");
  const [own] = cal.sources(ME);
  assert.deepEqual([own.kind, own.name, own.events], ["local", "Common Ink", 3]);
  assert.throws(() => cal.remove(own.id, ME), /events are notes in Events\/: delete those/);
  const evs = cal.events(ME, OCT);
  assert.deepEqual(evs.map((e) => [e.title, e.start, e.end, e.allDay]), [
    ["Dentist", "2026-10-05T14:00:00", "2026-10-05T15:30:00", false], // no zone: that time wherever the reader is
    ["Quick call", "2026-10-08T09:00:00Z", "2026-10-08T10:00:00Z", false], // an hour, with no end
    ["Team offsite", "2026-10-12", "2026-10-14", true], // the end day is the last day
  ]);
  assert.deepEqual([evs[0].location, evs[0].attendees.map((a) => [a.name, a.email])], ["Main St", [["Jane Doe", null], ["Bo", "bo@x.org"]]]);
  assert.equal(evs[1].description, "About the launch.");

  // Changing the note changes the event, keeping its ID; a note that stops being an event takes it away.
  const dentist = evs[0].id;
  vault.edit("Events/2026-10-05 Dentist.md", { oldString: "14:00", newString: "13:00" }, "you");
  assert.equal(cal.event(dentist, ME)?.start, "2026-10-05T13:00:00");
  vault.move("Events/2026-10-05 Dentist.md", "Events/Health/Dentist.md", "you");
  assert.equal(cal.event(dentist, ME)?.file?.path, "Events/Health/Dentist.md");
  vault.edit("Events/Health/Dentist.md", { oldString: "start:", newString: "started:" }, "you");
  assert.equal(cal.event(dentist, ME), null);
  vault.delete(["Events/Offsite.md"], "you");
  assert.deepEqual(cal.events(ME, OCT).map((e) => e.title), ["Quick call"]);
});

test("events kept in the database before they were notes are written out as notes once, keeping their IDs and meeting notes", async () => {
  const { vault } = setup();
  const now = () => Date.parse("2026-10-01T12:00:00Z");
  // The workspace's calendar as it was kept before: a source, and its events as rows.
  new Calendar(vault.db, feeds, { now });
  vault.db.run("INSERT INTO sources(id, kind, owner, name, color, config, status, next_sync, created_by, created_at) VALUES ('loc','local',NULL,'Common Ink','blue','{}','ok',0,'you',0)");
  const ms = (t: string) => Date.parse(t.length === 10 ? `${t}T00:00:00Z` : t);
  const row = (id: string, title: string, start: string, end: string, d: object) =>
    vault.db.run(
      "INSERT INTO external_items(id, source, kind, title, start, end, start_ms, end_ms, abs, data, hash) VALUES (?,?,?,?,?,?,?,?,?,?,'')",
      id, "loc", "event", title, start, end, ms(start), ms(end), start.length === 10 ? 0 : 1,
      JSON.stringify({ allDay: start.length === 10, timeZone: "America/Los_Angeles", location: null, description: null, url: null, organizer: null, attendees: [], status: "confirmed", recurring: false, uid: id, instance: null, ...d }),
    );
  row("aaaaaaaaaaaa", "Standup", "2026-10-05T16:30:00Z", "2026-10-05T16:45:00Z", { location: "Zoom", description: "Daily." });
  row("bbbbbbbbbbbb", "Offsite", "2026-10-12", "2026-10-14", {});
  const meeting = vault.create("Meetings/2026-10-05 Standup.md", "[Standup](/calendar/aaaaaaaaaaaa)\n", "you");
  vault.db.run("UPDATE external_items SET note_id = ? WHERE id = 'aaaaaaaaaaaa'", meeting.id);

  const cal = new Calendar(vault.db, feeds, { now, vault });
  assert.equal(vault.read("Events/2026-10-05 Standup.md").content, "---\nstart: 2026-10-05T09:30-07:00\nend: 2026-10-05T09:45-07:00\nwhere: Zoom\n---\n# Standup\n\nDaily.\n");
  assert.equal(vault.read("Events/2026-10-12 Offsite.md").content, "---\nall_day: true\nstart: 2026-10-12\nend: 2026-10-13\n---\n# Offsite\n");
  assert.deepEqual(vault.changes({ path: "Events/2026-10-12 Offsite.md" }).map((c) => c.source), ["Common Ink"]);
  const standup = cal.event("aaaaaaaaaaaa", ME)!;
  assert.deepEqual([standup.title, standup.start, standup.location, standup.note?.path, standup.file?.path], ["Standup", "2026-10-05T16:30:00Z", "Zoom", meeting.path, "Events/2026-10-05 Standup.md"]);
  assert.deepEqual(cal.events(ME, OCT).map((e) => e.id), ["aaaaaaaaaaaa", "bbbbbbbbbbbb"]);

  // Again (another process opening the vault): nothing new.
  new Calendar(vault.db, feeds, { now, vault });
  assert.deepEqual(vault.list("Events").map((n) => n.path).sort(), ["Events/2026-10-05 Standup.md", "Events/2026-10-12 Offsite.md"]);
  // A run that wrote a note and stopped before recording it: the next takes that note rather than writing another.
  row("cccccccccccc", "Review", "2026-10-09T18:00:00Z", "2026-10-09T19:00:00Z", {});
  vault.create("Events/2026-10-09 Review.md", "---\nstart: 2026-10-09T11:00-07:00\nend: 2026-10-09T12:00-07:00\n---\n# Review\n", "Common Ink");
  const third = new Calendar(vault.db, feeds, { now, vault });
  assert.equal(vault.list("Events").length, 3);
  assert.deepEqual(third.events(ME, OCT).map((e) => e.id), ["aaaaaaaaaaaa", "cccccccccccc", "bbbbbbbbbbbb"]);
});
