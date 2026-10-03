// Google Calendar in the Calendars dialog (web/src/calendar/google.ts) in jsdom, against a stubbed
// server: connecting, adding a calendar here, write-back with and without leave to edit events,
// disconnecting, a server without Google, and the local app, which has no Google at all.
import "./dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";

const { openCalendars } = await import("../web/src/calendar/sources.ts");
const { setCalendarContext, calendarChanged } = await import("../web/src/calendar/data.ts");
const { googleChanged, leave } = await import("../web/src/calendar/google.ts");
const { openMeetingNote } = await import("../web/src/calendar/ui.ts");

type Status = { mode: "real" | "mock" | "off"; connection: { account: string; calendar: boolean; canWrite: boolean; drive: boolean; connectedAt: number } | null } | null;
const server = {
  google: null as Status,
  calendars: [
    { id: "dev@example.com", summary: "Dev", primary: true, accessRole: "owner", timeZone: "America/Los_Angeles" },
    { id: "team@group.calendar.google.com", summary: "Team", primary: false, accessRole: "reader", timeZone: null },
  ],
  sources: [] as any[],
  linkedBack: null as { ok: true } | { ok: false; error: string } | null,
};
const requests: Array<{ path: string; body: any }> = [];
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
globalThis.fetch = (async (input: string, init?: RequestInit) => {
  const path = new URL(input, "http://localhost").pathname;
  const body = init?.body ? JSON.parse(String(init.body)) : null;
  requests.push({ path, body });
  if (path === "/api/google") return server.google ? json(server.google) : json({ error: "Not found" }, 404);
  if (path === "/api/google/calendars") return server.google?.connection ? json(server.calendars) : json({ error: "Connect Google Calendar first" }, 409);
  if (path === "/api/google/disconnect") {
    server.google = { ...server.google!, connection: null };
    server.sources = server.sources.filter((s) => s.kind !== "google");
    return json({ ok: true });
  }
  if (path === "/api/calendar/sources") return json(server.sources);
  if (path === "/api/calendar/google") {
    const s = { id: `g${server.sources.length}`, kind: "google", name: body.name, color: "purple", owner: "u1", url: null, host: null, editable: true, writeBack: false, calendar: body.calendar, status: "ok", error: null, syncedAt: Date.now(), events: 4, createdBy: "me", createdAt: 1 };
    server.sources.push(s);
    return json(s);
  }
  if (path === "/api/calendar/sources/update") {
    const s = server.sources.find((x) => x.id === body.id);
    Object.assign(s, body.writeBack === undefined ? {} : { writeBack: body.writeBack });
    return json(s);
  }
  if (path === "/api/calendar/sources/remove") {
    server.sources = server.sources.filter((x) => x.id !== body.id);
    return json({ ok: true });
  }
  if (path === "/api/calendar/meeting-note") return json({ path: "Meetings/Product sync.md", created: true, linkedBack: server.linkedBack });
  return json({ error: `no stub for ${path}` }, 404);
}) as typeof fetch;

const left: string[] = [];
leave.to = (url) => void left.push(url);
const settle = () => new Promise((r) => setTimeout(r, 30));
const section = () => document.querySelector<HTMLElement>(".cal-google")!;
const byLabel = (label: string, root: ParentNode = document) => [...root.querySelectorAll<HTMLElement>("button, a")].find((b) => b.getAttribute("aria-label") === label || b.textContent === label);
const answer = async (label: string) => {
  await settle();
  byLabel(label, document.querySelector(".ask")!)!.click();
  await settle();
};
async function open(google: Status, workspace = "ws1") {
  server.google = google;
  setCalendarContext({ workspace, canEdit: true });
  calendarChanged();
  googleChanged();
  requests.length = 0;
  openCalendars({ changed() {} });
  await settle();
}
const connected = (canWrite: boolean): Status => ({ mode: "real", connection: { account: "dev@example.com", calendar: true, canWrite, drive: false, connectedAt: 1 } });

