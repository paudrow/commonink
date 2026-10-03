// Making and changing events (web/src/calendar/): the time math for drags and keys, read in New
// York (the clocks go back on 2026-11-01), then the form, drags, Undo and keys on the page in jsdom
// against a stubbed server.
process.env.TZ = "America/New_York";
import { after, test } from "node:test";
import assert from "node:assert/strict";

await import("./dom.ts");
(globalThis as any).matchMedia = (q: string) => ({ matches: false, media: q, addEventListener() {} });
const L = await import("../web/src/calendar/layout.ts");
const { CalendarPage } = await import("../web/src/calendar/page.ts");
const { setCalendarContext, calendarChanged, eventTargets } = await import("../web/src/calendar/data.ts");

const local = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi);
const span = (start: Date, end: Date, allDay = false) => ({ start, end, allDay });
const clock = (d: Date) => `${L.dayKey(d)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

// ------------------------------------------------------------------ the math

test("a new event starts at the next half hour today, or at 9 on a day ahead, never in the past, and lasts half an hour", () => {
  const at = (now: Date, day?: string) => Object.values(L.defaultSlot(now, day)).map(clock);
  assert.deepEqual(at(local(2026, 9, 29, 10, 7)), ["2026-09-29 10:30", "2026-09-29 11:00"]);
  assert.deepEqual(at(local(2026, 9, 29, 10, 30)), ["2026-09-29 11:00", "2026-09-29 11:30"]);
  assert.deepEqual(at(local(2026, 9, 29, 23, 50)), ["2026-09-30 00:00", "2026-09-30 00:30"]);
  assert.deepEqual(at(local(2026, 9, 29, 10, 7), "2026-10-02"), ["2026-10-02 09:00", "2026-10-02 09:30"]);
  assert.deepEqual(at(local(2026, 10, 2, 18, 2), "2026-10-01"), ["2026-10-02 18:30", "2026-10-02 19:00"], "a day gone by means today");
  assert.deepEqual(at(local(2026, 10, 2, 18, 2), "2026-09-15"), ["2026-10-02 18:30", "2026-10-02 19:00"]);
});

test("a drag down a column covers the steps it touches, upward too, and one step at least", () => {
  const slot = (a: number, b: number) => Object.values(L.dragSlot("2026-09-29", a, b)).map(clock);
  assert.deepEqual(slot(540, 605), ["2026-09-29 09:00", "2026-09-29 10:15"]);
  assert.deepEqual(slot(605, 540), ["2026-09-29 09:00", "2026-09-29 10:15"], "dragged up");
  assert.deepEqual(slot(600, 602), ["2026-09-29 10:00", "2026-09-29 10:15"]);
  assert.deepEqual(slot(1430, 1500), ["2026-09-29 23:45", "2026-09-30 00:00"], "not past midnight");
});

test("moving snaps to 15 minutes and keeps the length; days move by the calendar, through a clock change", () => {
  const standup = span(local(2026, 9, 29, 9), local(2026, 9, 29, 10));
  assert.deepEqual(L.movedTo(standup, "2026-09-30", 612), { start: "2026-09-30T14:15:00Z", end: "2026-09-30T15:15:00Z", allDay: false });
  assert.deepEqual(L.moved(standup, { minutes: -15 }), { start: "2026-09-29T12:45:00Z", end: "2026-09-29T13:45:00Z", allDay: false });
  // 9:00 on Saturday is 13:00 UTC; 9:00 on Sunday, after the clocks go back, is 14:00 UTC.
  assert.deepEqual(L.moved(span(local(2026, 10, 31, 9), local(2026, 10, 31, 10)), { days: 1 }), { start: "2026-11-01T14:00:00Z", end: "2026-11-01T15:00:00Z", allDay: false });
  assert.deepEqual(L.moved(span(local(2026, 9, 28), local(2026, 10, 1), true), { days: 2 }), { start: "2026-09-30", end: "2026-10-03", allDay: true });
});

test("resizing moves only the end, snapped, and never below 15 minutes", () => {
  const half = span(local(2026, 9, 29, 10), local(2026, 9, 29, 10, 30));
  assert.deepEqual(L.endAt(half, "2026-09-29", 652), { start: "2026-09-29T14:00:00Z", end: "2026-09-29T14:45:00Z", allDay: false });
  assert.deepEqual(L.endAt(half, "2026-09-29", 590), { start: "2026-09-29T14:00:00Z", end: "2026-09-29T14:15:00Z", allDay: false });
  assert.deepEqual(L.resizedBy(half, 15), { start: "2026-09-29T14:00:00Z", end: "2026-09-29T14:45:00Z", allDay: false });
  assert.deepEqual(L.resizedBy(half, -60), { start: "2026-09-29T14:00:00Z", end: "2026-09-29T14:15:00Z", allDay: false });
});

// ------------------------------------------------------------------ on the page

const pad = (n: number) => String(n).padStart(2, "0");
const now = new Date();
const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const at = (h: number, m = 0, days = 0) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, h, m).toISOString().replace(/\.\d{3}Z$/, "Z");

const source = (id: string, kind: string, name: string, writable: boolean) => ({ id, kind, name, color: "blue", owner: null, url: null, host: null, editable: true, writable, readOnly: writable ? null : `Events from ${name} (a subscribed feed) can't be changed here`, writeBack: null, calendar: null, status: "ok", error: null, syncedAt: Date.now(), events: 1, createdBy: "me", createdAt: 1 });
const base = { allDay: false, timeZone: null, location: null, description: null, url: null, organizer: null, attendees: [], status: "confirmed", recurring: false, note: null };
const server = {
  sources: [source("loc", "local", "Common Ink", true), source("hol", "ics", "Holidays", false)],
  events: [
    { ...base, id: "standupaaaaa", source: "loc", title: "Standup", start: at(9), end: at(9, 30) },
    { ...base, id: "picnicaaaaaa", source: "hol", title: "Picnic", start: at(12), end: at(13) },
  ] as any[],
};
const requests: Array<{ path: string; body: any }> = [];
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
globalThis.fetch = (async (input: string, init?: RequestInit) => {
  const url = new URL(input, "http://localhost");
  const body = init?.body ? JSON.parse(String(init.body)) : null;
  requests.push({ path: url.pathname, body });
  if (url.pathname === "/api/calendar/sources") return json(server.sources);
  if (url.pathname === "/api/calendar/events") return json(server.events);
  if (url.pathname === "/api/tasks") return json([]);
  if (url.pathname === "/api/calendar/events/update") {
    const ev = server.events.find((e) => e.id === body.id);
    Object.assign(ev, body);
    return json(ev);
  }
  return json({ error: `no stub for ${url.pathname}` }, 404);
}) as typeof fetch;
// Creating is a POST to the same path as reading: tell them apart by the method.
const read = globalThis.fetch;
globalThis.fetch = (async (input: string, init?: RequestInit) => {
  if (init?.method === "POST" && new URL(input, "http://localhost").pathname === "/api/calendar/events") {
    const body = JSON.parse(String(init.body));
    requests.push({ path: "create", body });
    const ev = { ...base, ...body, id: `new${server.events.length}aaaaaaaa`.slice(0, 12) };
    server.events.push(ev);
    return json({ event: ev, note: body.meetingNote ? { path: `Meetings/${body.title}.md` } : null });
  }
  return read(input, init);
}) as typeof fetch;

