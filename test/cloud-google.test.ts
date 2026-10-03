import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { startCloud, team, type Cloud } from "./cloud.ts";

// The test Worker has developer sign-in and no Google OAuth client, so Google is the stand-in
// (cloud/src/google-mock.ts): the same connection, token and sync code, with a fake Google behind it.
let cloud: Cloud;
let people: Awaited<ReturnType<typeof team>>;
before(async () => {
  cloud = await startCloud();
  people = await team(cloud);
});
after(() => cloud.close());

const WEEK = "from=2026-10-05T00:00:00Z&to=2026-10-12T00:00:00Z";

/** Connect Google the way a browser does: start, the stand-in's consent page, Allow, and back. */
async function connect(cookie: string, write = false) {
  const start = await cloud.request(cookie, "GET", `/auth/google/calendar?w=${people.id}${write ? "&write=1" : ""}`);
  const pending = start.headers.getSetCookie().map((c) => c.split(";")[0]).find((c) => c.startsWith("__Host-ci_gcal="))!;
  const consent = new URL(start.headers.get("location")!);
  const both = `${cookie}; ${pending}`;
  assert.equal((await cloud.request(both, "GET", consent.pathname + consent.search)).status, 200);
  const allowed = await cloud.server.fetch(new URL(consent.pathname + consent.search, cloud.origin), {
    method: "POST",
    redirect: "manual",
    headers: { cookie: both, origin: cloud.origin, "content-type": "application/x-www-form-urlencoded" },
    body: "decision=allow",
  });
  const callback = new URL(allowed.headers.get("location")!);
  const done = await cloud.request(both, "GET", callback.pathname + callback.search);
  return new URL(done.headers.get("location")!);
}

/** The directory's D1, as far as these tests query it. */
interface D1 {
  prepare(sql: string): { first<T = unknown>(col?: string): Promise<T | null>; run(): Promise<unknown> };
}
const db = async () => (await cloud.server.getWorker().getEnv()).DB as D1;

test("connecting keeps the grant sealed in D1, and nothing the app is sent carries a token", async () => {
  const { editor } = people;
  assert.deepEqual(await cloud.call(editor, "GET", "/api/google"), { mode: "mock", connection: null });
  const back = await connect(editor);
  assert.deepEqual([back.pathname, back.searchParams.get("w"), back.searchParams.get("google")], ["/calendar", people.id, "connected"]);

  const info = await cloud.call(editor, "GET", "/api/google");
  assert.deepEqual([info.connection.account, info.connection.canWrite], ["editor@localhost", false]);
  const row = await (await db()).prepare("SELECT access_enc, refresh_enc, scopes FROM connections WHERE provider = 'google'").first<{ access_enc: string; refresh_enc: string; scopes: string }>();
  assert.match(row!.access_enc, /^v1\./);
  assert.match(row!.refresh_enc, /^v1\./);
  assert.equal(`${row!.access_enc}${row!.refresh_enc}`.includes("mock-"), false); // the tokens themselves are "mock-…"

  const calendars = await cloud.call(editor, "GET", "/api/google/calendars");
  assert.deepEqual(calendars.map((c: { summary: string }) => c.summary), ["Dev (demo Google)", "Family (demo Google)", "Company holidays (demo Google)"]);
  const bodies = [JSON.stringify(info), JSON.stringify(calendars), await (await cloud.request(editor, "GET", `${people.base}/calendar/sources`)).text()];
  assert.equal(bodies.some((b) => /mock-|v1\.|access_enc|refresh/.test(b)), false);

  // An access token that's run out is refreshed, sealed again, before Google is asked anything.
  await (await db()).prepare("UPDATE connections SET expires_at = 0").run();
  await cloud.call(editor, "GET", "/api/google/calendars");
  const refreshed = await (await db()).prepare("SELECT access_enc, expires_at FROM connections").first<{ access_enc: string; expires_at: number }>();
  assert.deepEqual([refreshed!.access_enc === row!.access_enc, refreshed!.expires_at > Date.now()], [false, true]);
});

