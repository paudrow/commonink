// Regression tests for the security audit, online: what a GET can do, invite links, and live
// connections after sign-out.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import WebSocket from "ws";
import { startCloud, team, type Cloud } from "./cloud.ts";

// Loaded by a computed name, so this project's typecheck doesn't follow it into Workers types.
const AUTH = "../cloud/src/auth.ts";
const { seal } = (await import(AUTH)) as { seal: (secret: string, payload: object) => Promise<string> };

let cloud: Cloud;
before(async () => (cloud = await startCloud({ SIGNUP_CODE: "open sesame" })));
after(() => cloud.close());

const me = async (cookie: string) => (await cloud.request(cookie, "GET", "/api/me")).status;
const inviteLink = async (owner: string, base: string) => new URL((await cloud.call(owner, "POST", `${base}/invites`, { role: "editor" })).url).pathname;

test("opening an invite link only asks; joining takes a POST from our own page, and the link works once", async () => {
  const { owner, base, id } = await team(cloud);
  const link = await inviteLink(owner, base);
  const [ana, ben] = [await cloud.signIn("ana"), await cloud.signIn("ben")];
  const workspaces = async (cookie: string) => (await cloud.call(cookie, "GET", "/api/me")).workspaces.map((w: { id: string }) => w.id);

  const ask = await cloud.request(ana, "GET", link);
  assert.deepEqual([ask.status, (await ask.text()).includes("<h1>Join Team?</h1>")], [200, true]);
  assert.equal((await workspaces(ana)).includes(id), false, "an <img src> of the link joins nobody");
  assert.equal((await cloud.request(ana, "POST", link, undefined, { origin: "https://evil.example" })).status, 403);

  assert.equal((await cloud.request(ana, "POST", link)).status, 302);
  assert.equal((await workspaces(ana)).includes(id), true);
  assert.equal((await cloud.request(ben, "POST", link)).status, 410, "used up");
  assert.equal((await workspaces(ben)).includes(id), false);
});

test("invite tokens are stored hashed", async () => {
  const { owner, base } = await team(cloud);
  const token = (await inviteLink(owner, base)).split("/")[2];
  const env = await cloud.server.getWorker().getEnv();
  const stored = await env.DB.prepare("SELECT COUNT(*) AS n FROM invites WHERE token = ?").bind(token).first();
  assert.deepEqual([token.length, stored.n], [40, 0]);
});

test("opening /auth/logout only asks; signing out takes a POST from our own page", async () => {
  const cookie = await cloud.signIn("stayer");
  assert.equal((await cloud.request(cookie, "GET", "/auth/logout")).status, 200);
  assert.equal((await cloud.request(cookie, "POST", "/auth/logout", undefined, { origin: "https://evil.example" })).status, 403);
  assert.equal(await me(cookie), 200);
});

test("signing out closes that browser's live connections, and only those", async () => {
  const [tab, phone] = [await cloud.signIn("closer"), await cloud.signIn("closer")];
  const { workspaces } = await cloud.call(tab, "GET", "/api/me");
  const open = async (cookie: string) => {
    const socket = new WebSocket(`${cloud.origin.replace("http", "ws")}/api/w/${workspaces[0].id}/live`, { headers: { cookie, origin: cloud.origin } });
    await new Promise((resolve, reject) => (socket.once("open", resolve), socket.once("error", reject)));
    return socket;
  };
  const [a, b] = [await open(tab), await open(phone)];
  const closed = new Promise<number>((resolve) => a.once("close", resolve));
  await cloud.request(tab, "POST", "/auth/logout");
  assert.equal(await closed, 4001);
  assert.equal(b.readyState, WebSocket.OPEN, "the other device stays connected");
  b.close();
});

test("a live connection closes when its session runs out, before it hears anything more", async () => {
  const [tab, writer] = [await cloud.signIn("expirer"), await cloud.signIn("expirer")];
  const env = await cloud.server.getWorker().getEnv();
  // The tab's session (the first one) has a second and a half left.
  await env.DB.prepare(
    `UPDATE sessions SET expires_at = ? WHERE id = (SELECT id FROM sessions WHERE user_id = (SELECT id FROM users WHERE email = 'expirer@localhost') ORDER BY created_at LIMIT 1)`,
  ).bind(Date.now() + 1500).run();
  const { workspaces } = await cloud.call(writer, "GET", "/api/me");
  const base = `/api/w/${workspaces[0].id}`;
  const socket = new WebSocket(`${cloud.origin.replace("http", "ws")}${base}/live`, { headers: { cookie: tab, origin: cloud.origin } });
  await new Promise((resolve, reject) => (socket.once("open", resolve), socket.once("error", reject)));
  const heard: string[] = [];
  socket.on("message", (m) => heard.push(String(m)));
  const closed = new Promise<number>((resolve) => socket.once("close", resolve));
  await new Promise((r) => setTimeout(r, 1700));
  await cloud.call(writer, "PUT", `${base}/note`, { path: "After.md", content: "# After\nsecret\n" });
  assert.equal(await closed, 4001);
  assert.deepEqual(heard.filter((m) => m.includes("secret")), []);
});

test("bad input gets a 4xx with a plain message, never an exception from inside", async () => {
  const cookie = await cloud.signIn("sloppy");
  const { workspaces } = await cloud.call(cookie, "GET", "/api/me");
  const base = `/api/w/${workspaces[0].id}`;
  const raw = (method: string, p: string, body: string) =>
    cloud.server.fetch(new URL(p, cloud.origin), { method, headers: { cookie, origin: cloud.origin, "content-type": "application/json" }, body });
  const answers = [
    await raw("POST", "/api/workspaces", ""),
    await raw("POST", "/api/agents/revoke", "{not json"),
    await cloud.request(cookie, "GET", `${base}/files/%E0%A4%A`),
    await cloud.request(cookie, "GET", `${base}/files/..%2f..%2fx.png`),
  ];
  assert.deepEqual(
    await Promise.all(answers.map(async (r) => [r.status, ((await r.json()) as { error: string }).error])),
    [
      [400, "Give the workspace a name"],
      [400, '"id" must be a string'],
      [404, "Not found"],
      [400, "Invalid path: ../../x.png"],
    ],
  );
});

test("wrong sign-up codes sent all at once still get only five tries a day", async () => {
  // A new Google account's ticket, as the OAuth callback hands it over.
  const ticket = async (sub: string) =>
    `__Host-ci_signup=${await seal("test-only-secret", { sub, profile: { email: `${sub}@example.com`, name: sub }, next: "/", exp: Date.now() + 15 * 60_000 })}`;
  const tryCode = (cookie: string, code: string) =>
    cloud.server.fetch(new URL("/auth/signup", cloud.origin), {
      method: "POST",
      redirect: "manual",
      headers: { cookie, origin: cloud.origin, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code }).toString(),
    });

  const guesser = await ticket("google:guesser");
  const statuses = (await Promise.all(Array.from({ length: 20 }, (_, i) => tryCode(guesser, `guess ${i}`)))).map((r) => r.status);
  assert.equal(statuses.filter((s) => s === 403).length, 5, "five wrong codes are checked");
  assert.equal(statuses.filter((s) => s === 429).length, 15, "the rest are refused unchecked");
  assert.equal((await tryCode(guesser, "open sesame")).status, 429, "even the right code waits until tomorrow");

  // Someone who mistypes a few times at once still gets in with the right code.
  const typo = await ticket("google:typo");
  await Promise.all([tryCode(typo, "open sesme"), tryCode(typo, "opn sesame")]);
  assert.equal((await tryCode(typo, "open sesame")).status, 302);
});