const root = Object.assign(document.createElement("div"), { id: "calendar-view", tabIndex: -1 });
document.body.append(root);
const opened: string[] = [];
const page = new CalendarPage(root, { open: (path) => void opened.push(path), setUrl() {} });
const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const posted = (path: string) => requests.filter((r) => r.path === path).map((r) => r.body);
const toasts = () => [...document.querySelectorAll(".toast-text")].map((t) => t.textContent);
const chip = (title: string) => [...root.querySelectorAll<HTMLElement>(".cal-ev")].find((c) => c.querySelector(".cal-chip-title")?.textContent === title)!;
/** A pointer event as jsdom can make one (it has no PointerEvent): a mouse's, pointer 1. */
const pointer = (type: string, target: Element, y: number, x = 10) => {
  const e = new window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
  Object.assign(e, { pointerId: 1, pointerType: "mouse" });
  target.dispatchEvent(e);
};
const drag = (target: Element, from: number, to: number) => {
  pointer("pointerdown", target, from);
  pointer("pointermove", window as unknown as Element, from + (to - from) / 2);
  pointer("pointermove", window as unknown as Element, to);
  pointer("pointerup", window as unknown as Element, to);
};
const form = () => document.querySelector<HTMLElement>(".cal-f-box");
const input = (label: string) => form()!.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
const submit = async () => {
  form()!.querySelector("form")!.dispatchEvent(new window.Event("submit", { cancelable: true }));
  await settle();
};