test("a Google calendar is its owner's alone: nobody else in the workspace sees it, its events or its notes", async () => {
  const { base, editor, owner, viewer } = people;
  const mine = await cloud.call(editor, "POST", `${base}/calendar/google`, { calendar: "primary" });
  assert.deepEqual([mine.kind, mine.name, mine.status, mine.editable, mine.writeBack], ["google", "Dev (demo Google)", "ok", true, false]);
  const events: Array<{ id: string; title: string; start: string }> = await cloud.call(editor, "GET", `${base}/calendar/events?${WEEK}&tz=America/Los_Angeles`);
  assert.deepEqual(
    events.filter((e) => e.title === "Product sync").map((e) => e.start),
    ["2026-10-06T20:00:00Z", "2026-10-08T20:00:00Z"],
  );
  const theirs = events.find((e) => e.title === "Product sync")!;

  for (const other of [owner, viewer]) {
    assert.deepEqual(await cloud.call(other, "GET", `${base}/calendar/sources`), []);
    assert.deepEqual(await cloud.call(other, "GET", `${base}/calendar/events?${WEEK}`), []);
    assert.equal((await cloud.request(other, "GET", `${base}/calendar/event?id=${theirs.id}`)).status, 404);
    assert.equal((await cloud.request(other, "POST", `${base}/calendar/sources/remove`, { id: mine.id })).status, 404);
  }
  assert.equal((await cloud.request(owner, "POST", `${base}/calendar/meeting-note`, { id: theirs.id })).status, 404);
  // Nor can someone without a connection add one, whatever the calendar's ID.
  const refused = await cloud.request(owner, "POST", `${base}/calendar/google`, { calendar: "primary" });
  assert.deepEqual([refused.status, (await refused.json()).error], [400, "Google Calendar isn't connected any more. Connect it again from Calendars."]);
});

test("write-back adds only the meeting note's link, once the owner allowed editing events and turned it on", async () => {
  const { base, editor } = people;
  const [source] = (await cloud.call(editor, "GET", `${base}/calendar/sources`)) as Array<{ id: string }>;
  const events: Array<{ id: string; title: string }> = await cloud.call(editor, "GET", `${base}/calendar/events?${WEEK}&tz=America/Los_Angeles`);
  const [first, second] = events.filter((e) => e.title === "Product sync");

  // Write-back is off: the note is made and nothing goes to Google.
  assert.deepEqual(await cloud.call(editor, "POST", `${base}/calendar/meeting-note`, { id: first.id, timeZone: "America/Los_Angeles" }), { path: "Meetings/2026-10-06 Product sync.md", created: true, linkedBack: null });
  // On, but Google hasn't been asked for editing yet.
  await cloud.call(editor, "POST", `${base}/calendar/sources/update`, { id: source.id, writeBack: true });
  const early = await cloud.call(editor, "POST", `${base}/calendar/meeting-note`, { id: second.id, timeZone: "America/Los_Angeles" });
  assert.deepEqual(early.linkedBack, { ok: false, error: "Allow Common Ink to edit your Google events first: turn on Link meeting notes in Calendars" });

  await connect(editor, true);
  assert.equal((await cloud.call(editor, "GET", "/api/google")).connection.canWrite, true);
  const [third] = (await cloud.call(editor, "GET", `${base}/calendar/events?from=2026-10-12T00:00:00Z&to=2026-10-19T00:00:00Z&q=product`)) as Array<{ id: string }>;
  const made = await cloud.call(editor, "POST", `${base}/calendar/meeting-note`, { id: third.id, timeZone: "America/Los_Angeles" });
  assert.deepEqual(made, { path: "Meetings/2026-10-13 Product sync.md", created: true, linkedBack: { ok: true } });
  const note = await cloud.call(editor, "GET", `${base}/note?path=${encodeURIComponent(made.path)}`);

  await cloud.call(editor, "POST", `${base}/calendar/refresh`, { id: source.id });
  const after = await cloud.call(editor, "GET", `${base}/calendar/event?id=${third.id}`);
  const slug = note.title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  assert.equal(after.description, `Roadmap, then blockers.\n\n— Common Ink —\nMeeting notes: ${cloud.origin}/notes/${slug}-${note.id}`);
  assert.equal(after.description.includes("Action items"), false); // only the link, never the note
  assert.equal(after.note.path, made.path);
});

