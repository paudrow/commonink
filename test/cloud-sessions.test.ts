import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import WebSocket from "ws";
import { startCloud, type Cloud } from "./cloud.ts";

let cloud: Cloud;
before(async () => (cloud = await startCloud()));
after(() => cloud.close());

const me = async (cookie: string) => (await cloud.request(cookie, "GET", "/api/me")).status;
const db = async () => (await cloud.server.getWorker().getEnv()).DB;

test("the session cookie is a __Host- cookie: Secure, HttpOnly, SameSite=Lax, this host only", async () => {
  const res = await cloud.server.fetch(new URL("/auth/dev?as=cookies", cloud.origin), { redirect: "manual" });
  const cookies = res.headers.getSetCookie();
  const session = cookies.find((c) => c.startsWith("__Host-ci_session="))!;
  assert.match(session, /^__Host-ci_session=[\w-]{43}; Path=\/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000$/);
  assert.ok(cookies.includes("ci_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0"), "the old cookie is cleared");
});

test("after sign-in, `next` only ever leads somewhere on this site", async () => {
  const next = async (n: string) => (await cloud.server.fetch(new URL(`/auth/dev?as=nexter&next=${encodeURIComponent(n)}`, cloud.origin), { redirect: "manual" })).headers.get("location");
  assert.deepEqual(
    [await next("/notes/a-b"), await next("//evil.com"), await next("/\\evil.com"), await next("https://evil.com")],
    ["/notes/a-b", "/", "/", "/"],
  );
  // Browsers drop tabs and newlines from a Location before reading it, so "/<tab>/evil.com" is "//evil.com".
  const sneaky = ["/\t/evil.com", "/\n/evil.com", "/\r/evil.com", "\t//evil.com", "/.//evil.com"];
  for (const n of sneaky) {
    const to = await next(n);
    assert.equal(new URL(to ?? "", cloud.origin).origin, cloud.origin, `${JSON.stringify(n)} led to ${JSON.stringify(to)}`);
  }
  assert.equal(await next("/invite/abc?x=1#y"), "/invite/abc?x=1#y");
});

test("signing in again replaces the session, and the old one stops working", async () => {
  const first = await cloud.signIn("rotate");
  const res = await cloud.server.fetch(new URL("/auth/dev?as=rotate", cloud.origin), { redirect: "manual", headers: { cookie: first } });
  const second = res.headers.getSetCookie().map((c) => c.split(";")[0]).find((c) => c.startsWith("__Host-ci_session="))!;
  assert.notEqual(second, first);
  assert.deepEqual([await me(first), await me(second)], [401, 200]);
});

test("a session ends after 14 idle days or 30 days in all, and use keeps it alive", async () => {
  const d = await db();
  const day = 86400_000;
  const ofUser = "user_id = (SELECT id FROM users WHERE email = ?)";
  const set = (who: string, column: "seen_at" | "expires_at", at: number) =>
    d.prepare(`UPDATE sessions SET ${column} = ? WHERE ${ofUser}`).bind(at, `${who}@localhost`).run();
  const [idle, old, busy] = [await cloud.signIn("idle"), await cloud.signIn("old"), await cloud.signIn("busy")];
  await set("idle", "seen_at", Date.now() - 14 * day - 1000);
  await set("old", "expires_at", Date.now() - 1000);
  await set("busy", "seen_at", Date.now() - 13 * day);
  assert.deepEqual([await me(idle), await me(old), await me(busy)], [401, 401, 200]);
  const seen = await d.prepare(`SELECT seen_at AS t FROM sessions WHERE ${ofUser}`).bind("busy@localhost").first();
  assert.ok(Date.now() - seen!.t < 60_000, "using a session marks it seen");
});

test("signing out ends the session on the server, not just in this browser", async () => {
  const cookie = await cloud.signIn("leaver");
  const res = await cloud.request(cookie, "POST", "/auth/logout");
  assert.equal(res.status, 302);
  assert.equal(await me(cookie), 401);
});

test("a cookie from before sessions were stored sends you to sign in, not to an error", async () => {
  const res = await cloud.request("ci_session=eyJ1aWQiOiJ4IiwiZXhwIjo5OTk5OTk5OTk5OTk5fQ.c2ln", "GET", "/api/me");
  assert.deepEqual([res.status, await res.json()], [401, { error: "Sign in first", devLogin: true }]);
});

test("signing out everywhere ends every session and closes open tabs' live connections", async () => {
  const laptop = await cloud.signIn("everywhere");
  const phone = await cloud.signIn("everywhere");
  const { workspaces } = await cloud.call(laptop, "GET", "/api/me");
  const socket = new WebSocket(`${cloud.origin.replace("http", "ws")}/api/w/${workspaces[0].id}/live`, { headers: { cookie: laptop, origin: cloud.origin } });
  await new Promise((resolve, reject) => (socket.once("open", resolve), socket.once("error", reject)));
  const closed = new Promise<number>((resolve) => socket.once("close", resolve));

  const res = await cloud.request(phone, "POST", "/api/sign-out-everywhere", {});
  assert.equal(res.status, 200);
  assert.ok(res.headers.getSetCookie().includes("__Host-ci_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0"));
  assert.equal(await closed, 4001);
  assert.deepEqual([await me(laptop), await me(phone)], [401, 401]);
});
