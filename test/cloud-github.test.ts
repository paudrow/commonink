import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { startCloud, team, type Cloud } from "./cloud.ts";

// GitHub connected per person (cloud/src/github.ts), against a stand-in for github.com and its API:
// `secret/repo` is private and only the editor's GitHub account can read it; `open/repo` is public.
const calls: Array<{ method: string; path: string; auth: string | undefined; body: string }> = [];
const revoked = new Set<string>();
let github: http.Server;
let cloud: Cloud;
let people: Awaited<ReturnType<typeof team>>;

const issue = (number: number, repo: string, title: string) => ({ number, title, state: "open", html_url: `https://github.com/${repo}/issues/${number}`, labels: [], user: { login: "octo-editor" }, comments: 0, updated_at: "2026-10-01T12:00:00Z" });

before(async () => {
  github = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const auth = req.headers.authorization;
      const path = new URL(req.url!, "http://github").pathname;
      calls.push({ method: req.method!, path, auth, body });
      const send = (status: number, data: object) => (res.writeHead(status, { "content-type": "application/json" }), res.end(JSON.stringify(data)));
      if (path === "/login/oauth/access_token") {
        const f = new URLSearchParams(body);
        const ok = f.get("client_id") === "cid" && f.get("client_secret") === "csecret" && f.get("code") === "code-editor" && !!f.get("code_verifier");
        return send(200, ok ? { access_token: "gho_editor", token_type: "bearer", scope: "repo" } : { error: "bad_verification_code" });
      }
      if (path === "/applications/cid/grant" && req.method === "DELETE") return send(auth === `Basic ${btoa("cid:csecret")}` ? 204 : 401, {});
      const token = auth?.replace(/^Bearer /, "");
      if (token && revoked.has(token)) return send(401, { message: "Bad credentials" });
      if (path === "/user") return token === "gho_editor" ? send(200, { login: "octo-editor" }) : send(401, { message: "Bad credentials" });
      if (path === "/repos/secret/repo/issues/1" && token === "gho_editor") return send(200, issue(1, "secret/repo", "Private plans"));
      const open = path.match(/^\/repos\/open\/repo\/issues\/(\d)$/);
      if (open) return send(200, issue(Number(open[1]), "open/repo", "Public plans"));
      send(404, { message: "Not Found" });
    });
  });
  await new Promise<void>((r) => github.listen(0, "127.0.0.1", r));
  cloud = await startCloud({
    GITHUB_CLIENT_ID: "cid",
    GITHUB_CLIENT_SECRET: "csecret",
    INTEGRATIONS_KEY: Buffer.alloc(32, 7).toString("base64"),
    GITHUB_BASE: `http://127.0.0.1:${(github.address() as AddressInfo).port}`,
  });
  people = await team(cloud);
});
after(() => (cloud.close(), github.close()));

/** The directory's D1, as far as these tests query it. */
interface D1 {
  prepare(sql: string): { first<T = unknown>(col?: string): Promise<T | null>; run(): Promise<unknown> };
}
const db = async (c = cloud) => (await c.server.getWorker().getEnv()).DB as D1;

const pendingOf = (res: { headers: { getSetCookie(): string[] } }) => res.headers.getSetCookie().map((c) => c.split(";")[0]).find((c) => c.startsWith("__Host-ci_gh="))!;
const card = async (cookie: string, link: string) => (await cloud.call(cookie, "GET", `/api/unfurl?url=${encodeURIComponent(link)}`)).github?.title ?? null;
const SECRET = "https://github.com/secret/repo/issues/1";

/** Connect GitHub the way a browser does: start, GitHub's consent (the stand-in just hands back `code`), and back. */
async function connect(cookie: string, code: string, next = "/n/abc") {
  const start = await cloud.request(cookie, "GET", `/auth/github?next=${encodeURIComponent(next)}`);
  const consent = new URL(start.headers.get("location")!);
  const done = await cloud.request(`${cookie}; ${pendingOf(start)}`, "GET", `/auth/github/callback?state=${consent.searchParams.get("state")}&code=${code}`);
  return { consent, back: new URL(done.headers.get("location")!) };
}