test("events made in the app: in a Google calendar once editing is allowed, moved and deleted there; never in one only readable", async () => {
  const { base, editor, owner } = people;
  const sources: Array<{ id: string; calendar: string | null; writable: boolean }> = await cloud.call(editor, "GET", `${base}/calendar/sources`);
  const mine = sources.find((s) => s.calendar === "primary")!;
  assert.equal(mine.writable, true);
  const draft = { source: mine.id, title: "Pairing", start: "2026-10-07T17:00:00Z", end: "2026-10-07T18:00:00Z", timeZone: "America/Chicago", attendees: [{ name: "Ana", email: "ana@example.com" }] };
  // Editing was granted in the write-back test; the stand-in keeps what's written in the workspace.
  const made = await cloud.call(editor, "POST", `${base}/calendar/events`, { ...draft, meetingNote: true });
  assert.deepEqual([made.event.title, made.event.start, made.event.source, made.note.path], ["Pairing", "2026-10-07T17:00:00Z", mine.id, "Meetings/2026-10-07 Pairing.md"]);
  const moved = await cloud.call(editor, "POST", `${base}/calendar/events/update`, { id: made.event.id, start: "2026-10-08T19:00:00Z", end: "2026-10-08T20:30:00Z" });
  assert.deepEqual([moved.id, moved.start, moved.end, moved.note?.path], [made.event.id, "2026-10-08T19:00:00Z", "2026-10-08T20:30:00Z", "Meetings/2026-10-07 Pairing.md"]);

  // One instance of a series moves alone; the rest stay.
  const series: Array<{ id: string; start: string }> = await cloud.call(editor, "GET", `${base}/calendar/events?from=2026-10-12T00:00:00Z&to=2026-10-17T00:00:00Z&q=product`);
  await cloud.call(editor, "POST", `${base}/calendar/events/update`, { id: series[0].id, start: "2026-10-13T22:00:00Z", end: "2026-10-13T22:30:00Z" });
  const after: Array<{ id: string; start: string }> = await cloud.call(editor, "GET", `${base}/calendar/events?from=2026-10-12T00:00:00Z&to=2026-10-17T00:00:00Z&q=product`);
  assert.deepEqual(after.map((e) => [e.id, e.start]), [[series[0].id, "2026-10-13T22:00:00Z"], [series[1].id, series[1].start]]);

  // Nobody else can touch it, and a calendar only readable takes nothing.
  assert.equal((await cloud.request(owner, "POST", `${base}/calendar/events/update`, { id: made.event.id, title: "Mine" })).status, 404);
  const readOnly = await cloud.call(editor, "POST", `${base}/calendar/google`, { calendar: "holidays@demo", accessRole: "reader" });
  assert.equal(readOnly.writable, false);
  const refused = await cloud.request(editor, "POST", `${base}/calendar/events`, { ...draft, source: readOnly.id });
  assert.deepEqual([refused.status, (await refused.json()).error], [403, "You can't add events to that calendar"]);
  await cloud.call(editor, "POST", `${base}/calendar/sources/remove`, { id: readOnly.id });

  await cloud.call(editor, "POST", `${base}/calendar/events/delete`, { id: made.event.id });
  assert.equal((await cloud.request(editor, "GET", `${base}/calendar/event?id=${made.event.id}`)).status, 404);
});

