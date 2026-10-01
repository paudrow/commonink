import { test } from "node:test";
import assert from "node:assert/strict";
import { endsLabel, formatRule, nextDue, occurrences, parseRule, pastThe28th, ruleLabel, ruleProblem } from "../src/core/recurrence.ts";

const next = (token: string, due: string | null, done = "2026-01-01") => nextDue(parseRule(token)!, due, done);
const three = (token: string, from: string) => occurrences(parseRule(token)!, from, 3);

test("an RRULE can end with COUNT or UNTIL, and a rule's ends read as words", () => {
  const counted = parseRule("RRULE:FREQ=MONTHLY;BYMONTHDAY=6;COUNT=5")!;
  assert.deepEqual([counted.count, counted.until], [5, undefined]);
  assert.equal(formatRule(counted), "RRULE:FREQ=MONTHLY;BYMONTHDAY=6;COUNT=5");
  assert.equal(parseRule("RRULE:FREQ=WEEKLY;UNTIL=20270630T000000Z")!.until, "2027-06-30");
  assert.equal(formatRule(parseRule("RRULE:FREQ=WEEKLY;UNTIL=20270630")!), "RRULE:FREQ=WEEKLY;UNTIL=20270630");
  assert.deepEqual(["RRULE:FREQ=WEEKLY;COUNT=0", "RRULE:FREQ=WEEKLY;UNTIL=2027", "RRULE:FREQ=WEEKLY;UNTIL=20270231"].map(parseRule), [null, null, null]);
  assert.deepEqual([endsLabel({ times: 5, until: null }), endsLabel({ times: null, until: "2027-06-30" }), endsLabel({ times: 2, until: "2027-06-30" }), endsLabel({ times: null, until: null })], ["5 left", "until Jun 30", "2 left · until Jun 30", ""]);
  assert.deepEqual([endsLabel({ times: 5, until: null }, true), endsLabel({ times: 1, until: null }, true), endsLabel({ times: null, until: "2027-06-30" }, true)], [", 5 more times", ", this is the last time", ", until June 30, 2027"]);
});

test("every token reads to a rule and writes back as itself", () => {
  const tokens = [
    "daily", "weekly", "monthly", "yearly", "3d", "2w", "2m",
    "mon,thu", "2w-mon,thu", "6th", "last-day", "1st-tue", "1st-tue,3rd-tue", "last-fri", "2nd-mon",
    "mar-1", "1st-mon-mar", "day-50", "after-1m", "after-10d", "after-2w",
    "RRULE:FREQ=MONTHLY;INTERVAL=2;BYDAY=2WE",
  ];
  for (const t of tokens) assert.equal(formatRule(parseRule(t)!), t, t);
  assert.deepEqual(["1y", "+1w", "1d"].map((t) => formatRule(parseRule(t)!)), ["yearly", "weekly", "daily"]); // a gap of one is written as its word; todo.txt's +1w reads as ours (from the due date)
  assert.equal(formatRule(parseRule("RRULE:FREQ=WEEKLY;BYDAY=MO,TH")!), "mon,thu"); // an RRULE we have a word for
  assert.deepEqual(["2 weeks", "after-1st-tue", "RRULE:FREQ=HOURLY", "RRULE:FREQ=DAILY;COUNT=0", "0d", "32nd", "5th-sun-feb-x"].map(parseRule), [null, null, null, null, null, null, null]);
});

test("from the due date: a bill due on the 6th and paid early is next due on the 6th", () => {
  assert.equal(next("6th", "2026-10-06", "2026-10-04"), "2026-11-06");
  assert.equal(next("monthly", "2026-10-06", "2026-10-04"), "2026-11-06");
  assert.equal(next("2w", "2026-10-06"), "2026-10-20");
  assert.equal(next("yearly", "2026-10-06"), "2027-10-06");
  assert.equal(next("3d", "2026-10-06T09:30"), "2026-10-09T09:30"); // the time of day stays
  assert.equal(next("weekly", null, "2026-10-04"), "2026-10-11"); // no due date: from the day it was done
});

test("done late: the next date is the rule's first on or after the day it's done, keeping the rule's rhythm", () => {
  assert.equal(next("weekly", "2026-01-15", "2026-03-01"), "2026-03-05"); // Thursdays stay Thursdays
  assert.equal(next("daily", "2026-09-16", "2026-09-30"), "2026-09-30"); // yesterday's is done; today's still stands
  assert.equal(next("daily", "2026-09-30", "2026-09-30"), "2026-10-01");
  assert.equal(next("2w", "2026-01-01", "2026-03-01"), "2026-03-12"); // every other Thursday from Jan 1, not two weeks from today
  assert.equal(next("6th", "2026-01-06", "2026-03-07"), "2026-04-06");
  assert.equal(next("6th", "2026-01-06", "2026-03-06"), "2026-03-06");
  assert.equal(next("mon,thu", "2026-09-07T08:00", "2026-09-30"), "2026-10-01T08:00");
  assert.equal(next("daily", "2006-01-01", "2026-09-30"), "2026-09-30"); // twenty years behind still has a next one
  assert.equal(next("after-1w", "2026-01-01", "2026-03-01"), "2026-03-08");
});

