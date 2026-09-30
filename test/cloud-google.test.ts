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
  assert.deepEqual(early.linkedBack, { ok: false, error: "Allow Common Ink to edit your Google events first: Calendars, then Allow write-back" });

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
