import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ACCOUNT_ROUTES, WORKSPACE_ROUTES } from "../cloud/src/access.ts";
import { startCloud, team, type Cloud } from "./cloud.ts";

const WHO = ["signedOut", "stranger", "viewer", "editor", "owner"] as const;
type Who = (typeof WHO)[number];
/** "ok" is any success (2xx, a redirect, or a WebSocket's 101); a number is that exact status. */
type Expect = "ok" | number;
type Send = [method: string, path: string, body?: unknown, headers?: Record<string, string>];

const READ: Expect[] = [401, 404, "ok", "ok", "ok"];
const EDIT: Expect[] = [401, 404, 403, "ok", "ok"];
const OWN: Expect[] = [401, 404, 403, 403, "ok"];
const SIGNED_IN: Expect[] = [401, "ok", "ok", "ok", "ok"];

let cloud: Cloud;
let people: Awaited<ReturnType<typeof team>>;
let welcomeId: string;
const restoreIds = {} as Record<Who, number>;

/**
 * Every route online, what each kind of person gets back, and a request that works for anyone
 * allowed. Writes act on each person's own notes, so one person's write can't change another's result.
 */
const MATRIX: Array<{ route: string; send: (w: Who) => Send; expect: Expect[] }> = [
  { route: "GET /info", send: () => ["GET", "/info"], expect: READ },
  { route: "GET /notes", send: () => ["GET", "/notes"], expect: READ },
  { route: "GET /note", send: () => ["GET", "/note?path=Welcome.md"], expect: READ },
  { route: "GET /resolve", send: () => ["GET", "/resolve?target=Welcome"], expect: READ },
  { route: "GET /search", send: () => ["GET", "/search?q=welcome"], expect: READ },
  { route: "GET /feed", send: () => ["GET", "/feed"], expect: READ },
  { route: "GET /backlinks", send: () => ["GET", "/backlinks?path=Welcome.md"], expect: READ },
  { route: "GET /changes", send: () => ["GET", "/changes"], expect: READ },
  { route: "GET /diffs", send: () => ["GET", "/diffs?ids=1-3"], expect: READ },
  { route: "GET /diff", send: () => ["GET", "/diff?from=1"], expect: READ },
  { route: "GET /tasks", send: () => ["GET", "/tasks"], expect: READ },
  { route: "GET /favorites", send: () => ["GET", "/favorites"], expect: READ },
  { route: "GET /files/*", send: () => ["GET", "/files/assets/margin.svg"], expect: READ },
  { route: "GET /file-resolve", send: () => ["GET", "/file-resolve?target=margin.svg"], expect: READ },
  { route: "GET /live", send: () => ["GET", "/live", undefined, liveHeaders()], expect: READ },
  { route: "POST /favorites/star", send: () => ["POST", "/favorites/star", { path: "Welcome.md" }], expect: READ },
  { route: "POST /favorites/unstar", send: () => ["POST", "/favorites/unstar", { path: "Welcome.md" }], expect: READ },
  { route: "PUT /favorites", send: () => ["PUT", "/favorites", { paths: [] }], expect: READ },
  { route: "PUT /note", send: (w) => ["PUT", "/note", { path: `put-${w}.md`, content: "# Put\n" }], expect: EDIT },
  { route: "POST /note", send: (w) => ["POST", "/note", { path: `new-${w}.md`, content: "# New\n" }], expect: EDIT },
  { route: "POST /tasks/set", send: (w) => ["POST", "/tasks/set", { path: `tasks-${w}.md`, line: 1, text: "Do it", done: true }], expect: EDIT },
  { route: "POST /move", send: (w) => ["POST", "/move", { from: `move-${w}.md`, to: `moved-${w}.md` }], expect: EDIT },
  { route: "POST /restore", send: (w) => ["POST", "/restore", { id: restoreIds[w] ?? 1 }], expect: EDIT },
  { route: "POST /archive", send: (w) => ["POST", "/archive", { paths: [`arch-${w}.md`] }], expect: EDIT },
  { route: "POST /unarchive", send: (w) => ["POST", "/unarchive", { paths: [`Archive/unarch-${w}.md`] }], expect: EDIT },
  { route: "POST /upload", send: (w) => ["POST", `/upload?name=up-${w}.txt`, new TextEncoder().encode("hi"), { "content-type": "text/plain" }], expect: EDIT },
  { route: "POST /invites", send: () => ["POST", "/invites", { role: "viewer" }], expect: OWN },
  { route: "GET /api/me", send: () => ["GET", "/api/me"], expect: SIGNED_IN },
  { route: "POST /api/workspaces", send: (w) => ["POST", "/api/workspaces", { name: `${w}'s team` }], expect: SIGNED_IN },
  { route: "GET /api/unfurl", send: () => ["GET", "/api/unfurl?url=https://example.invalid/"], expect: SIGNED_IN },
  { route: "GET /api/note-ids/*", send: () => ["GET", `/api/note-ids/${welcomeId}`], expect: READ },
  // Last: it ends everyone's sessions.
  { route: "POST /api/sign-out-everywhere", send: () => ["POST", "/api/sign-out-everywhere", {}], expect: SIGNED_IN },
];