test("disconnecting forgets the grant and takes the person's Google calendars out of every workspace", async () => {
  const { editor } = people;
  const me = await cloud.call(editor, "GET", "/api/me");
  const personal = `/api/w/${me.workspaces.find((w: { kind: string }) => w.kind === "personal").id}`;
  await cloud.call(editor, "POST", `${personal}/calendar/google`, { calendar: "family@demo" });
  await cloud.call(editor, "POST", "/api/google/disconnect", {});
  assert.deepEqual(await cloud.call(editor, "GET", "/api/google"), { mode: "mock", connection: null });
  assert.equal(await (await db()).prepare("SELECT COUNT(*) AS n FROM connections").first("n"), 0);
  for (const b of [people.base, personal]) {
    assert.deepEqual(await cloud.call(editor, "GET", `${b}/calendar/sources`), []);
    assert.deepEqual(await cloud.call(editor, "GET", `${b}/calendar/events?${WEEK}`), []);
  }
  assert.equal((await cloud.request(editor, "GET", "/api/google/calendars")).status, 409);
});

test("leaving a workspace takes your own calendars there with you", async () => {
  const { base, viewer, owner } = people;
  await connect(viewer);
  const mine = await cloud.call(viewer, "POST", `${base}/calendar/google`, { calendar: "holidays@demo" });
  assert.equal(mine.kind, "google");
  await cloud.call(owner, "POST", `${base}/members/remove`, { user: (await cloud.call(viewer, "GET", "/api/me")).user.id });
  const storage = await cloud.server.getWorker().getDurableObjectStorage("WORKSPACE", { name: people.id });
  assert.deepEqual(await storage.exec("SELECT id FROM sources WHERE kind = 'google'"), []);
});

test("adding Google calendars is limited per person, as subscribing is, so even a viewer can't loop it against Google", async () => {
  const { base, owner } = people;
  const looper = await cloud.signIn("looper");
  const { url } = await cloud.call(owner, "POST", `${base}/invites`, { role: "viewer" });
  assert.equal((await cloud.request(looper, "POST", new URL(url).pathname)).status, 302);
  await connect(looper);
  const seen: number[] = [];
  for (let i = 0; i < 61; i++) {
    // Each add reads the whole calendar from Google, whether it's then removed or was never there.
    const res = await cloud.request(looper, "POST", `${base}/calendar/google`, { calendar: i % 2 ? "nope@demo" : "holidays@demo" });
    seen.push(res.status);
    const added = res.status === 200 ? ((await res.json()) as { id: string }) : (await res.body?.cancel(), null);
    if (added) await cloud.call(looper, "POST", `${base}/calendar/sources/remove`, { id: added.id });
  }
  assert.deepEqual([seen.slice(0, 60).every((s) => s !== 429), seen[60]], [true, 429]);
  assert.equal((await cloud.request(looper, "POST", `${base}/calendar/refresh`, {})).status, 429, "the same hour's allowance as refreshing");
});

test("with a real Google client configured, connecting goes to Google, and the stand-in isn't there", async () => {
  const real = await startCloud({ GOOGLE_CLIENT_ID: "cid.apps.googleusercontent.com", GOOGLE_CLIENT_SECRET: "csecret", INTEGRATIONS_KEY: Buffer.alloc(32, 7).toString("base64") });
  try {
    const me = await real.signIn("realgoogle");
    assert.equal((await real.call(me, "GET", "/api/google")).mode, "real");
    const start = await real.request(me, "GET", "/auth/google/calendar?w=abc");
    const to = new URL(start.headers.get("location")!);
    assert.deepEqual(
      [to.origin + to.pathname, to.searchParams.get("scope"), to.searchParams.get("access_type"), to.searchParams.get("redirect_uri"), to.searchParams.get("code_challenge_method")],
      ["https://accounts.google.com/o/oauth2/v2/auth", "openid email https://www.googleapis.com/auth/calendar.readonly", "offline", `${real.origin}/auth/google/calendar/callback`, "S256"],
    );
    assert.equal(new URL((await real.request(me, "GET", "/auth/google/calendar?w=abc&write=1")).headers.get("location")!).searchParams.get("scope")!.split(" ").includes("https://www.googleapis.com/auth/calendar.events"), true);
    assert.equal((await real.request(me, "GET", `/auth/google/calendar/mock?state=${to.searchParams.get("state")}`)).status, 404);
  } finally {
    real.close();
  }
});