test("connecting asks GitHub for repo access, keeps the token sealed, and nothing the app is sent carries it", async () => {
  const { editor } = people;
  assert.deepEqual(await cloud.call(editor, "GET", "/api/github"), { mode: "real", connection: null });
  const { consent, back } = await connect(editor, "code-editor");
  assert.equal(consent.pathname, "/login/oauth/authorize");
  const asked = Object.fromEntries(consent.searchParams);
  assert.deepEqual([asked.client_id, asked.scope, asked.redirect_uri, asked.code_challenge_method], ["cid", "repo", `${cloud.origin}/auth/github/callback`, "S256"]);
  assert.deepEqual([back.pathname, back.searchParams.get("github")], ["/n/abc", "connected"]);

  const info = await cloud.call(editor, "GET", "/api/github");
  assert.equal(info.connection.account, "octo-editor");
  const row = await (await db()).prepare("SELECT access_enc, refresh_enc, scopes FROM connections WHERE provider = 'github'").first<{ access_enc: string; refresh_enc: string | null; scopes: string }>();
  assert.match(row!.access_enc, /^v1\./);
  assert.deepEqual([row!.access_enc.includes("gho_"), row!.refresh_enc, row!.scopes], [false, null, "repo"]);
  assert.equal(/gho_|v1\.|access_enc/.test(JSON.stringify(info)), false);
});

test("a private repo's card shows to the person whose GitHub can read it, and to nobody else", async () => {
  const { editor, owner, viewer } = people;
  assert.equal(await card(editor, SECRET), "Private plans");
  // The public repo's card is read as whoever asks: the editor's token for the editor, none for the owner.
  const from = calls.length;
  assert.equal(await card(editor, "https://github.com/open/repo/issues/2"), "Public plans");
  assert.equal(await card(owner, "https://github.com/open/repo/issues/3"), "Public plans");
  assert.deepEqual(calls.slice(from).map((c) => [c.path, c.auth]), [["/repos/open/repo/issues/2", "Bearer gho_editor"], ["/repos/open/repo/issues/3", undefined]]);
  // What the editor's token read is kept for the editor: the viewer asking for the same link is asked afresh, as no one.
  assert.equal(await card(viewer, "https://github.com/open/repo/issues/2"), "Public plans");
  assert.deepEqual([calls.at(-1)!.path, calls.at(-1)!.auth], ["/repos/open/repo/issues/2", undefined]);
});

test("connecting can't be finished by someone else, without its state, or with a code GitHub refuses", async () => {
  const { owner, viewer } = people;
  const start = await cloud.request(owner, "GET", "/auth/github?next=//evil.example/x");
  const state = new URL(start.headers.get("location")!).searchParams.get("state");
  const pending = pendingOf(start);
  assert.equal((await cloud.request(`${owner}; ${pending}`, "GET", "/auth/github/callback?state=forged&code=code-editor")).status, 400);
  assert.equal((await cloud.request(`${viewer}; ${pending}`, "GET", `/auth/github/callback?state=${state}&code=code-editor`)).status, 400);
  assert.equal((await cloud.request(owner, "GET", `/auth/github/callback?state=${state}&code=code-editor`)).status, 400);
  // Declined at GitHub, or a code it won't take: back in the app (never off it), saying so.
  const denied = await cloud.request(`${owner}; ${pending}`, "GET", `/auth/github/callback?state=${state}&error=access_denied`);
  assert.equal(denied.headers.get("location"), `${cloud.origin}/?github=denied`);
  assert.equal((await connect(owner, "wrong")).back.searchParams.get("github"), "failed");
  assert.deepEqual(await cloud.call(owner, "GET", "/api/github"), { mode: "real", connection: null });
  // Signed out, connecting goes to sign-in first.
  assert.match((await cloud.request(null, "GET", "/auth/github")).headers.get("location")!, /\/auth\/dev\?next=/);
});

test("disconnecting revokes the grant at GitHub and forgets the token", async () => {
  const { editor } = people;
  await cloud.call(editor, "POST", "/api/github/disconnect", {});
  const revoke = calls.at(-1)!;
  assert.deepEqual([revoke.method, revoke.path, JSON.parse(revoke.body)], ["DELETE", "/applications/cid/grant", { access_token: "gho_editor" }]);
  assert.deepEqual(await cloud.call(editor, "GET", "/api/github"), { mode: "real", connection: null });
  assert.equal(await (await db()).prepare("SELECT COUNT(*) AS n FROM connections").first("n"), 0);
  // A link not asked for before is read as no one again.
  await card(editor, "https://github.com/open/repo/issues/4");
  assert.equal(calls.at(-1)!.auth, undefined);
  assert.equal((await cloud.request(editor, "POST", "/api/github/disconnect", {}, { origin: "https://evil.example" })).status, 403);
});

