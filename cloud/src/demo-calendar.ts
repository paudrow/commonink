// Previews only: a team calendar to subscribe to without reaching the internet, so a Preview's
// Calendar has something in it this week (every event repeats from January 2026). Its address is
// on the reserved .invalid domain, which never resolves: in production it's an address like any
// other and fails to load.
import { fetchFeed, type FeedFetcher } from "../../src/core/calendar.ts";
import type { UrlGuard } from "../../src/core/unfurl.ts";

const DEMO_HOST = "demo.commonink.invalid";
/** Any address on the demo host serves the demo calendar (so tests can subscribe more than once). */
export const DEMO_FEED = `https://${DEMO_HOST}/team.ics`;

const DEMO_ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Common Ink//Preview demo//EN
X-WR-CALNAME:Launch team (demo)
X-WR-TIMEZONE:America/Los_Angeles
BEGIN:VEVENT
UID:standup@demo.commonink.invalid
DTSTAMP:20260101T000000Z
DTSTART;TZID=America/Los_Angeles:20260105T093000
DTEND;TZID=America/Los_Angeles:20260105T094500
RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR
SUMMARY:Standup
LOCATION:Video call
DESCRIPTION:What you did\\, what's next\\, what's in the way.
ORGANIZER;CN=Sam Dev:mailto:sam@example.com
ATTENDEE;CN=Sam Dev;PARTSTAT=ACCEPTED:mailto:sam@example.com
ATTENDEE;CN=Developer;PARTSTAT=ACCEPTED:mailto:dev@example.com
END:VEVENT
BEGIN:VEVENT
UID:planning@demo.commonink.invalid
DTSTAMP:20260101T000000Z
DTSTART;TZID=America/Los_Angeles:20260105T110000
DTEND;TZID=America/Los_Angeles:20260105T120000
RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO
SUMMARY:Sprint planning
LOCATION:Room 4
DESCRIPTION:Pick the next two weeks' work.\\nBring your top three.
ORGANIZER;CN=Developer:mailto:dev@example.com
ATTENDEE;CN=Sam Dev;PARTSTAT=TENTATIVE:mailto:sam@example.com
ATTENDEE;CN=Alex Rivera;PARTSTAT=ACCEPTED:mailto:alex@example.com
END:VEVENT
BEGIN:VEVENT
UID:one-on-one@demo.commonink.invalid
DTSTAMP:20260101T000000Z
DTSTART;TZID=America/Los_Angeles:20260108T140000
DTEND;TZID=America/Los_Angeles:20260108T143000
RRULE:FREQ=WEEKLY;BYDAY=TH
SUMMARY:1:1 with Sam
ORGANIZER;CN=Developer:mailto:dev@example.com
ATTENDEE;CN=Sam Dev;PARTSTAT=ACCEPTED:mailto:sam@example.com
END:VEVENT
BEGIN:VEVENT
UID:design-review@demo.commonink.invalid
DTSTAMP:20260101T000000Z
DTSTART;TZID=America/Los_Angeles:20260107T150000
DTEND;TZID=America/Los_Angeles:20260107T160000
RRULE:FREQ=WEEKLY;BYDAY=WE
SUMMARY:Design review
LOCATION:Room 2
URL:https://example.com/design-review
END:VEVENT
BEGIN:VEVENT
UID:all-hands@demo.commonink.invalid
DTSTAMP:20260101T000000Z
DTSTART;TZID=Europe/Berlin:20260106T180000
DTEND;TZID=Europe/Berlin:20260106T190000
RRULE:FREQ=MONTHLY;BYDAY=1TU
SUMMARY:All hands (hosted in Berlin)
DESCRIPTION:Set at 18:00 in Berlin\\, so it moves when the clocks change there and not here.
END:VEVENT
BEGIN:VEVENT
UID:lunch@demo.commonink.invalid
DTSTAMP:20260101T000000Z
DTSTART;TZID=America/Los_Angeles:20260130T120000
DTEND;TZID=America/Los_Angeles:20260130T130000
RRULE:FREQ=MONTHLY;BYDAY=-1FR
SUMMARY:Team lunch
LOCATION:The usual place
END:VEVENT
BEGIN:VEVENT
UID:release@demo.commonink.invalid
DTSTAMP:20260101T000000Z
DTSTART;VALUE=DATE:20260115
DTEND;VALUE=DATE:20260116
RRULE:FREQ=MONTHLY;BYMONTHDAY=15
SUMMARY:Release day
END:VEVENT
BEGIN:VEVENT
UID:offsite@demo.commonink.invalid
DTSTAMP:20260101T000000Z
DTSTART;VALUE=DATE:20260223
DTEND;VALUE=DATE:20260225
RRULE:FREQ=MONTHLY;INTERVAL=3;BYDAY=4MO
SUMMARY:Team offsite
LOCATION:Somewhere with a whiteboard
END:VEVENT
END:VCALENDAR
`.replace(/\n/g, "\r\n");

/** Feeds as a workspace reads them: the demo feed on Previews, anything else through `guard`. */
export function feedsFor(env: { DEV_LOGIN?: string }, guard: UrlGuard): FeedFetcher {
  return (url, last) => {
    if (env.DEV_LOGIN === "1" && new URL(url).hostname === DEMO_HOST) return Promise.resolve({ status: "ok", text: DEMO_ICS, etag: null, modified: null });
    return fetchFeed(url, last, guard);
  };
}
