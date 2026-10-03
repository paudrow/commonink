import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { looksLikeIcs, readIcs, WINDOWS_ZONES, type Occurrence } from "../src/core/ics.ts";
import { cpuMs } from "./helpers.ts";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/ics/${name}`, import.meta.url), "utf8");
const cal = (...lines: string[]) => ["BEGIN:VCALENDAR", "VERSION:2.0", ...lines, "END:VCALENDAR"].join("\r\n");
const event = (...lines: string[]) => ["BEGIN:VEVENT", ...lines, "END:VEVENT"].join("\r\n");
const win = (from: string, to: string) => ({ from: new Date(from), to: new Date(to) });
const read = (text: string, from = "2026-09-01T00:00:00Z", to = "2027-01-01T00:00:00Z", limits?: { perEvent?: number; total?: number }) =>
  readIcs(text, win(from, to), limits).events;
const starts = (events: Occurrence[]) => events.map((e) => e.start);
const spans = (events: Occurrence[]) => events.map((e) => [e.start, e.end]);

test("folded lines, escapes, quoted params, people and links read into an occurrence", () => {
  const text =
    "﻿" +
    [
      "BEGIN:VCALENDAR",
      "X-WR-CALNAME:Team\\, Common",
      "X-WR-TIMEZONE:America/New_York",
      "BEGIN:VEVENT",
      "UID:abc@x",
      "DTSTART:20261005T150000Z",
      "DTEND:20261005T160000Z",
      "SUMMARY:  Plan\\, review\\; ship  ",
      "DESCRIPTION:Line one\\nLine two with a long tail that gets fol",
      " ded here\\\\done\\N",
      "\tand a tab fold",
      "LOCATION:Room 1",
      "URL:https://example.com/meet?id=1",
      'ORGANIZER;CN=Bo Li:mailto:BO@X.COM',
      'ATTENDEE;CN="Ng, Alice";PARTSTAT=ACCEPTED:mailto:a@x.com',
      "attendee;cn=Sam;partstat=needs-action:MAILTO:Sam@X.com",
      "ATTENDEE;ROLE=OPT-PARTICIPANT:mailto:noname@x.com",
      "STATUS:TENTATIVE",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\n");
  const { feed, events } = readIcs(text, win("2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z"));
  assert.deepEqual(feed, { name: "Team, Common", timeZone: "America/New_York" });
  assert.deepEqual(events, [
    {
      uid: "abc@x",
      recurrenceId: null,
      start: "2026-10-05T15:00:00Z",
      end: "2026-10-05T16:00:00Z",
      allDay: false,
      timeZone: null,
      title: "Plan, review; ship",
      location: "Room 1",
      description: "Line one\nLine two with a long tail that gets folded here\\done\nand a tab fold",
      url: "https://example.com/meet?id=1",
      organizer: { name: "Bo Li", email: "bo@x.com", status: null },
      attendees: [
        { name: "Ng, Alice", email: "a@x.com", status: "accepted" },
        { name: "Sam", email: "sam@x.com", status: "needs-action" },
        { name: null, email: "noname@x.com", status: null },
      ],
      status: "tentative",
      recurring: false,
    },
  ]);
});

test("a missing title, a non-web URL and a missing UID get safe values", () => {
  const text = cal(event("DTSTART:20261005T150000Z", "URL:javascript:alert(1)"), event("DTSTART:20261005T150000Z", "SUMMARY:Same", "URL:not a url"));
  const events = read(text);
  assert.deepEqual(
    events.map((e) => [e.title, e.url]),
    [["(No title)", null], ["Same", null]],
  );
  assert.match(events[0].uid, /^[0-9a-f]{16}@common-ink$/);
  assert.notEqual(events[0].uid, events[1].uid);
  assert.equal(read(text)[1].uid, events[1].uid, "a synthesized UID is stable across reads");
});

test("an alarm's properties stay out of its event", () => {
  const text = cal(event("UID:a", "BEGIN:VALARM", "ACTION:DISPLAY", "SUMMARY:Alarm", "DESCRIPTION:Reminder", "TRIGGER:-PT10M", "END:VALARM", "DTSTART:20261005T150000Z"));
  assert.deepEqual(read(text).map((e) => [e.title, e.description]), [["(No title)", null]]);
});

test("all-day, multi-day, timed UTC, floating, DURATION and missing ends", () => {
  const text = cal(
    event("UID:a", "SUMMARY:One day", "DTSTART;VALUE=DATE:20261010"),
    event("UID:b", "SUMMARY:Three days", "DTSTART;VALUE=DATE:20261012", "DTEND;VALUE=DATE:20261015"),
    event("UID:c", "SUMMARY:Floating", "DTSTART:20261020T090000", "DTEND:20261020T100000"),
    event("UID:d", "SUMMARY:No end", "DTSTART:20261021T090000Z"),
    event("UID:e", "SUMMARY:Ninety minutes", "DTSTART:20261022T090000Z", "DURATION:PT1H30M"),
    event("UID:f", "SUMMARY:A week", "DTSTART;VALUE=DATE:20261101", "DURATION:P1W"),
    event("UID:g", "SUMMARY:Negative", "DTSTART:20261023T090000Z", "DURATION:-PT1H"),
    event("UID:h", "SUMMARY:A day", "DTSTART:20261024T090000Z", "DURATION:P1D"),
  );
  assert.deepEqual(
    read(text).map((e) => [e.uid, e.start, e.end, e.allDay, e.timeZone]),
    [
      ["a", "2026-10-10", "2026-10-11", true, null],
      ["b", "2026-10-12", "2026-10-15", true, null],
      ["c", "2026-10-20T09:00:00", "2026-10-20T10:00:00", false, null],
      ["d", "2026-10-21T09:00:00Z", "2026-10-21T09:00:00Z", false, null],
      ["e", "2026-10-22T09:00:00Z", "2026-10-22T10:30:00Z", false, null],
      ["g", "2026-10-23T09:00:00Z", "2026-10-23T09:00:00Z", false, null],
      ["h", "2026-10-24T09:00:00Z", "2026-10-25T09:00:00Z", false, null],
      ["f", "2026-11-01", "2026-11-08", true, null],
    ],
  );
});

test("a weekly 09:00 Los Angeles meeting stays at 09:00 local across the DST change", () => {
  const text = cal(
    event(
      "UID:weekly",
      "SUMMARY:Standup",
      "DTSTART;TZID=America/Los_Angeles:20261020T090000",
      "DTEND;TZID=America/Los_Angeles:20261020T100000",
      "RRULE:FREQ=WEEKLY;COUNT=4",
    ),
  );
  const events = read(text);
  assert.deepEqual(spans(events), [
    ["2026-10-20T16:00:00Z", "2026-10-20T17:00:00Z"],
    ["2026-10-27T16:00:00Z", "2026-10-27T17:00:00Z"],
    ["2026-11-03T17:00:00Z", "2026-11-03T18:00:00Z"],
    ["2026-11-10T17:00:00Z", "2026-11-10T18:00:00Z"],
  ]);
  assert.deepEqual(
    events.map((e) => [e.recurrenceId, e.timeZone, e.recurring]),
    [
      ["20261020T160000Z", "America/Los_Angeles", true],
      ["20261027T160000Z", "America/Los_Angeles", true],
      ["20261103T170000Z", "America/Los_Angeles", true],
      ["20261110T170000Z", "America/Los_Angeles", true],
    ],
  );
});

test("a local time in the spring gap moves forward and one in the fall overlap takes the earlier instant", () => {
  const text = cal(
    event("UID:gap", "DTSTART;TZID=America/Los_Angeles:20260308T023000"),
    event("UID:overlap", "DTSTART;TZID=America/Los_Angeles:20261101T013000"),
  );
  assert.deepEqual(starts(read(text, "2026-01-01T00:00:00Z")), ["2026-03-08T10:30:00Z", "2026-11-01T08:30:00Z"]);
});

test("Windows, prefixed and quoted TZIDs map to IANA zones", () => {
  const text = cal(
    event("UID:w", 'DTSTART;TZID="W. Europe Standard Time":20261024T100000', "DTEND;TZID=W. Europe Standard Time:20261024T110000", "RRULE:FREQ=WEEKLY;COUNT=2"),
    event("UID:m", "DTSTART;TZID=/mozilla.org/20050126_1/America/New_York:20261005T090000"),
    event("UID:t", "DTSTART;TZID=Tokyo Standard Time:20261006T090000"),
    event("UID:i", "DTSTART;TZID=india standard time:20261007T090000"),
    event("UID:u", "DTSTART;TZID=UTC:20261008T090000"),
  );
  assert.deepEqual(
    read(text).map((e) => [e.uid, e.start, e.timeZone]),
    [
      ["m", "2026-10-05T13:00:00Z", "America/New_York"],
      ["t", "2026-10-06T00:00:00Z", "Asia/Tokyo"],
      ["i", "2026-10-07T03:30:00Z", "Asia/Kolkata"],
      ["u", "2026-10-08T09:00:00Z", "UTC"],
      ["w", "2026-10-24T08:00:00Z", "Europe/Berlin"],
      ["w", "2026-10-31T09:00:00Z", "Europe/Berlin"],
    ],
  );
});

test("every Windows zone in the table is a zone Intl knows", () => {
  const unknown = Object.entries(WINDOWS_ZONES).filter(([, iana]) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: iana });
      return false;
    } catch {
      return true;
    }
  });
  assert.deepEqual(unknown, []);
});

const customZone = [
  "BEGIN:VTIMEZONE",
  "TZID:Custom/Zone",
  "BEGIN:STANDARD",
  "DTSTART:20001001T030000",
  "TZOFFSETFROM:+0300",
  "TZOFFSETTO:+0100",
  "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=1SU",
  "END:STANDARD",
  "BEGIN:DAYLIGHT",
  "DTSTART:20000402T020000",
  "TZOFFSETFROM:+0100",
  "TZOFFSETTO:+0300",
  "RRULE:FREQ=YEARLY;BYMONTH=4;BYDAY=1SU",
  "END:DAYLIGHT",
  "END:VTIMEZONE",
].join("\r\n");

test("a TZID only the feed's own VTIMEZONE defines follows that zone's DST rules", () => {
  const text = cal(
    customZone,
    event("UID:c", "DTSTART;TZID=Custom/Zone:20260920T120000", "DTEND;TZID=Custom/Zone:20260920T130000", "RRULE:FREQ=WEEKLY;COUNT=3"),
    event("UID:gap", "DTSTART;TZID=Custom/Zone:20260405T023000"),
    event("UID:winter", "DTSTART;TZID=Custom/Zone:20260115T120000"),
  );
  assert.deepEqual(
    read(text, "2026-01-01T00:00:00Z").map((e) => [e.uid, e.start, e.end, e.timeZone]),
    [
      ["winter", "2026-01-15T11:00:00Z", "2026-01-15T11:00:00Z", null],
      ["gap", "2026-04-05T01:30:00Z", "2026-04-05T01:30:00Z", null],
      ["c", "2026-09-20T09:00:00Z", "2026-09-20T10:00:00Z", null],
      ["c", "2026-09-27T09:00:00Z", "2026-09-27T10:00:00Z", null],
      ["c", "2026-10-04T11:00:00Z", "2026-10-04T12:00:00Z", null],
    ],
  );
});

test("a VTIMEZONE whose rules ended keeps the offset of its last change", () => {
  const stuck = [
    "BEGIN:VTIMEZONE",
    "TZID:Stuck/Zone",
    "BEGIN:STANDARD",
    "DTSTART:20001001T030000",
    "TZOFFSETFROM:+0300",
    "TZOFFSETTO:+0100",
    "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=1SU;UNTIL=20091004T000000Z",
    "END:STANDARD",
    "BEGIN:DAYLIGHT",
    "DTSTART:20000402T020000",
    "TZOFFSETFROM:+0100",
    "TZOFFSETTO:+0300",
    "RRULE:FREQ=YEARLY;BYMONTH=4;BYDAY=1SU;UNTIL=20100404T010000Z",
    "END:DAYLIGHT",
    "END:VTIMEZONE",
  ].join("\r\n");
  const text = cal(stuck, event("UID:old", "DTSTART;TZID=Stuck/Zone:20090115T120000"), event("UID:now", "DTSTART;TZID=Stuck/Zone:20260115T120000"));
  assert.deepEqual(starts(read(text, "2009-01-01T00:00:00Z")), ["2009-01-15T11:00:00Z", "2026-01-15T09:00:00Z"]);
});

test("an unknown TZID falls back to X-WR-TIMEZONE, then to UTC", () => {
  const unknown = event("UID:x", "DTSTART;TZID=Nowhere/Special:20261001T100000");
  assert.deepEqual(
    read(cal("X-WR-TIMEZONE:Europe/Berlin", unknown)).map((e) => [e.start, e.timeZone]),
    [["2026-10-01T08:00:00Z", "Europe/Berlin"]],
  );
  assert.deepEqual(
    read(cal(unknown)).map((e) => [e.start, e.timeZone]),
    [["2026-10-01T10:00:00Z", null]],
  );
});

const rule = (dtstart: string, rrule: string, from = "2026-09-01T00:00:00Z", to = "2027-01-01T00:00:00Z") =>
  starts(read(cal(event("UID:r", dtstart, rrule)), from, to));

test("monthly rules: last Friday, second Tuesday, last day and last weekday", () => {
  assert.deepEqual(rule("DTSTART:20260925T170000Z", "RRULE:FREQ=MONTHLY;BYDAY=-1FR"), [
    "2026-09-25T17:00:00Z",
    "2026-10-30T17:00:00Z",
    "2026-11-27T17:00:00Z",
    "2026-12-25T17:00:00Z",
  ]);
  assert.deepEqual(rule("DTSTART;VALUE=DATE:20260908", "RRULE:FREQ=MONTHLY;BYDAY=2TU"), ["2026-09-08", "2026-10-13", "2026-11-10", "2026-12-08"]);
  assert.deepEqual(rule("DTSTART;VALUE=DATE:20260930", "RRULE:FREQ=MONTHLY;BYMONTHDAY=-1", "2026-09-01T00:00:00Z", "2027-03-01T00:00:00Z"), [
    "2026-09-30",
    "2026-10-31",
    "2026-11-30",
    "2026-12-31",
    "2027-01-31",
    "2027-02-28",
  ]);
  assert.deepEqual(rule("DTSTART;VALUE=DATE:20260930", "RRULE:FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1"), ["2026-09-30", "2026-10-30", "2026-11-30", "2026-12-31"]);
  assert.deepEqual(rule("DTSTART;VALUE=DATE:20260131", "RRULE:FREQ=MONTHLY;COUNT=4", "2026-01-01T00:00:00Z"), ["2026-01-31", "2026-03-31", "2026-05-31", "2026-07-31"]);
});

test("yearly rules: the fourth Thursday of November, and Feb 29 only in leap years", () => {
  assert.deepEqual(rule("DTSTART;VALUE=DATE:20261126", "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=4TH", "2026-01-01T00:00:00Z", "2029-01-01T00:00:00Z"), [
    "2026-11-26",
    "2027-11-25",
    "2028-11-23",
  ]);
  assert.deepEqual(rule("DTSTART;VALUE=DATE:20240229", "RRULE:FREQ=YEARLY", "2024-01-01T00:00:00Z", "2033-01-01T00:00:00Z"), ["2024-02-29", "2028-02-29", "2032-02-29"]);
  assert.deepEqual(rule("DTSTART;VALUE=DATE:20260101", "RRULE:FREQ=YEARLY;BYYEARDAY=1,-1;COUNT=3", "2026-01-01T00:00:00Z", "2030-01-01T00:00:00Z"), ["2026-01-01", "2026-12-31", "2027-01-01"]);
});

test("COUNT counts from DTSTART before the window and UNTIL is inclusive", () => {
  assert.deepEqual(rule("DTSTART;VALUE=DATE:20260901", "RRULE:FREQ=DAILY;COUNT=10", "2026-09-05T00:00:00Z"), [
    "2026-09-05",
    "2026-09-06",
    "2026-09-07",
    "2026-09-08",
    "2026-09-09",
    "2026-09-10",
  ]);
  const counted = rule("DTSTART;VALUE=DATE:20260101", "RRULE:FREQ=DAILY;COUNT=300", "2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z");
  assert.deepEqual([counted.length, counted[0], counted.at(-1)], [27, "2026-10-01", "2026-10-27"]);
  assert.deepEqual(rule("DTSTART:20261001T090000Z", "RRULE:FREQ=DAILY;UNTIL=20261003T090000Z"), ["2026-10-01T09:00:00Z", "2026-10-02T09:00:00Z", "2026-10-03T09:00:00Z"]);
  assert.deepEqual(rule("DTSTART;VALUE=DATE:20261001", "RRULE:FREQ=DAILY;UNTIL=20261002"), ["2026-10-01", "2026-10-02"]);
  assert.deepEqual(rule("DTSTART;TZID=America/New_York:20261001T220000", "RRULE:FREQ=DAILY;UNTIL=20261003T020000Z"), ["2026-10-02T02:00:00Z", "2026-10-03T02:00:00Z"]);
});

test("every other week on Tuesday and Sunday depends on WKST (RFC 5545 example)", () => {
  const every = (wkst: string) =>
    rule("DTSTART;TZID=America/New_York:19970805T090000", `RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=4;BYDAY=TU,SU;WKST=${wkst}`, "1997-01-01T00:00:00Z", "1998-01-01T00:00:00Z");
  assert.deepEqual(every("MO"), ["1997-08-05T13:00:00Z", "1997-08-10T13:00:00Z", "1997-08-19T13:00:00Z", "1997-08-24T13:00:00Z"]);
  assert.deepEqual(every("SU"), ["1997-08-05T13:00:00Z", "1997-08-17T13:00:00Z", "1997-08-19T13:00:00Z", "1997-08-31T13:00:00Z"]);
});

test("HOURLY rules and unknown frequencies keep only the first instance", () => {
  assert.deepEqual(rule("DTSTART:20261001T090000Z", "RRULE:FREQ=HOURLY;COUNT=5"), ["2026-10-01T09:00:00Z"]);
  assert.deepEqual(rule("DTSTART:20261001T090000Z", "RRULE:FREQ=FORTNIGHTLY"), ["2026-10-01T09:00:00Z"]);
});

const standup = (...extra: string[]) =>
  event(
    "UID:standup",
    "SUMMARY:Standup",
    "DTSTART;TZID=America/New_York:20261005T090000",
    "DTEND;TZID=America/New_York:20261005T093000",
    "RRULE:FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR;COUNT=5",
    ...extra,
  );

test("EXDATE, RDATE, a moved override and a cancelled override shape the series", () => {
  const text = cal(
    standup("EXDATE;TZID=America/New_York:20261006T090000", "RDATE;TZID=America/New_York:20261010T110000"),
    event("UID:standup", "SUMMARY:Standup (moved)", "RECURRENCE-ID;TZID=America/New_York:20261007T090000", "DTSTART;TZID=America/New_York:20261007T140000", "DTEND;TZID=America/New_York:20261007T143000"),
    event("UID:standup", "SUMMARY:Standup", "RECURRENCE-ID:20261008T130000Z", "DTSTART;TZID=America/New_York:20261008T090000", "STATUS:CANCELLED"),
  );
  assert.deepEqual(
    read(text).map((e) => [e.start, e.end, e.title, e.recurrenceId, e.recurring]),
    [
      ["2026-10-05T13:00:00Z", "2026-10-05T13:30:00Z", "Standup", "20261005T130000Z", true],
      ["2026-10-07T18:00:00Z", "2026-10-07T18:30:00Z", "Standup (moved)", "20261007T130000Z", true],
      ["2026-10-09T13:00:00Z", "2026-10-09T13:30:00Z", "Standup", "20261009T130000Z", true],
      ["2026-10-10T15:00:00Z", "2026-10-10T15:30:00Z", "Standup", "20261010T150000Z", true],
    ],
  );
});

test("an override moved out of the window drops its instance and one moved in shows up", () => {
  const text = cal(
    standup(),
    event("UID:standup", "SUMMARY:Out", "RECURRENCE-ID;TZID=America/New_York:20261006T090000", "DTSTART:20261120T130000Z", "DTEND:20261120T133000Z"),
    event("UID:standup", "SUMMARY:In", "RECURRENCE-ID;TZID=America/New_York:20261009T090000", "DTSTART:20261001T130000Z", "DTEND:20261001T133000Z"),
  );
  assert.deepEqual(
    read(text, "2026-10-01T00:00:00Z", "2026-10-09T00:00:00Z").map((e) => [e.start, e.title]),
    [
      ["2026-10-01T13:00:00Z", "In"],
      ["2026-10-05T13:00:00Z", "Standup"],
      ["2026-10-07T13:00:00Z", "Standup"],
      ["2026-10-08T13:00:00Z", "Standup"],
    ],
  );
});

test("a cancelled master yields nothing, not even its overrides", () => {
  const text = cal(
    standup("STATUS:CANCELLED"),
    event("UID:standup", "RECURRENCE-ID;TZID=America/New_York:20261007T090000", "DTSTART;TZID=America/New_York:20261007T140000"),
    event("UID:other", "SUMMARY:Still here", "DTSTART:20261007T120000Z"),
  );
  assert.deepEqual(read(text).map((e) => e.title), ["Still here"]);
});

test("EXDATE takes several properties, comma lists and dates", () => {
  const text = cal(event("UID:d", "DTSTART;VALUE=DATE:20261001", "RRULE:FREQ=DAILY;COUNT=6", "EXDATE;VALUE=DATE:20261002,20261004", "exdate;value=date:20261003"));
  assert.deepEqual(starts(read(text)), ["2026-10-01", "2026-10-05", "2026-10-06"]);
  const timed = cal(standup("EXDATE:20261006T130000Z,20261007T130000Z", "EXDATE;VALUE=DATE:20261009"));
  assert.deepEqual(starts(read(timed)), ["2026-10-05T13:00:00Z", "2026-10-08T13:00:00Z"]);
});

test("an occurrence overlapping the window start is included; one ending at it is not", () => {
  const text = cal(
    event("UID:over", "SUMMARY:Overnight", "DTSTART:20260930T230000Z", "DTEND:20261001T010000Z"),
    event("UID:ends", "SUMMARY:Ends at start", "DTSTART:20260930T220000Z", "DTEND:20261001T000000Z"),
    event("UID:point", "SUMMARY:At start", "DTSTART:20261001T000000Z"),
    event("UID:later", "SUMMARY:At end", "DTSTART:20261002T000000Z"),
    event("UID:multi", "SUMMARY:Week", "DTSTART;VALUE=DATE:20260928", "DTEND;VALUE=DATE:20261005"),
  );
  assert.deepEqual(read(text, "2026-10-01T00:00:00Z", "2026-10-02T00:00:00Z").map((e) => e.title), ["Week", "Overnight", "At start"]);
});

test("perEvent and total caps bound the output", () => {
  const daily = (uid: string) => event(`UID:${uid}`, "DTSTART:20261001T090000Z", "RRULE:FREQ=DAILY");
  assert.equal(read(cal(daily("a")), "2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z", { perEvent: 5 }).length, 5);
  assert.deepEqual(starts(read(cal(daily("a")), "2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z", { perEvent: 2 })), ["2026-10-01T09:00:00Z", "2026-10-02T09:00:00Z"]);
  assert.equal(read(cal(daily("a"), daily("b")), "2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z", { total: 7 }).length, 7);
  assert.equal(read(cal(daily("a"), daily("b")), "2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z").length, 62);
});

test("an endless rule over a long window returns promptly and capped", () => {
  const endless = cal(event("UID:e", "DTSTART;TZID=Europe/Berlin:19900101T090000", "RRULE:FREQ=DAILY"));
  let events: Occurrence[] = [];
  const ms = cpuMs(() => (events = read(endless, "2026-01-01T00:00:00Z", "2036-01-01T00:00:00Z")));
  assert.equal(events.length, 1000);
  assert.deepEqual([events[0].start, events[999].start], ["2026-01-01T08:00:00Z", "2028-09-26T07:00:00Z"]);
  assert.ok(ms < 500, `took ${ms}ms`);
  const never = cal(event("UID:n", "DTSTART:20260115T090000Z", "RRULE:FREQ=DAILY;BYMONTH=2;BYMONTHDAY=30"));
  const neverMs = cpuMs(() => (events = read(never, "2026-01-01T00:00:00Z", "2999-01-01T00:00:00Z")));
  assert.deepEqual(starts(events), ["2026-01-15T09:00:00Z"]);
  assert.ok(neverMs < 500, `took ${neverMs}ms`);
});

test("a VTIMEZONE of many long-ended rules returns promptly and keeps their last offset", () => {
  const block = ["BEGIN:STANDARD", "DTSTART:16010101T000000", "TZOFFSETFROM:+0000", "TZOFFSETTO:+0100", "RRULE:FREQ=DAILY;UNTIL=20200101T000000Z", "END:STANDARD"];
  const zone = ["BEGIN:VTIMEZONE", "TZID:Evil", ...Array.from({ length: 100 }, () => block).flat(), "END:VTIMEZONE"];
  const text = cal(...zone, event("UID:e", "DTSTART;TZID=Evil:20261005T100000", "RRULE:FREQ=MONTHLY"));
  let events: Occurrence[] = [];
  const ms = cpuMs(() => (events = read(text, "2025-10-01T00:00:00Z", "2028-10-01T00:00:00Z")));
  assert.equal(events.length, 24);
  assert.equal(events[0].start, "2026-10-05T09:00:00Z");
  assert.ok(ms < 500, `took ${ms}ms`);
});

test("a feed naming a fresh bogus TZID on every event returns promptly and still reads real zones", () => {
  const real = event("UID:real", "DTSTART;TZID=Australia/Adelaide:20261005T100000");
  const bogus = Array.from({ length: 20_000 }, (_, i) => `BEGIN:VEVENT\r\nUID:b${i}\r\nDTSTART;TZID=A/B/C/${i}:20261001T100000\r\nEND:VEVENT`);
  const text = cal(real, ...bogus, event("UID:late", "DTSTART;TZID=America/Halifax:20261005T100000"));
  let events: Occurrence[] = [];
  const ms = cpuMs(() => (events = read(text, "2026-09-01T00:00:00Z", "2027-01-01T00:00:00Z", { total: 30_000 })));
  assert.equal(events.length, 20_002);
  const byUid = new Map(events.map((e) => [e.uid, e.start]));
  assert.deepEqual([byUid.get("real"), byUid.get("late"), byUid.get("b0"), byUid.get("b19999")], ["2026-10-04T23:30:00Z", "2026-10-05T13:00:00Z", "2026-10-01T10:00:00Z", "2026-10-01T10:00:00Z"]);
  assert.ok(ms < 1500, `took ${ms}ms`);
});

test("garbage doesn't throw and keeps what's valid", () => {
  const good = event("UID:good", "SUMMARY:Good", "DTSTART:20261005T150000Z");
  assert.deepEqual(read("not a calendar"), []);
  assert.deepEqual(read(cal(good, "BEGIN:VEVENT", "UID:cut", "DTSTART:2026")).map((e) => e.uid), ["good"]);
  assert.deepEqual(read(cal(good, "BEGIN:VEVENT", "UID:cut", "SUMMARY:Truncated", "DTSTART:20261006T150000Z")).map((e) => e.uid), ["good"]);
  assert.deepEqual(read(["BEGIN:VCALENDAR", good].join("\r\n")).map((e) => e.uid), ["good"], "a missing END:VCALENDAR keeps the closed events");
  const huge = read(cal(event("UID:huge", "DTSTART:20261005T150000Z", `DESCRIPTION:${"x".repeat(5_000_000)}`, `SUMMARY:${"y".repeat(2000)}`)));
  assert.deepEqual(huge.map((e) => [e.description?.length, e.title.length]), [[10_000, 500]]);
  const junk = cal(
    "no colon here",
    ";;;:::",
    "END:VTODO",
    event("UID:bad-date", "DTSTART:20261345T990000Z"),
    event("UID:no-start", "SUMMARY:Nothing"),
    event("UID:bad-rule", "DTSTART:20261005T150000Z", "RRULE:FREQ=WEEKLY;BYDAY=XX;INTERVAL=-4;COUNT=abc"),
    event('UID:bad-param', 'DTSTART;TZID="unterminated:20261006T150000Z'),
    "BEGIN:X".repeat(1),
    "\u0000\u0001binary�",
    good,
  );
  assert.deepEqual(read(junk).map((e) => [e.uid, e.start]), [
    ["bad-rule", "2026-10-05T15:00:00Z"],
    ["good", "2026-10-05T15:00:00Z"],
  ]);
  const deep = cal("BEGIN:X\r\n".repeat(100_000) + "END:Y\r\n".repeat(100_000) + good);
  let deepEvents: Occurrence[] = [];
  const deepMs = cpuMs(() => (deepEvents = read(deep)));
  assert.deepEqual(deepEvents.map((e) => e.uid), ["good"]);
  assert.ok(deepMs < 500, `took ${deepMs}ms`);
  const crowd = Array.from({ length: 300 }, (_, i) => `ATTENDEE:mailto:p${i}@x.com`);
  const [party] = read(cal(event("UID:party", "DTSTART:20261005T150000Z", ...crowd)));
  assert.deepEqual([party.attendees.length, party.attendees[199].email], [200, "p199@x.com"]);
});

test("looksLikeIcs sniffs the start of the text", () => {
  assert.deepEqual(
    ["BEGIN:VCALENDAR\r\nEND:VCALENDAR", "﻿\r\n  begin:vcalendar\n", "<html>BEGIN:VCALENDAR", "not a calendar", ""].map(looksLikeIcs),
    [true, true, false, false, false],
  );
});

test("a Google Calendar export", () => {
  const { feed, events } = readIcs(fixture("google.ics").replace(/\n/g, "\r\n"), win("2026-09-01T00:00:00Z", "2026-10-21T00:00:00Z"));
  assert.deepEqual(feed, { name: "Audrow Nash", timeZone: "America/Los_Angeles" });
  assert.deepEqual(
    events.map((e) => [e.start, e.end, e.title]),
    [
      ["2026-09-08T17:00:00Z", "2026-09-08T17:30:00Z", "Design review"],
      ["2026-09-15T17:00:00Z", "2026-09-15T17:30:00Z", "Design review"],
      ["2026-09-22T17:00:00Z", "2026-09-22T17:30:00Z", "Design review"],
      ["2026-10-01", "2026-10-03", "Offsite"],
      ["2026-10-06T18:00:00Z", "2026-10-06T18:30:00Z", "Design review (moved)"],
      ["2026-10-13T17:00:00Z", "2026-10-13T17:30:00Z", "Design review"],
      ["2026-10-20T17:00:00Z", "2026-10-20T17:30:00Z", "Design review"],
    ],
  );
  assert.deepEqual(events[0], {
    uid: "7kukuqrfedlm2f9t0vl1r8uelo@google.com",
    recurrenceId: "20260908T170000Z",
    start: "2026-09-08T17:00:00Z",
    end: "2026-09-08T17:30:00Z",
    allDay: false,
    timeZone: "America/Los_Angeles",
    title: "Design review",
    location: null,
    description: "Agenda in the doc.\n\nJoin: https://meet.google.com/abc-defg-hij",
    url: null,
    organizer: { name: "Audrow Nash", email: "audrow@example.com", status: null },
    attendees: [
      { name: "Audrow Nash", email: "audrow@example.com", status: "accepted" },
      { name: "Ng, Alice", email: "alice.ng@example.com", status: "needs-action" },
    ],
    status: "confirmed",
    recurring: true,
  });
  assert.deepEqual(
    [events[3].allDay, events[3].location, events[3].recurring, events[4].recurrenceId, events[4].location],
    [true, "Half Moon Bay", false, "20261006T170000Z", "Room 4"],
  );
});

test("an Outlook export with Windows zone names and a customized zone", () => {
  const { feed, events } = readIcs(fixture("outlook.ics"), win("2026-10-01T00:00:00Z", "2026-12-01T00:00:00Z"));
  assert.deepEqual(feed, { name: "Calendar", timeZone: null });
  assert.deepEqual(
    events.map((e) => [e.start, e.end, e.title, e.timeZone, e.status]),
    [
      ["2026-10-19T12:00:00Z", "2026-10-19T13:00:00Z", "Weekly sync", "Europe/Berlin", "confirmed"],
      ["2026-10-21T11:30:00Z", "2026-10-21T12:30:00Z", "Vendor call", null, "tentative"],
      ["2026-10-23", "2026-10-24", "Out of office", null, "confirmed"],
      ["2026-11-02T13:00:00Z", "2026-11-02T14:00:00Z", "Weekly sync", "Europe/Berlin", "confirmed"],
      ["2026-11-09T13:00:00Z", "2026-11-09T14:00:00Z", "Weekly sync", "Europe/Berlin", "confirmed"],
    ],
  );
  assert.deepEqual(
    [events[0].uid, events[0].description, events[0].location, events[0].organizer, events[1].description],
    [
      "040000008200E00074C5B7101A82E00800000000A0B1C2D3E4F5A601000000000000000010000000F1E2D3C4B5A69788",
      null,
      "Microsoft Teams Meeting",
      { name: "Petra Schmidt", email: "petra.schmidt@contoso.com", status: null },
      "Dial in from Bengaluru.",
    ],
  );
});