after(() => window.close());

test("New event opens the form at the next half hour in the workspace's calendar, and posts it as the server takes it", async () => {
  setCalendarContext({ canEdit: true });
  await page.show();
  await settle();
  assert.equal(root.querySelector<HTMLElement>(".cal-new")!.hidden, false);
  page.newEvent({ start: new Date(2026, 9, 5, 14, 30), end: new Date(2026, 9, 5, 15, 15) });
  assert.deepEqual([input("Start date").value, input("Start time").value, input("End date").value, input("End time").value], ["2026-10-05", "14:30", "2026-10-05", "15:15"]);
  assert.equal(form()!.querySelector("select"), null, "one calendar to put it in: no picker");
  assert.equal(input("End date").hidden, true, "the end date shows only when it's another day");
  assert.equal(input("Location").closest<HTMLElement>(".cal-f-line")!.hidden, true, "where, guests and notes wait behind Add …");
  [...form()!.querySelectorAll<HTMLButtonElement>(".cal-f-add")].find((b) => b.textContent === "Add location")!.click();
  assert.equal(input("Location").closest<HTMLElement>(".cal-f-line")!.hidden, false);
  input("Title").value = "Design review";
  input("Location").value = "Room 4";
  input("Add a guest").value = "ana@example.com";
  [...form()!.querySelectorAll<HTMLInputElement>(".cal-f-check input")].at(-1)!.click(); // Also make a meeting note
  await submit();
  assert.deepEqual(posted("create").at(-1), {
    source: "loc",
    title: "Design review",
    start: "2026-10-05T18:30:00Z",
    end: "2026-10-05T19:15:00Z",
    allDay: false,
    timeZone: "America/New_York",
    location: "Room 4",
    description: null,
    attendees: [{ name: null, email: "ana@example.com" }],
    meetingNote: true,
  });
  assert.equal(form(), null, "the form closes once saved");
  assert.equal(toasts().at(-1), "Added Design review");
  [...document.querySelectorAll<HTMLElement>(".toast-action")].find((b) => b.textContent === "Open")!.click();
  assert.deepEqual(opened.splice(0), ["Meetings/Design review.md"]);
});

test("an all-day event sends days, the end the day after the last one shown", async () => {
  page.newEvent();
  input("Title").value = "Offsite";
  const allDay = form()!.querySelector<HTMLInputElement>(".cal-f-check input")!;
  allDay.click();
  allDay.dispatchEvent(new window.Event("change"));
  input("Start date").value = "2026-10-12";
  input("End date").value = "2026-10-14";
  input("End date").dispatchEvent(new window.Event("change"));
  await submit();
  const body = posted("create").at(-1);
  assert.deepEqual([body.start, body.end, body.allDay, body.meetingNote], ["2026-10-12", "2026-10-15", true, undefined]);
});

test("a drag across empty grid opens the form on that range; a click there makes nothing", async () => {
  await page.setView("day", today);
  await settle();
  const col = root.querySelector(`.cal-col[data-day="${today}"]`)!;
  pointer("pointerdown", col, 600);
  pointer("pointerup", window as unknown as Element, 600);
  assert.equal(form(), null);
  drag(col, 14 * 48, 15.5 * 48); // 2 to 3:30 in the afternoon, at 48 pixels an hour
  assert.deepEqual([input("Start time").value, input("End time").value], ["14:00", "15:30"]);
  await settle(); // the click that ends a drag is the drag's, not the next one
  document.querySelector<HTMLElement>(".cal-f-box .ask-actions .qw-btn")!.click(); // Cancel
  assert.equal(form(), null);
});