test("a token GitHub refuses ends the connection, and the card falls back to what anyone can read", async () => {
  const { editor } = people;
  await connect(editor, "code-editor");
  revoked.add("gho_editor");
  assert.equal(await card(editor, "https://github.com/open/repo/issues/5"), "Public plans");
  assert.deepEqual(await cloud.call(editor, "GET", "/api/github"), { mode: "real", connection: null });
  revoked.clear();
});

test("without a GitHub OAuth app, Previews get a stand-in: connecting shows its demo private issue", async () => {
  const preview = await startCloud();
  try {
    const me = await preview.signIn("dev");
    const demo = async () => (await preview.call(me, "GET", `/api/unfurl?url=${encodeURIComponent("https://github.com/common-ink-demo/private/issues/1")}`)).github?.repo ?? null;
    assert.deepEqual(await preview.call(me, "GET", "/api/github"), { mode: "mock", connection: null });
    const start = await preview.request(me, "GET", "/auth/github?next=/");
    const consent = new URL(start.headers.get("location")!);
    const both = `${me}; ${pendingOf(start)}`;
    assert.match(await (await preview.request(both, "GET", consent.pathname + consent.search)).text(), /Stand-in for GitHub/);
    const allowed = await preview.server.fetch(new URL(consent.pathname + consent.search, preview.origin), {
      method: "POST",
      redirect: "manual",
      headers: { cookie: both, origin: preview.origin, "content-type": "application/x-www-form-urlencoded" },
      body: "decision=allow",
    });
    const callback = new URL(allowed.headers.get("location")!);
    const done = await preview.request(both, "GET", callback.pathname + callback.search);
    assert.equal(done.headers.get("location"), `${preview.origin}/?github=connected`);
    assert.equal((await preview.call(me, "GET", "/api/github")).connection.account, "octocat");
    assert.equal(await demo(), "common-ink-demo/private");
    await preview.call(me, "POST", "/api/github/disconnect", {});
    assert.deepEqual(await preview.call(me, "GET", "/api/github"), { mode: "mock", connection: null });
  } finally {
    preview.close();
  }
});

test("the migration that lets GitHub in keeps the Google connections already there", () => {
  const dir = path.resolve(import.meta.dirname, "../cloud/migrations");
  const files = fs.readdirSync(dir).sort();
  const at = files.indexOf("0014_github_connection.sql");
  const sql = new DatabaseSync(":memory:");
  sql.exec("PRAGMA foreign_keys = ON");
  for (const f of files.slice(0, at)) sql.exec(fs.readFileSync(path.join(dir, f), "utf8"));
  sql.exec("INSERT INTO users(id, email, name, created_at) VALUES ('u1', 'a@b.example', 'A', 1)");
  sql.exec("INSERT INTO connections VALUES ('u1', 'google', 'a@b.example', 'openid email', 'v1.a.b', 'v1.c.d', 5, 6)");
  assert.throws(() => sql.exec("INSERT INTO connections VALUES ('u1', 'github', 'octocat', 'repo', 'v1.e.f', NULL, 0, 7)"));
  sql.exec(fs.readFileSync(path.join(dir, files[at]), "utf8"));
  sql.exec("INSERT INTO connections VALUES ('u1', 'github', 'octocat', 'repo', 'v1.e.f', NULL, 0, 7)");
  const rows = sql.prepare("SELECT * FROM connections ORDER BY created_at").all().map((r) => Object.values(r).join("|"));
  assert.deepEqual(rows, ["u1|google|a@b.example|openid email|v1.a.b|v1.c.d|5|6", "u1|github|octocat|repo|v1.e.f||0|7"]);
  // Deleting the person still takes their connections.
  sql.exec("DELETE FROM users WHERE id = 'u1'");
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM connections").get()!.n, 0);
});
