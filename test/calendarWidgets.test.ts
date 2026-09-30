// Which calendars ::agenda and ::calendar show: the settings form's calendar picker writes source IDs
// to the widget's attributes (none for all), and the widgets show only those calendars' events.
process.env.TZ = "America/New_York";
import { after, test } from "node:test";
import assert from "node:assert/strict";

await import("./dom.ts");
const { fieldRows, fieldValues } = await import("../web/src/widgets/core.ts");
const { agenda } = await import("../web/src/widgets/agenda.ts");
const { calendar } = await import("../web/src/widgets/calendar.ts");
const { calendarChanged } = await import("../web/src/calendar/data.ts");
const { serializeAttrs } = await import("../src/core/directive.ts");

const now = new Date();
const at = (h: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate(), h).toISOString();
const source = (id: string, name: string, color: string) => ({ id, kind: "ics", name, color, owner: null, url: null, host: "x.test", editable: true, writeBack: null, calendar: null, status: "ok", error: null, syncedAt: 1, events: 1, createdBy: "you", createdAt: 1 });
const SOURCES = [source("work", "Work", "blue"), source("home", "Home", "green"), source("holidays", "Holidays", "red")];
const event = (id: string, src: string, title: string, h: number) => ({ id, source: src, title, start: at(h), end: at(h + 1), allDay: false, timeZone: null, location: null, description: null, url: null, organizer: null, attendees: [], status: "confirmed", recurring: false, note: null });
const EVENTS = [event("e1aaaaaaaaaa", "work", "Standup", 9), event("e2aaaaaaaaaa", "home", "Dentist", 11), event("e3aaaaaaaaaa", "holidays", "Half day", 13)];

globalThis.fetch = (async (input: string) => {
  const url = new URL(input, "http://localhost");
  const json = (d: unknown) => new Response(JSON.stringify(d), { headers: { "Content-Type": "application/json" } });
  if (url.pathname === "/api/calendar/sources") return json(SOURCES);
  if (url.pathname === "/api/calendar/events") return json(EVENTS);
  if (url.pathname === "/api/notes") return json([]);
  return new Response("{}", { status: 404 });
}) as typeof fetch;
after(() => window.close());

const settle = () => new Promise((r) => setTimeout(r, 20));
const field = { key: "calendars", label: "Calendars", type: "calendars" as const };

test("the calendar picker starts on every calendar, writes the ones left checked, and never none", async () => {
  calendarChanged();
  const values: Record<string, string> = {};
  const [row] = fieldRows([field], values, () => {}, { tags: () => [], folders: () => [] });
  document.body.append(row);
  await settle();
  const boxes = () => [...row.querySelectorAll<HTMLInputElement>("input[type=checkbox]")];
  const names = [...row.querySelectorAll(".qw-cal")].map((l) => l.textContent);
  assert.deepEqual([names, boxes().map((b) => b.checked)], [["All calendars", "Work", "Home", "Holidays"], [true, true, true, true]]);
  const toggle = (i: number) => (boxes()[i].click(), values.calendars);
  assert.deepEqual([toggle(3), boxes()[0].checked], ["work,home", false]);
  assert.equal(toggle(1), "home");
  assert.deepEqual([toggle(2), boxes()[2].checked], ["home", true]); // the last one stays checked
  assert.deepEqual([toggle(0), boxes().map((b) => b.checked)], ["", [true, true, true, true]]);
  toggle(2);
  assert.equal(serializeAttrs(fieldValues([field], values)), 'calendars="work,holidays"');
  assert.deepEqual(fieldValues([field], { calendars: "" }), {});
  row.remove();
});

function mount(spec: typeof agenda, args: Record<string, string>) {
  const body = document.createElement("div");
  document.body.append(body);
  spec.mount(body, { args, note: "Note.md", openConfig: false, update() {}, withId() {}, focusEditor() {}, remeasure() {}, open() {}, openTag() {}, saveSmartFolder() {}, sources: { tags: () => [], folders: () => [] }, openPerson() {} }, body);
  return body;
}

test("::agenda shows every calendar's events by default, and only the chosen calendars' when some are picked", async () => {
  calendarChanged();
  const every = mount(agenda, { days: "1" });
  const some = mount(agenda, { days: "1", calendars: "work,holidays" });
  await settle();
  const titles = (b: HTMLElement) => [...b.querySelectorAll(".cal-row-title, .cal-chip-title")].map((t) => t.textContent);
  assert.deepEqual([titles(every), titles(some)], [["Standup", "Dentist", "Half day"], ["Standup", "Half day"]]);
});

test("::calendar dots only the chosen calendars' events", async () => {
  calendarChanged();
  const month = mount(calendar, { calendars: "home" });
  await settle();
  const day = [...month.querySelectorAll<HTMLElement>(".qc-day")].find((d) => d.classList.contains("is-today"))!;
  assert.match(day.title, /Dentist/);
  assert.doesNotMatch(day.title, /Standup|Half day/);
});
