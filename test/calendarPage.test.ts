// The Calendar page (web/src/calendar/page.ts) in jsdom, against a stubbed calendar API: what each
// view shows, its keys, an event's details and meeting note, and what a viewer can't do.
process.env.TZ = "America/New_York";
import { after, test } from "node:test";
import assert from "node:assert/strict";

await import("./dom.ts");
(globalThis as any).matchMedia = (q: string) => ({ matches: false, media: q, addEventListener() {} });
const { CalendarPage } = await import("../web/src/calendar/page.ts");
const { setCalendarContext, canEditCalendars, calendarChanged } = await import("../web/src/calendar/data.ts");

const pad = (n: number) => String(n).padStart(2, "0");
const now = new Date();
const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const at = (h: number, m = 0, days = 0) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, h, m).toISOString();
const dayAfter = (n: number) => {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const source = { id: "src1", kind: "ics", name: "Work", color: "green", owner: null, url: null, host: "calendar.example.com", editable: true, status: "ok", error: null, syncedAt: Date.now(), events: 3, createdBy: "you", createdAt: 1 };
const base = { source: "src1", allDay: false, timeZone: null, location: null, description: null, url: null, organizer: null, attendees: [], status: "confirmed", recurring: false, note: null };
const EVENTS = [
  { ...base, id: "standupaaaaa", title: "Standup", start: at(9), end: at(9, 15), recurring: true, location: "https://meet.example.com/abc", description: "Agenda:\n1. Wins<br>2. <b>Blockers</b>", attendees: [{ name: "Ana", email: null }, { name: null, email: "bo@example.com" }], organizer: { name: "Ana", email: null } },
  { ...base, id: "reviewbbbbbb", title: "Design review", start: at(9), end: at(10), note: { id: "n1", path: "Meetings/Design review.md", title: "Design review" } },
  { ...base, id: "offsiteccccc", title: "Offsite", start: today, end: dayAfter(2), allDay: true },
];
const TASKS = [{ path: "Projects/Acme.md", title: "Acme", line: 4, text: "Send invoice due:" + today, summary: "Send invoice", done: false, heading: null, meta: { due: today, start: null, done: null, rec: null, until: null, times: null, priority: null, assignees: [], tags: [] } }];

const requests: Array<{ url: string; body: any }> = [];
let subscribeError: string | null = null;
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
globalThis.fetch = (async (input: string, init?: RequestInit) => {
  const url = new URL(input, "http://localhost");
  requests.push({ url: url.pathname + url.search, body: init?.body ? JSON.parse(String(init.body)) : null });
  if (url.pathname === "/api/calendar/sources" && init?.method === "POST") return json({ error: subscribeError }, 400);
  if (url.pathname === "/api/calendar/sources") return json([{ ...source, editable: canEditCalendars() }]); // the server says what each person may change
  if (url.pathname === "/api/calendar/events") {
    const [from, to] = [Date.parse(url.searchParams.get("from")!), Date.parse(url.searchParams.get("to")!)];
    const local = (t: string) => (t.length === 10 ? new Date(`${t}T00:00:00`).getTime() : Date.parse(t));
    return json(EVENTS.filter((e) => local(e.start) < to && local(e.end) > from));
  }
  if (url.pathname === "/api/calendar/event") return json(EVENTS.find((e) => e.id === url.searchParams.get("id")) ?? { error: "no" }, EVENTS.some((e) => e.id === url.searchParams.get("id")) ? 200 : 404);
  if (url.pathname === "/api/calendar/meeting-note") return json({ path: "Meetings/Standup.md", created: true });
  if (url.pathname === "/api/tasks") return json(TASKS);
  if (url.pathname === "/api/tasks/set") {
    const { done } = JSON.parse(String(init!.body));
    const t = TASKS[0];
    Object.assign(t, { done, text: done ? `${t.text.replace(/ done:\S+/, "")} done:${today}` : t.text.replace(/ done:\S+/, "") });
    return json({ path: t.path, version: "v", line: t.line, text: t.text });
  }
  return json({ error: `no stub for ${url.pathname}` }, 404);
}) as typeof fetch;

const root = document.createElement("div");
root.id = "calendar-view";
root.tabIndex = -1;
document.body.append(root);
const opened: string[] = [];
const urls: string[] = [];
const page = new CalendarPage(root, { open: (path, line) => void opened.push(line ? `${path}:${line}` : path), setUrl: (u) => void urls.push(u) });
const settle = () => new Promise((r) => setTimeout(r, 20));
const texts = (sel: string, from: ParentNode = root) => [...from.querySelectorAll(sel)].map((n) => n.textContent);
const press = (key: string, target: Element = root) => target.dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
const button = (label: string, from: ParentNode = document) => [...from.querySelectorAll("button")].find((b) => b.textContent === label || b.getAttribute("aria-label") === label);

after(() => window.close()); // the page's minute ticker runs on jsdom's clock

test("the week shows the day's events side by side, and the all-day row the offsite and the task due today", async () => {
  await page.show();
  await settle();
  assert.equal(root.dataset.view, "week");
  const timed = [...root.querySelectorAll<HTMLElement>(".cal-ev")];
  assert.deepEqual(timed.map((e) => [e.querySelector(".cal-chip-title")!.textContent, e.style.top, e.style.width]), [
    ["Design review", "432px", "calc(50% - 3px)"],
    ["Standup", "432px", "calc(50% - 3px)"],
  ]);
  assert.deepEqual(texts(".cal-tg-allday .cal-chip-title"), ["Offsite", "Send invoice"]);
  assert.equal(root.querySelectorAll(".cal-col.is-today .cal-now").length, 1);
  root.querySelector<HTMLElement>(".cal-chip.is-task .cal-chip-open")!.click();
  assert.deepEqual(opened.splice(0), ["Projects/Acme.md:4"]);
});

test("m, a, d and w switch views; j goes a period on and t comes back to today", async () => {
  press("m");
  await settle();
  assert.equal(root.dataset.view, "month");
  assert.equal(root.querySelector(".cal-views button[aria-pressed=true]")!.textContent, "Month");
  const cell = root.querySelector<HTMLElement>(`.cal-cell[data-nav="${today}|"]`)!;
  assert.deepEqual(texts(".cal-chip-title", cell), ["Offsite", "Send invoice"]);
  assert.deepEqual(texts(".cal-more", cell), ["+2 more"]);
  press("a");
  await settle();
  assert.equal(root.dataset.view, "agenda");
  assert.deepEqual(texts(".cal-aday.is-today .cal-arow-title"), ["Offsite", "Send invoice", "Design review", "Standup"]);
  press("j");
  await settle();
  assert.deepEqual(texts(".cal-arow-title"), [], "two weeks on, nothing is on");
  press("t");
  await settle();
  assert.equal(root.querySelectorAll(".cal-aday.is-today .cal-arow").length, 4);
  press("d");
  await settle();
  assert.equal(root.dataset.view, "day");
  assert.deepEqual(texts(".cal-dayhead .cal-dh-journal"), ["Journal"]);
  press("w");
  await settle();
  assert.equal(root.dataset.view, "week");
});

test("an event opens beside the calendar as text, makes its meeting note, and Escape closes it", async () => {
  const standup = [...root.querySelectorAll<HTMLElement>(".cal-ev")].find((e) => e.textContent!.startsWith("Standup"))!;
  standup.click();
  const details = root.querySelector(".cal-details")!;
  assert.equal(details.querySelector("h2")!.textContent, "Standup");
  assert.equal(urls.at(-1), "/calendar/standupaaaaa");
  assert.equal(details.querySelector(".cal-d-desc")!.textContent, "Agenda:\n1. Wins\n2. Blockers");
  assert.equal(details.querySelector(".cal-d-desc")!.children.length, 0, "a feed's markup is never markup here");
  const link = details.querySelector<HTMLAnchorElement>("a[href='https://meet.example.com/abc']")!;
  assert.deepEqual([link.textContent, link.target, link.rel], ["meet.example.com", "_blank", "noopener noreferrer"]);
  assert.deepEqual(texts(".cal-d-people li", details), ["Ana", "bo@example.com"]);
  assert.ok(details.textContent!.includes("Recurring"));
  button("Create meeting note", details)!.click();
  await settle();
  assert.deepEqual(requests.filter((r) => r.url === "/api/calendar/meeting-note").map((r) => r.body.id), ["standupaaaaa"]);
  assert.deepEqual(opened.splice(0), ["Meetings/Standup.md"]);
  press("Escape", details);
  assert.equal(root.querySelector(".cal-details"), null);
  assert.equal(urls.at(-1), "/calendar");
});

test("an event's address opens the page on it; one with a meeting note opens that note without making another", async () => {
  await page.show({ event: "reviewbbbbbb" });
  await settle();
  assert.equal(root.querySelector(".cal-details h2")!.textContent, "Design review");
  const before = requests.length;
  button("Open meeting note", root.querySelector(".cal-details")!)!.click();
  await settle();
  assert.deepEqual(opened.splice(0), ["Meetings/Design review.md"]);
  assert.equal(requests.slice(before).filter((r) => r.url.includes("meeting-note")).length, 0);
});

test("the arrow keys walk a day's events in the week, and Enter opens the one with the keyboard", async () => {
  await page.show();
  await settle();
  const head = root.querySelector<HTMLElement>(`.cal-dayhead[data-nav="${today}|"]`)!;
  head.focus();
  press("ArrowDown", head);
  assert.equal(document.activeElement!.textContent, "Offsite");
  press("ArrowDown", document.activeElement!);
  press("ArrowDown", document.activeElement!);
  assert.equal(document.activeElement!.querySelector(".cal-chip-title")!.textContent, "Design review");
  (document.activeElement as HTMLElement).click(); // Enter on a button
  assert.equal(root.querySelector(".cal-details h2")!.textContent, "Design review");
  press("Escape", root.querySelector(".cal-details")!);
});

test("subscribing shows the server's reason when a feed can't be added", async () => {
  subscribeError = "That address isn't on the public internet";
  button("Calendars", root)!.click();
  const dialog = document.querySelector(".cal-src-box")!;
  await settle();
  assert.deepEqual(texts(".cal-src-name", dialog), ["Work"]);
  const url = dialog.querySelector<HTMLInputElement>(".cal-src-url")!;
  url.value = "webcal://10.0.0.1/cal.ics";
  dialog.querySelector("form")!.dispatchEvent(new window.Event("submit", { cancelable: true }));
  await settle();
  assert.deepEqual(requests.filter((r) => r.url === "/api/calendar/sources" && r.body).map((r) => r.body.url), ["webcal://10.0.0.1/cal.ics"]);
  assert.equal(dialog.querySelector(".cal-src-error")!.textContent, "That address isn't on the public internet");
  press("Escape", url);
  assert.equal(document.querySelector(".cal-src-box"), null);
});

test("a viewer sees the calendars but can't subscribe, rename, remove or make a meeting note", async () => {
  setCalendarContext({ canEdit: false });
  calendarChanged();
  await page.refresh();
  button("Calendars", root)!.click();
  await settle();
  const dialog = document.querySelector(".cal-src-box")!;
  assert.equal(dialog.querySelector("form"), null);
  assert.deepEqual([...dialog.querySelectorAll(".cal-src button")].map((b) => b.getAttribute("aria-label")), ["Refresh Work"]);
  press("Escape", dialog);
  [...root.querySelectorAll<HTMLElement>(".cal-ev")].find((e) => e.textContent!.startsWith("Standup"))!.click();
  const details = root.querySelector(".cal-details")!;
  assert.equal(button("Create meeting note", details), undefined);
  assert.equal(details.querySelector(".cal-d-hint")!.textContent, "No meeting note yet");
  setCalendarContext({ canEdit: true });
});

test("a task due on the calendar ticks from its checkbox (or x), stays struck through, and Undo reopens it", async () => {
  await page.setView("week", today);
  await settle();
  const toasts = () => [...document.querySelectorAll(".toast-text")].map((t) => t.textContent);
  const box = () => root.querySelector<HTMLElement>(".cal-tg-allday .cal-chip.is-task .cal-check")!;
  assert.deepEqual([box().getAttribute("role"), box().getAttribute("aria-checked")], ["checkbox", "false"]);
  box().click();
  await settle();
  const sets = () => requests.filter((r) => r.url === "/api/tasks/set").map((r) => [r.body.path, r.body.line, r.body.done]);
  assert.deepEqual(sets(), [["Projects/Acme.md", 4, true]]);
  assert.equal(toasts().at(-1), "Done: Send invoice");
  // Read again from the notes: a ticked task stays on its day, struck through, so it can be reopened.
  assert.deepEqual([box().getAttribute("aria-checked"), box().closest(".cal-chip")!.classList.contains("is-done")], ["true", true]);
  [...document.querySelectorAll<HTMLElement>(".toast-action")].find((b) => b.textContent === "Undo")!.click();
  await settle();
  assert.deepEqual(sets().at(-1), ["Projects/Acme.md", 4, false]);
  assert.equal(box().getAttribute("aria-checked"), "false");

  // x ticks the task with the keyboard, in the agenda too, where its row keeps the checkbox.
  press("a");
  await settle();
  const open = root.querySelector<HTMLElement>(".cal-arow.is-task .cal-chip-open")!;
  assert.deepEqual([open.textContent, root.querySelectorAll(".cal-arow.is-task .cal-check").length], ["DueSend invoiceAcme", 1]);
  open.focus();
  press("x", open);
  await settle();
  assert.deepEqual(sets().at(-1), ["Projects/Acme.md", 4, true]);
  assert.equal(root.querySelector(".cal-arow.is-task .cal-arow-time")!.textContent, "Done");
});