test("from completion: dog medicine given on the 8th is next due on the 8th of next month", () => {
  assert.equal(next("after-1m", "2026-10-01", "2026-10-08"), "2026-11-08");
  assert.equal(next("after-10d", "2026-10-01", "2026-10-08"), "2026-10-18");
  assert.equal(next("after-1m", null, "2026-01-31"), "2026-02-28"); // a month after the 31st is the month's last day
  assert.equal(ruleProblem("after-1st-tue"), "\"after-\" repeats a gap after it's done (after-1m, after-10d), not a calendar rule");
  assert.equal(ruleProblem("RRULE:FREQ=MONTHLY;BYDAY=1TU"), null);
});

test("weekdays, and every other week", () => {
  assert.deepEqual(three("mon,thu", "2026-10-01"), ["2026-10-05", "2026-10-08", "2026-10-12"]); // Oct 1 2026 is a Thursday
  assert.deepEqual(three("2w-mon,thu", "2026-10-01"), ["2026-10-12", "2026-10-15", "2026-10-26"]);
});

test("the nth weekday of the month, and a 5th Tuesday that some months don't have", () => {
  assert.deepEqual(three("1st-tue,3rd-tue", "2026-10-06"), ["2026-10-20", "2026-11-03", "2026-11-17"]);
  assert.deepEqual(three("last-fri", "2026-10-01"), ["2026-10-30", "2026-11-27", "2026-12-25"]);
  assert.deepEqual(three("RRULE:FREQ=MONTHLY;BYDAY=5TU", "2026-09-29"), ["2026-12-29", "2027-03-30", "2027-06-29"]);
});

test("a day a shorter month doesn't have falls on its last day; a plain monthly or yearly from one skips it", () => {
  assert.deepEqual(three("31st", "2026-01-31"), ["2026-02-28", "2026-03-31", "2026-04-30"]);
  assert.deepEqual(three("30th", "2026-01-30"), ["2026-02-28", "2026-03-30", "2026-04-30"]);
  assert.deepEqual(three("29th", "2028-01-29"), ["2028-02-29", "2028-03-29", "2028-04-29"]); // a leap year has one
  assert.deepEqual(three("RRULE:FREQ=MONTHLY;BYMONTHDAY=31", "2026-01-31"), ["2026-02-28", "2026-03-31", "2026-04-30"]);
  assert.deepEqual(three("feb-29", "2096-02-29"), ["2097-02-28", "2098-02-28", "2099-02-28"]);
  assert.deepEqual(three("last-day", "2026-01-31"), ["2026-02-28", "2026-03-31", "2026-04-30"]);
  // Only a day on its own falls back: a Friday the 31st still needs a Friday that's the 31st.
  assert.deepEqual(three("RRULE:FREQ=MONTHLY;BYDAY=FR;BYMONTHDAY=31", "2026-01-01"), ["2026-07-31", "2027-12-31", "2028-03-31"]);
  // With no day of its own, the rule follows the due date's day and skips months without it (RFC 5545).
  assert.deepEqual(three("monthly", "2026-01-31"), ["2026-03-31", "2026-05-31", "2026-07-31"]);
  assert.deepEqual(three("yearly", "2024-02-29"), ["2028-02-29", "2032-02-29", "2036-02-29"]);
});

test("days counted from the end of the month: last-day, and last-day-N for N days before it", () => {
  assert.deepEqual(three("last-day-1", "2026-01-30"), ["2026-02-27", "2026-03-30", "2026-04-29"]);
  assert.deepEqual(three("last-day-2", "2026-02-01"), ["2026-02-26", "2026-03-29", "2026-04-28"]);
  for (const t of ["last-day-1", "last-day-30", "15th,last-day-1"]) assert.equal(formatRule(parseRule(t)!), t, t);
  assert.equal(formatRule(parseRule("RRULE:FREQ=MONTHLY;BYMONTHDAY=-2")!), "last-day-1");
  assert.deepEqual(["last-day-0", "last-day-31", "last-day-x"].map(parseRule), [null, null, null]);
  const both = (t: string) => [ruleLabel(parseRule(t)!), ruleLabel(parseRule(t)!, true)];
  assert.deepEqual(both("last-day"), ["Last day", "Every month on the last day"]);
  assert.deepEqual(both("last-day-1"), ["Last day − 1", "Every month on the day before the last day"]);
  assert.deepEqual(both("last-day-2"), ["Last day − 2", "Every month on the 2nd day before the last day"]);
});