const liveHeaders = () => ({ origin: cloud.origin, upgrade: "websocket", connection: "Upgrade", "sec-websocket-version": "13", "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==" });

before(async () => {
  cloud = await startCloud();
  people = await team(cloud);
  const { owner, base } = people;
  for (const w of WHO) {
    const note = (p: string, content = "# Note\n") => cloud.call(owner, "POST", `${base}/note`, { path: p, content });
    await note(`tasks-${w}.md`, "- [ ] Do it\n");
    await note(`move-${w}.md`);
    await note(`arch-${w}.md`);
    await note(`unarch-${w}.md`);
    await cloud.call(owner, "POST", `${base}/archive`, { paths: [`unarch-${w}.md`] });
    await note(`restore-${w}.md`);
    await cloud.call(owner, "PUT", `${base}/note`, { path: `restore-${w}.md`, content: "# Changed\n" });
    restoreIds[w] = (await cloud.call(owner, "GET", `${base}/changes?path=restore-${w}.md&limit=1`))[0].id;
  }
  const notes: Array<{ path: string; id: string }> = await cloud.call(owner, "GET", `${base}/notes`);
  welcomeId = notes.find((n) => n.path === "Welcome.md")!.id;
  // Note IDs reach the directory just after the request that made them.
  for (let i = 0; i < 50 && (await cloud.request(owner, "GET", `/api/note-ids/${welcomeId}`)).status !== 200; i++) await new Promise((r) => setTimeout(r, 50));
});

after(() => cloud.close());

test("every route online has a row in the access matrix, and every API route has a role", () => {
  assert.deepEqual(MATRIX.map((r) => r.route).sort(), [...Object.keys(WORKSPACE_ROUTES), ...ACCOUNT_ROUTES].sort());
  const api = fs.readFileSync(path.resolve(import.meta.dirname, "../src/core/api.ts"), "utf8");
  const coreRoutes = [...api.matchAll(/case "((?:GET|POST|PUT|PATCH|DELETE) \/[^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual(coreRoutes.filter((r) => !(r in WORKSPACE_ROUTES)), [], "core API routes with no role in cloud/src/access.ts");
});

test("each route answers each kind of person as the matrix says", async () => {
  const cookie = (w: Who) => (w === "signedOut" ? null : people[w]);
  const actual: Record<string, Expect[]> = {};
  const expected: Record<string, Expect[]> = {};
  for (const row of MATRIX) {
    expected[row.route] = row.expect;
    actual[row.route] = [];
    for (const [i, w] of WHO.entries()) {
      const [method, p, body, headers] = row.send(w);
      const res = await cloud.request(cookie(w), method, p.startsWith("/api/") ? p : `${people.base}${p}`, body, headers);
      await res.body?.cancel();
      actual[row.route].push(row.expect[i] === "ok" && res.status < 400 ? "ok" : res.status);
    }
  }
  assert.deepEqual(actual, expected);
});

test("a workspace checks the role again, whatever the Worker forwarded", async () => {
  const env = await cloud.server.getWorker().getEnv();
  const stub = env.WORKSPACE.get(env.WORKSPACE.idFromName(people.id));
  const send = async (method: string, route: string, role?: string) => {
    const headers: Record<string, string> = { "x-ci-workspace": people.id, "content-type": "application/json" };
    if (role) headers["x-ci-role"] = role;
    const res = await stub.fetch(`https://workspace${route}`, { method, headers, body: method === "GET" ? undefined : JSON.stringify({ path: "forged.md", content: "x" }) });
    return res.status;
  };
  assert.deepEqual(
    [await send("POST", "/note", "viewer"), await send("POST", "/note"), await send("POST", "/note", "admin"), await send("POST", "/seed", "owner"), await send("GET", "/info", "viewer")],
    [403, 403, 403, 404, 200],
  );
});
