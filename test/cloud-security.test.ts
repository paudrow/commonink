// Regression tests for the security audit, online: what a GET can do, invite links, and live
// connections after sign-out.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import WebSocket from "ws";
import { startCloud, team, type Cloud } from "./cloud.ts";

let cloud: Cloud;
before(async () => (cloud = await startCloud()));
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