test("not connected: Connect goes to Google by way of this workspace, and says who sees what", async () => {
  await open({ mode: "real", connection: null });
  const connect = section().querySelector<HTMLAnchorElement>(".cal-g-connect")!;
  assert.deepEqual([connect.textContent, connect.getAttribute("href")], ["Connect Google Calendar", "/auth/google/calendar?w=ws1"]);
  assert.match(section().textContent!, /show only to you here, not to others in this workspace/);
  assert.match(section().textContent!, /adds a link to your meeting note to the event, never the note's text/);
});

test("connected only to save to Drive: Calendar still asks to connect", async () => {
  await open({ mode: "real", connection: { account: "dev@example.com", calendar: false, canWrite: false, drive: true, connectedAt: 1 } });
  assert.equal(section().querySelector(".cal-g-connect")!.textContent, "Connect Google Calendar");
  assert.equal(requests.filter((r) => r.path === "/api/google/calendars").length, 0);
});

test("connected: your calendars each have Show here, which adds one here, marked as only yours", async () => {
  server.sources = [];
  await open(connected(true));
  assert.match(section().textContent!, /Connected as dev@example.com/);
  const show = byLabel("Show Dev here", section())!;
  assert.equal(show.getAttribute("aria-checked"), "false");
  show.click();
  await settle();
  assert.deepEqual(requests.filter((r) => r.path === "/api/calendar/google").map((r) => r.body), [{ calendar: "dev@example.com", name: "Dev", accessRole: "owner" }]);
  assert.equal(byLabel("Show Dev here", section())!.getAttribute("aria-checked"), "true");
  assert.equal(byLabel("Show Team here", section())!.getAttribute("aria-checked"), "false");
  const row = document.querySelector(".cal-src[data-id='g0'] .cal-src-meta")!;
  assert.match(row.textContent!, /^Only you · Google Calendar · Updated/);
  byLabel("Show Dev here", section())!.click();
  await settle();
  assert.deepEqual(requests.filter((r) => r.path === "/api/calendar/sources/remove").map((r) => r.body), [{ id: "g0" }]);
  assert.equal(server.sources.length, 0);
});

test("Link meeting notes turns write-back on at once where Google allows editing, and asks Google first where it doesn't", async () => {
  server.sources = [];
  await open(connected(true));
  byLabel("Show Dev here", section())!.click();
  await settle();
  byLabel("Link meeting notes to Dev's events", section())!.click();
  await settle();
  assert.deepEqual(requests.filter((r) => r.path === "/api/calendar/sources/update").map((r) => r.body), [{ id: "g0", writeBack: true }]);
  assert.equal(byLabel("Link meeting notes to Dev's events", section())!.getAttribute("aria-checked"), "true");
  assert.deepEqual(left, []);

  server.sources[0].writeBack = false;
  await open(connected(false));
  byLabel("Link meeting notes to Dev's events", section())!.click();
  await answer("Continue to Google");
  assert.deepEqual(requests.filter((r) => r.path === "/api/calendar/sources/update").map((r) => r.body), [{ id: "g0", writeBack: true }]);
  assert.deepEqual(left.splice(0), ["/auth/google/calendar?w=ws1&write=1"]);
  await open(connected(false));
  assert.match(section().querySelector(".cal-g-hint")!.textContent!, /Google hasn't allowed this yet/, "on, but waiting for Google");
});

test("Disconnect asks, disconnects, and your Google calendars go from the list", async () => {
  await open(connected(true));
  assert.equal(document.querySelectorAll(".cal-src").length, 1);
  byLabel("Disconnect", section())!.click();
  await answer("Disconnect");
  assert.deepEqual(requests.filter((r) => r.path === "/api/google/disconnect").length, 1);
  assert.equal(document.querySelectorAll(".cal-src").length, 0);
  assert.equal(section().querySelector(".cal-g-connect")!.textContent, "Connect Google Calendar");
});

test("a server without Google set up says so", async () => {
  await open({ mode: "off", connection: null });
  assert.equal(section().hidden, false);
  assert.equal(section().querySelector(".cal-g-body")!.textContent, "Google isn't configured on this server");
  assert.equal(section().querySelector(".cal-g-connect"), null);
});

test("where there's no Google (a 404, or the local app), there's no Google section", async () => {
  await open(null);
  assert.equal(section().hidden, true);
  await open({ mode: "real", connection: null }, "");
  assert.equal(section().hidden, true);
  assert.deepEqual(requests.filter((r) => r.path.startsWith("/api/google")), [], "the local app never asks");
});

test("a meeting note says whether its link reached the Google event, and offers to allow editing when Google said no", async () => {
  const ev = { id: "productsyncx", title: "Product sync", note: null } as any;
  const toasts = () => [...document.querySelectorAll(".toast-text")].map((t) => t.textContent);
  const opened: string[] = [];
  server.linkedBack = { ok: true };
  await openMeetingNote(ev, (p) => void opened.push(p));
  server.linkedBack = { ok: false, error: "Allow Common Ink to edit your Google events first: turn on Link meeting notes in Calendars" };
  await openMeetingNote(ev, (p) => void opened.push(p));
  assert.deepEqual(opened, ["Meetings/Product sync.md", "Meetings/Product sync.md"]);
  assert.deepEqual(toasts().slice(-2), ["Link added to the event in Google Calendar", "Allow Common Ink to edit your Google events first: turn on Link meeting notes in Calendars"]);
  setCalendarContext({ workspace: "ws1" });
  byLabel("Allow", document.querySelector("#toasts")!)!.click();
  assert.deepEqual(left.splice(0), ["/auth/google/calendar?w=ws1&write=1"]);
});
