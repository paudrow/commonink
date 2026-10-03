// Open sign-up (OPEN_SIGNUP=1): someone new confirms on one page that names the Terms, and gets an
// account and a personal workspace, with no code; new accounts are limited per network.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { startCloud, type Cloud } from "./cloud.ts";

// Loaded by a computed name, so this project's typecheck doesn't follow it into Workers types.
const AUTH = "../cloud/src/auth.ts";
const { seal } = (await import(AUTH)) as { seal: (secret: string, payload: object) => Promise<string> };

let cloud: Cloud;
before(async () => (cloud = await startCloud({ OPEN_SIGNUP: "1" })));
after(() => cloud.close());

/** A new Google account's ticket, as the OAuth callback hands it over. */
const ticket = async (sub: string) =>
  `__Host-ci_signup=${await seal("test-only-secret", { sub, profile: { email: `${sub.replace("google:", "")}@example.com`, name: "New Person" }, next: "/", exp: Date.now() + 15 * 60_000 })}`;
const signup = (cookie: string, method: "GET" | "POST", headers: Record<string, string> = {}) =>
  cloud.server.fetch(new URL("/auth/signup", cloud.origin), { method, redirect: "manual", headers: { cookie, ...headers } });

test("with sign-up open, someone new confirms once and has an account and a workspace", async () => {
  const cookie = await ticket("google:newcomer");
  const page = await signup(cookie, "GET");
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /Welcome to Common Ink/);
  assert.match(html, /newcomer@example\.com/);
  assert.match(html, /href="\/terms"/);
  assert.doesNotMatch(html, /name="code"/, "no code is asked for");

  // Only our own page can make the account.
  assert.equal((await signup(cookie, "POST", { origin: "https://evil.example" })).status, 403);

  const made = await signup(cookie, "POST", { origin: cloud.origin });
  assert.equal(made.status, 302);
  const session = made.headers.getSetCookie().map((c) => c.split(";")[0]).find((c) => c.startsWith("__Host-ci_session=") && !c.endsWith("="));
  assert.ok(session, "signed in");
  const me = await cloud.call(session!, "GET", "/api/me");
  assert.equal(me.user.email, "newcomer@example.com");
  assert.equal(me.workspaces.filter((w: { kind: string }) => w.kind === "personal").length, 1);
});

test("open sign-up makes at most ten accounts an hour from one network", async () => {
  const statuses: number[] = [];
  for (let i = 0; i < 11; i++) {
    statuses.push((await signup(await ticket(`google:burst${i}`), "POST", { origin: cloud.origin, "CF-Connecting-IP": "203.0.113.9" })).status);
  }
  assert.deepEqual(statuses.slice(0, 10), Array(10).fill(302));
  assert.equal(statuses[10], 429);
});
