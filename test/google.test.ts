import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readIcs } from "../src/core/ics.ts";
import { eventsToIcs, exchangeCode, GoogleClient, GoogleError, googleMode, instanceId, refreshGrant, revokeGrant, withNoteLink, type GoogleEvent } from "../cloud/src/google.ts";
import { decrypt, encrypt } from "../cloud/src/secrets.ts";

const LA = "America/Los_Angeles";
const WINDOW = { from: new Date("2026-10-01T00:00:00Z"), to: new Date("2026-11-01T00:00:00Z") };

const SERIES: GoogleEvent = {
  id: "abc",
  iCalUID: "abc@google.com",
  summary: "Sync, weekly",
  description: "Line one\nLine two; with a semicolon",
  start: { dateTime: "2026-10-06T09:00:00-07:00", timeZone: LA },
  end: { dateTime: "2026-10-06T09:30:00-07:00", timeZone: LA },
  recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=TU;COUNT=6", "EXDATE;TZID=America/Los_Angeles:20261020T090000"],
  attendees: [{ email: "ana@example.com", displayName: 'Ana "AL" Lima', responseStatus: "accepted" }, { email: "bo@example.com" }],
  htmlLink: "https://calendar.google.com/calendar/event?eid=x",
};
const MOVED: GoogleEvent = {
  id: "abc_20261013T160000Z",
  iCalUID: "abc@google.com",
  recurringEventId: "abc",
  originalStartTime: { dateTime: "2026-10-13T09:00:00-07:00", timeZone: LA },
  summary: "Sync, moved",
  start: { dateTime: "2026-10-14T10:00:00-07:00", timeZone: LA },
  end: { dateTime: "2026-10-14T10:30:00-07:00", timeZone: LA },
};
const CANCELLED_INSTANCE: GoogleEvent = { id: "abc_20261027T160000Z", iCalUID: "abc@google.com", recurringEventId: "abc", status: "cancelled", originalStartTime: { dateTime: "2026-10-27T09:00:00-07:00", timeZone: LA } };
const ALL_DAY: GoogleEvent = { id: "day1", iCalUID: "day1@google.com", summary: "Offsite", start: { date: "2026-10-08" }, end: { date: "2026-10-10" } };
const DELETED: GoogleEvent = { id: "gone", status: "cancelled" };

test("Google's events read like a feed: the series in its zone, a moved and a cancelled instance, all-day, deleted", () => {
  const { events } = readIcs(eventsToIcs([SERIES, MOVED, CANCELLED_INSTANCE, ALL_DAY, DELETED], "UTC"), WINDOW);
  assert.deepEqual(
    events.map((e) => [e.title, e.start, e.end, e.recurrenceId]),
    [
      ["Sync, weekly", "2026-10-06T16:00:00Z", "2026-10-06T16:30:00Z", "20261006T160000Z"],
      ["Offsite", "2026-10-08", "2026-10-10", null],
      ["Sync, moved", "2026-10-14T17:00:00Z", "2026-10-14T17:30:00Z", "20261013T160000Z"],
      // Oct 20 is excluded and Oct 27 cancelled.
    ],
  );
  const [first] = events;
  assert.deepEqual([first.description, first.url, first.attendees], [
    "Line one\nLine two; with a semicolon",
    "https://calendar.google.com/calendar/event?eid=x",
    [{ name: "Ana AL Lima", email: "ana@example.com", status: "accepted" }, { name: null, email: "bo@example.com", status: "needs-action" }],
  ]);
});

test("an instance's Google ID is its override's, or the series' ID and its original start", () => {
  const kept = [SERIES, MOVED, ALL_DAY];
  assert.deepEqual(
    [instanceId(kept, "abc@google.com", "20261013T160000Z"), instanceId(kept, "abc@google.com", "20261103T170000Z"), instanceId(kept, "day1@google.com", null), instanceId(kept, "nope", null)],
    ["abc_20261013T160000Z", "abc_20261103T170000Z", "day1", null],
  );
});