test("dragging an event moves it by 15-minute steps, with Undo sending its old times back", async () => {
  requests.length = 0;
  drag(chip("Standup"), 9 * 48 + 12, 10 * 48 + 12); // picked up 15 minutes in, dropped an hour later
  await settle();
  assert.deepEqual(posted("/api/calendar/events/update"), [{ id: "standupaaaaa", start: at(10), end: at(10, 30), allDay: false }]);
  assert.equal(toasts().at(-1), "Moved Standup");
  [...document.querySelectorAll<HTMLElement>(".toast-action")].findLast((b) => b.textContent === "Undo")!.click();
  await settle();
  assert.deepEqual(posted("/api/calendar/events/update").at(-1), { id: "standupaaaaa", start: at(9), end: at(9, 30), allDay: false });
});

test("dragging an event's bottom edge changes its end", async () => {
  requests.length = 0;
  drag(chip("Standup").querySelector(".cal-ev-grip")!, 9.5 * 48, 10.25 * 48);
  await settle();
  assert.deepEqual(posted("/api/calendar/events/update"), [{ id: "standupaaaaa", start: at(9), end: at(10, 15), allDay: false }]);
  assert.equal(toasts().at(-1), "Resized Standup");
});

test("a subscribed feed's event won't move, and says why", async () => {
  requests.length = 0;
  assert.equal(chip("Picnic").querySelector(".cal-ev-grip"), null);
  drag(chip("Picnic"), 12 * 48 + 5, 14 * 48);
  await settle();
  assert.deepEqual(posted("/api/calendar/events/update"), []);
  assert.equal(toasts().at(-1), "Events from Holidays (a subscribed feed) can't be changed here");
});

test("Alt+arrows move the focused event; a run of presses is saved once", async () => {
  requests.length = 0;
  const key = (key: string, shift = false) => document.activeElement!.dispatchEvent(new window.KeyboardEvent("keydown", { key, altKey: true, shiftKey: shift, bubbles: true, cancelable: true }));
  chip("Standup").focus();
  key("ArrowDown");
  key("ArrowDown");
  assert.equal(chip("Standup").style.top, `${9.5 * 48}px`, "shown moved at once");
  await settle(800);
  assert.deepEqual(posted("/api/calendar/events/update"), [{ id: "standupaaaaa", start: at(9, 30), end: at(10, 45), allDay: false }]);
  chip("Standup").focus();
  key("ArrowUp", true);
  await settle(800);
  assert.deepEqual(posted("/api/calendar/events/update").at(-1), { id: "standupaaaaa", start: at(9, 30), end: at(10, 30), allDay: false });
  chip("Standup").focus();
  key("ArrowRight");
  await settle(800);
  assert.deepEqual(posted("/api/calendar/events/update").at(-1), { id: "standupaaaaa", start: at(9, 30, 1), end: at(10, 30, 1), allDay: false });
});

test("viewers aren't offered the workspace's calendar: no New event without a calendar of their own", async () => {
  setCalendarContext({ canEdit: false });
  server.sources = [source("hol", "ics", "Holidays", false)];
  assert.deepEqual(eventTargets(server.sources as any), []);
  calendarChanged();
  await page.refresh();
  assert.equal(root.querySelector<HTMLElement>(".cal-new")!.hidden, true);
  root.focus();
  root.dispatchEvent(new window.KeyboardEvent("keydown", { key: "c", bubbles: true, cancelable: true }));
  assert.equal(form(), null);
  assert.match(toasts().at(-1)!, /^Only editors can add events to this workspace's calendar/);
  const mine = { ...source("goo", "google", "Dev (Google)", true), owner: "me" };
  assert.deepEqual(eventTargets([...server.sources, mine] as any).map((t) => t.name), ["Dev (Google)"]);
  setCalendarContext({ canEdit: true });
  assert.deepEqual(eventTargets(server.sources as any).map((t) => [t.value, t.name]), [["local", "Common Ink"]], "an editor can start the workspace's calendar");
});