test("a monthly day past the 28th offers the last day of the month instead", () => {
  const offer = (t: string, due: string | null = null) => {
    const hint = pastThe28th(parseRule(t)!, due);
    return hint && { days: hint.days, skips: hint.skips, instead: formatRule(hint.lastDay) };
  };
  assert.deepEqual(offer("31st"), { days: [31], skips: false, instead: "last-day" });
  assert.deepEqual(offer("29th"), { days: [29], skips: false, instead: "last-day" });
  assert.deepEqual(offer("15th,30th"), { days: [30], skips: false, instead: "15th,last-day" });
  assert.deepEqual(offer("RRULE:FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=31"), { days: [31], skips: false, instead: "RRULE:FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=-1" });
  // A plain monthly takes its day from the due date, and skips the months without it.
  assert.deepEqual(offer("monthly", "2026-10-31"), { days: [31], skips: true, instead: "last-day" });
  assert.deepEqual(offer("2m", "2026-10-30T09:00"), { days: [30], skips: true, instead: "RRULE:FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=-1" });
  assert.deepEqual([offer("28th"), offer("last-day"), offer("last-fri"), offer("monthly"), offer("monthly", "2026-10-28"), offer("mar-31"), offer("after-1m", "2026-10-31")], [null, null, null, null, null, null, null]);
});

test("yearly on a date, on the nth weekday of a month, and on a day of the year", () => {
  assert.deepEqual(three("mar-1", "2026-10-01"), ["2027-03-01", "2028-03-01", "2029-03-01"]);
  assert.deepEqual(three("1st-mon-mar", "2026-10-01"), ["2027-03-01", "2028-03-06", "2029-03-05"]);
  assert.deepEqual(three("day-50", "2026-10-01"), ["2027-02-19", "2028-02-19", "2029-02-19"]);
});

test("dates stay dates across a daylight-saving change, whatever the machine's time zone", () => {
  const was = process.env.TZ;
  for (const tz of ["America/New_York", "Europe/London", "Australia/Sydney"]) {
    process.env.TZ = tz;
    assert.deepEqual(three("daily", "2026-03-07"), ["2026-03-08", "2026-03-09", "2026-03-10"], tz);
    assert.deepEqual(three("weekly", "2026-10-25"), ["2026-11-01", "2026-11-08", "2026-11-15"], tz);
    assert.deepEqual(three("sun", "2026-03-28"), ["2026-03-29", "2026-04-05", "2026-04-12"], tz);
  }
  process.env.TZ = was;
});

test("a rule says what it does, short for a chip and long for the editor", () => {
  const both = (t: string) => [ruleLabel(parseRule(t)!), ruleLabel(parseRule(t)!, true)];
  assert.deepEqual(both("1st-tue,3rd-tue"), ["1st & 3rd Tue", "Every month on the 1st and 3rd Tuesday"]);
  assert.deepEqual(both("last-fri"), ["Last Fri", "Every month on the last Friday"]);
  assert.deepEqual(both("mar-1"), ["Mar 1", "Every year on March 1"]);
  assert.deepEqual(both("after-1m"), ["Monthly after done", "A month after it's done"]);
  assert.deepEqual(both("2w-mon,thu"), ["Every 2 wks: Mon, Thu", "Every 2 weeks on Monday and Thursday"]);
  assert.deepEqual(both("day-50"), ["Day 50", "Every year on day 50"]);
  assert.deepEqual(both("6th"), ["6th", "Every month on the 6th"]);
  assert.deepEqual(both("2w"), ["Every 2 weeks", "Every 2 weeks"]);
  assert.deepEqual(both("RRULE:FREQ=MONTHLY;INTERVAL=2;BYDAY=2WE"), ["Every 2 mos: 2nd Wed", "Every 2 months on the 2nd Wednesday"]);
});

test("RRULE days counted from the end, and month days in a yearly rule with no month, follow RFC 5545", () => {
  // A negative day of the month in a daily rule is that month's day counted from its end.
  assert.deepEqual(three("RRULE:FREQ=DAILY;BYMONTHDAY=-1", "2026-09-30"), ["2026-10-31", "2026-11-30", "2026-12-31"]);
  assert.deepEqual(three("RRULE:FREQ=DAILY;BYMONTHDAY=-2", "2027-01-01"), ["2027-01-30", "2027-02-27", "2027-03-30"]);
  // Yearly on a day of the month with no month named is every month, as a calendar reads it.
  assert.deepEqual(three("RRULE:FREQ=YEARLY;BYMONTHDAY=1", "2026-10-01"), ["2026-11-01", "2026-12-01", "2027-01-01"]);
  assert.deepEqual(three("RRULE:FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=1", "2026-10-01"), ["2027-03-01", "2028-03-01", "2029-03-01"]);
});

test("labels read naturally for days from the end and a weekday on a date", () => {
  const both = (t: string) => [ruleLabel(parseRule(t)!), ruleLabel(parseRule(t)!, true)];
  assert.deepEqual(both("RRULE:FREQ=MONTHLY;BYDAY=-2FR"), ["2nd-to-last Fri", "Every month on the 2nd-to-last Friday"]);
  assert.deepEqual(both("RRULE:FREQ=YEARLY;BYYEARDAY=-1"), ["Last day of the year", "Every year on the last day of the year"]);
  assert.deepEqual(both("RRULE:FREQ=YEARLY;BYYEARDAY=1,-2"), ["Day 1 & 2nd-to-last day of the year", "Every year on day 1 and the 2nd-to-last day of the year"]);
  assert.deepEqual(both("RRULE:FREQ=MONTHLY;BYDAY=FR;BYMONTHDAY=13"), ["Fri the 13th", "Every month on Friday the 13th"]);
});