test("write-back adds only a link, in a block of its own, and linking again replaces it", () => {
  const once = withNoteLink("Agenda:\n1. Roadmap\n", "https://commonink.app/notes/sync-k3x9q2mf");
  assert.equal(once, "Agenda:\n1. Roadmap\n\n— Common Ink —\nMeeting notes: https://commonink.app/notes/sync-k3x9q2mf");
  assert.equal(withNoteLink(once, "https://commonink.app/notes/sync-2-a2b3c4d5"), "Agenda:\n1. Roadmap\n\n— Common Ink —\nMeeting notes: https://commonink.app/notes/sync-2-a2b3c4d5");
  assert.equal(withNoteLink(undefined, "https://x.test/n"), "— Common Ink —\nMeeting notes: https://x.test/n");
  assert.equal(withNoteLink(withNoteLink("", "https://x.test/a"), "https://x.test/b"), "— Common Ink —\nMeeting notes: https://x.test/b");
});

// ------------------------------------------------------------------ against a fake Google

/** Google's endpoints as far as we use them, with one calendar whose events change between syncs. */
const seen: Array<{ method: string; path: string; auth?: string; body: string }> = [];
let events: GoogleEvent[] = [SERIES];
let expireSyncTokens = false;
let base = "";
const fake = http.createServer(async (req, res) => {
  const body = await new Promise<string>((r) => {
    let s = "";
    req.on("data", (c) => (s += c)).on("end", () => r(s));
  });
  const url = new URL(req.url!, "http://x");
  seen.push({ method: req.method!, path: url.pathname + url.search, auth: req.headers.authorization, body });
  const send = (status: number, data: unknown) => res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(data));
  if (url.pathname === "/token") {
    const f = new URLSearchParams(body);
    if (f.get("grant_type") === "authorization_code" && f.get("code") === "good" && f.get("code_verifier") === "v3rifier") {
      const idToken = `x.${Buffer.from(JSON.stringify({ email: "dev@example.com", email_verified: true })).toString("base64url")}.y`;
      return send(200, { access_token: "at-1", refresh_token: "rt-1", expires_in: 3599, scope: "openid https://www.googleapis.com/auth/calendar.readonly", id_token: idToken });
    }
    if (f.get("grant_type") === "refresh_token" && f.get("refresh_token") === "rt-1") return send(200, { access_token: "at-2", expires_in: 3599, scope: "https://www.googleapis.com/auth/calendar.readonly" });
    return send(400, { error: "invalid_grant", error_description: "Token has been expired or revoked." });
  }
  if (url.pathname === "/revoke") return send(new URLSearchParams(body).get("token") === "rt-1" ? 200 : 400, {});
  if (req.headers.authorization !== "Bearer at-1") return send(401, { error: { message: "Invalid Credentials" } });
  if (url.pathname === "/api/users/me/calendarList") {
    return url.searchParams.get("pageToken") === "p2"
      ? send(200, { items: [{ id: "team@group", summary: "Team", summaryOverride: "Our team", accessRole: "reader" }] })
      : send(200, { items: [{ id: "me@example.com", summary: "Me", primary: true, accessRole: "owner", timeZone: LA }], nextPageToken: "p2" });
  }
  const m = url.pathname.match(/^\/api\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/);
  if (m && !m[2]) {
    const token = url.searchParams.get("syncToken");
    if (token && expireSyncTokens) return send(410, { error: { message: "Sync token is no longer valid, a full sync is required." } });
    if (token === "s1") return send(200, { items: [MOVED], nextSyncToken: "s2", timeZone: LA, summary: "Me" });
    if (!url.searchParams.get("pageToken")) return send(200, { items: events.slice(0, 1), nextPageToken: "e2", timeZone: LA, summary: "Me" });
    return send(200, { items: events.slice(1), nextSyncToken: "s1", timeZone: LA, summary: "Me" });
  }
  if (m && m[2] && req.method === "GET") return send(200, { ...SERIES, id: decodeURIComponent(m[2]) });
  if (m && m[2] && req.method === "PATCH") return send(200, {});
  send(404, { error: { message: "Not found" } });
});
before(async () => {
  await new Promise<void>((r) => fake.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(fake.address() as { port: number }).port}`;
});
after(() => fake.close());
const endpoints = () => ({ auth: `${base}/auth`, token: `${base}/token`, revoke: `${base}/revoke`, api: `${base}/api` });

test("tokens: a code becomes a grant with the account's address, a refresh keeps the refresh token, a revoked one fails", async () => {
  const client = { id: "cid", secret: "csecret", redirect: "https://commonink.app/auth/google/calendar/callback" };
  const g = await exchangeCode(client, "good", "v3rifier", endpoints(), fetch, 1_000);
  assert.deepEqual(g, { access: "at-1", refresh: "rt-1", expiresAt: 1_000 + 3_599_000, scopes: ["openid", "https://www.googleapis.com/auth/calendar.readonly"], email: "dev@example.com" });
  const sent = new URLSearchParams(seen.at(-1)!.body);
  assert.deepEqual([sent.get("client_secret"), sent.get("redirect_uri")], ["csecret", client.redirect]);
  assert.deepEqual(await refreshGrant(client, "rt-1", endpoints(), fetch, 0), { access: "at-2", refresh: "rt-1", expiresAt: 3_599_000, scopes: ["https://www.googleapis.com/auth/calendar.readonly"], email: null });
  const refused = await refreshGrant(client, "rt-revoked", endpoints()).catch((e: GoogleError) => [e.status, e.message]);
  assert.deepEqual(refused, [400, "Token has been expired or revoked."]);
  assert.deepEqual([await revokeGrant("rt-1", endpoints()), await revokeGrant("unknown", endpoints())], [true, false]);
});

test("the API client: calendars across pages, a first sync then only changes, a fresh start after 410, and a patch", async () => {
  const api = new GoogleClient(async () => "at-1", endpoints());
  assert.deepEqual((await api.calendars()).map((c) => [c.id, c.summary, c.primary, c.accessRole]), [["me@example.com", "Me", true, "owner"], ["team@group", "Our team", false, "reader"]]);
  events = [SERIES, ALL_DAY];
  assert.deepEqual(await api.changes("me@example.com", null), { events: [SERIES, ALL_DAY], syncToken: "s1", zone: LA, name: "Me" });
  assert.deepEqual(await api.changes("me@example.com", "s1"), { events: [MOVED], syncToken: "s2", zone: LA, name: "Me" });
  expireSyncTokens = true;
  const expired = await api.changes("me@example.com", "s2").catch((e: GoogleError) => e.status);
  expireSyncTokens = false;
  assert.equal(expired, 410);
  await api.describe("me@example.com", "abc_20261013T160000Z", "New text");
  assert.deepEqual(seen.at(-1), { method: "PATCH", path: "/api/calendars/me%40example.com/events/abc_20261013T160000Z", auth: "Bearer at-1", body: '{"description":"New text"}' });
  const wrong = await new GoogleClient(async () => "stale", endpoints()).calendars().catch((e: GoogleError) => [e.status, e.message]);
  assert.deepEqual(wrong, [401, "Invalid Credentials"]);
});

test("sealed tokens open only with the same key and for the same person and purpose", async () => {
  const key = Buffer.from(Array.from({ length: 32 }, (_, i) => i)).toString("base64");
  const other = Buffer.from(Array.from({ length: 32 }, (_, i) => 31 - i)).toString("base64");
  const sealed = await encrypt(key, "ya29.secret-token", "u1:google:access");
  assert.match(sealed, /^v1\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/);
  assert.equal(sealed.includes("secret-token"), false);
  assert.equal(await decrypt(key, sealed, "u1:google:access"), "ya29.secret-token");
  const fails = async (p: Promise<unknown>) => p.then(() => "opened", () => "refused");
  const [v, iv, data] = sealed.split(".");
  const flipped = `${v}.${iv}.${data.slice(0, -4)}${data.slice(-4) === "AAAA" ? "BBBB" : "AAAA"}`;
  assert.deepEqual(
    [await fails(decrypt(key, sealed, "u2:google:access")), await fails(decrypt(key, sealed, "u1:google:refresh")), await fails(decrypt(other, sealed, "u1:google:access")), await fails(decrypt(key, flipped, "u1:google:access"))],
    ["refused", "refused", "refused", "refused"],
  );
  await assert.rejects(encrypt(undefined, "x", "c"), /INTEGRATIONS_KEY isn't set/);
  await assert.rejects(encrypt("c2hvcnQ=", "x", "c"), /must be 32 bytes/);
});

test("Google is real only when fully configured; the stand-in only where developer sign-in is on", () => {
  const env = (vars: Parameters<typeof googleMode>[0]) => vars;
  const full = { GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret", INTEGRATIONS_KEY: "key" };
  assert.deepEqual(
    [googleMode(env({})), googleMode(env({ GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret" })), googleMode(env(full)), googleMode(env({ DEV_LOGIN: "1" })), googleMode(env({ ...full, DEV_LOGIN: "1" }))],
    ["off", "off", "real", "mock", "real"],
  );
});
