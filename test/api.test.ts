import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { handleApi, type ApiHost } from "../src/core/api.ts";
import { openTempVault } from "./helpers.ts";

function setup() {
  const { dir, quire } = openTempVault();
  const events: string[] = [];
  const host: ApiHost = {
    quire,
    actor: "tester",
    user: "tester",
    info: () => ({ mode: "test" }),
    written: (rel, _content, _version, change) => events.push(`written ${rel} by ${change?.source ?? "-"}`),
    moved: (from, to) => events.push(`moved ${from} -> ${to}`),
    tree: () => events.push("tree"),
  };
  const call = async (method: string, route: string, body?: unknown) => {
    const init: RequestInit = { method, headers: { "Content-Type": "application/json" } };
    if (body !== undefined) init.body = typeof body === "string" ? body : JSON.stringify(body);
    const res = await handleApi(host, new Request(`http://localhost/api${route}`, init), route.split("?")[0]);
    assert.ok(res, `route ${route} exists`);
    return { status: res.status, body: await res.json() };
  };
  return { dir, quire, events, call };
}

test("a PUT then GET round-trips a note and announces the write", async () => {
  const { call, events } = setup();
  const put = await call("PUT", "/note", { path: "Ideas/New.md", content: "# New\n" });
  assert.equal(put.status, 200);
  assert.equal(put.body.path, "Ideas/New.md");
  const got = await call("GET", "/note?path=Ideas/New");
  assert.equal(got.body.content, "# New\n");
  assert.deepEqual(events, ["written Ideas/New.md by tester", "tree"]);
});

test("a POST for a note that exists is a 409 naming it, so the app opens it instead of writing over it", async () => {
  const { call } = setup();
  assert.equal((await call("POST", "/note", { path: "Idea.md", content: "# Idea\n\nfirst\n" })).status, 200);
  const again = await call("POST", "/note", { path: "Idea.md", content: "# Idea\n\nsecond\n" });
  assert.deepEqual([again.status, again.body.code, again.body.path], [409, "exists", "Idea.md"]);
  assert.equal((await call("GET", "/note?path=Idea.md")).body.content, "# Idea\n\nfirst\n");
});

test("a stale baseVersion is a 409 carrying the current text", async () => {
  const { call } = setup();
  const r = await call("PUT", "/note", { path: "Welcome.md", content: "# Mine\n", baseVersion: "000000000000" });
  assert.equal(r.status, 409);
  assert.equal(r.body.code, "conflict");
  assert.equal(r.body.content, "# Welcome\n\nStart with [[Roadmap]].\n\n![[chart.svg]]\n");
});

test("the API refuses to blank out a note unless told to", async () => {
  const { call } = setup();
  assert.equal((await call("PUT", "/note", { path: "Welcome.md", content: "  \n" })).status, 422);
  assert.equal((await call("PUT", "/note", { path: "Welcome.md", content: "", allowEmpty: true })).status, 200);
});

test("malformed request bodies are 400s with a message, not 500s", async () => {
  const { call } = setup();
  const cases: Array<[string, string, unknown, RegExp]> = [
    ["PUT", "/note", "{not json", /Invalid JSON/],
    ["PUT", "/note", null, /JSON object/],
    ["PUT", "/note", [], /JSON object/],
    ["PUT", "/note", {}, /"path" must be a string/],
    ["PUT", "/note", { path: 5, content: "x" }, /"path" must be a string/],
    ["PUT", "/note", { path: "a.md", content: 5 }, /"content" must be a string/],
    ["POST", "/note", {}, /"path" must be a string/],
    ["POST", "/move", { from: "Welcome" }, /"to" must be a string/],
    ["POST", "/archive", { paths: [42] }, /"paths" must be a list of strings/],
    ["POST", "/archive", { paths: "Welcome" }, /"paths" must be a list of strings/],
    ["POST", "/tasks/set", { path: "Roadmap", line: "x", text: "a", done: true }, /"line" must be a whole number/],
    ["POST", "/restore", { id: "abc" }, /"id" must be a whole number/],
  ];
  for (const [method, route, body, message] of cases) {
    const r = await call(method, route, body);
    assert.equal(r.status, 400, `${method} ${route} ${JSON.stringify(body)}`);
    assert.match(r.body.error, message);
  }
});

test("writes can't escape the vault or touch non-note files", async () => {
  const { call, dir } = setup();
  const svg = fs.readFileSync(path.join(dir, "assets/chart.svg"), "utf8");
  for (const p of ["../escape.md", "../../etc/passwd.md", ".quire/index.db", "a\u0000b.md"]) {
    const r = await call("PUT", "/note", { path: p, content: "x" });
    assert.equal(r.status, 400, p);
  }
  assert.equal((await call("PUT", "/note", { path: "assets/chart.svg", content: "gone" })).status, 400);
  assert.equal(fs.readFileSync(path.join(dir, "assets/chart.svg"), "utf8"), svg);
  assert.equal(fs.existsSync(path.join(path.dirname(dir), "escape.md")), false);
});

test("query parameters are checked and clamped", async () => {
  const { call } = setup();
  assert.equal((await call("GET", "/search?q=roadmap&scope=bogus")).status, 400);
  assert.equal((await call("GET", "/feed?scope=bogus")).status, 400);
  assert.equal((await call("GET", "/diff?from=abc")).status, 400);
  const feed = await call("GET", "/feed?q=importer&offset=-1&limit=1");
  assert.deepEqual(feed.body.items.map((i: { path: string }) => i.path), ["Projects/Roadmap.md"]);
});

test("archive moves each listed note and reports where it went", async () => {
  const { call, events } = setup();
  const r = await call("POST", "/archive", { paths: ["Roadmap"] });
  assert.deepEqual(r.body, { moved: [{ from: "Projects/Roadmap.md", to: "Archive/Projects/Roadmap.md" }] });
  assert.deepEqual(events, ["moved Projects/Roadmap.md -> Archive/Projects/Roadmap.md", "tree"]);
});

test("tags are listed, asset tags set, and a rename reports what undoes it", async () => {
  const { call, events } = setup();
  assert.deepEqual((await call("PUT", "/asset-tags", { path: "chart.svg", tags: ["Plan/charts"] })).body, { tags: ["Plan/charts"] });
  assert.deepEqual((await call("GET", "/asset-tags")).body, { "assets/chart.svg": ["Plan/charts"] });
  assert.deepEqual(
    (await call("GET", "/tags")).body.map((t: { tag: string; notes: number; assets: number }) => `${t.tag} ${t.notes}/${t.assets}`),
    ["plan 1/1", "plan/charts 0/1", "q3 1/0"],
  );
  events.length = 0;
  const r = await call("POST", "/tags/rename", { from: "plan", to: "roadmap" });
  assert.equal(r.body.changes.length, 1);
  assert.deepEqual(r.body.assets, { "assets/chart.svg": ["Plan/charts"] });
  assert.deepEqual(events, ["written Projects/Roadmap.md by tester", "tree"]);
  assert.match((await call("GET", "/note?path=Roadmap")).body.content, /^---\ntags: \[roadmap, q3\]\n---\n/);
  assert.equal((await call("POST", "/tags/rename", { from: "q3", to: "not a tag" })).status, 400);
  assert.equal((await call("PUT", "/asset-tags", { path: "Welcome", tags: ["x"] })).status, 400);
  assert.equal((await call("PUT", "/asset-tags", { path: "chart.svg", tags: "x" })).status, 400);
});

test("tasks filter by due date against the reader's today, and a task's tokens change in place", async () => {
  const { call, events } = setup();
  await call("POST", "/tasks/update", { path: "Roadmap", line: 8, text: "Ship the importer", patch: { due: "2026-10-01", assignees: ["jane"] } });
  assert.deepEqual(events, ["written Projects/Roadmap.md by tester"]);
  const due = async (q: string) => (await call("GET", `/tasks?${q}`)).body.map((t: { summary: string }) => t.summary);
  assert.deepEqual(await due("due=%3C%3Dtoday&today=2026-10-01"), ["Ship the importer"]);
  assert.deepEqual(await due("due=%3C%3Dtoday&today=2026-09-30&assignee=jane"), []);
  assert.deepEqual(await due("assignee=jane"), ["Ship the importer"]);
  assert.equal((await call("GET", "/note?path=Roadmap")).body.content.split("\n")[7], "- [ ] Ship the importer due:2026-10-01 @jane");
  const bad: Array<[unknown, RegExp]> = [
    [{ due: 5 }, /"patch\.due" isn't a task field or has the wrong type/],
    [{ owner: "x" }, /"patch\.owner" isn't a task field/],
    ["x", /"patch" must be an object/],
    [{ priority: "urgent" }, /"priority" must be high or low/],
  ];
  for (const [patch, message] of bad) {
    const r = await call("POST", "/tasks/update", { path: "Roadmap", line: 8, text: "Ship the importer due:2026-10-01 @jane", patch });
    assert.equal(r.status, 400, JSON.stringify(patch));
    assert.match(r.body.error, message);
  }
  await call("POST", "/tasks/update", { path: "Roadmap", line: 8, text: "Ship the importer due:2026-10-01 @jane", patch: { summary: "Ship the exporter" } });
  assert.equal((await call("GET", "/note?path=Roadmap")).body.content.split("\n")[7], "- [ ] Ship the exporter due:2026-10-01 @jane");
  assert.equal((await call("POST", "/tasks/update", { path: "Roadmap", line: 8, text: "Ship the exporter due:2026-10-01 @jane", patch: { summary: 3 } })).status, 400);
  await call("POST", "/tasks/update", { path: "Roadmap", line: 8, text: "Ship the exporter due:2026-10-01 @jane", patch: { summary: "Ship the importer" } });
  assert.equal((await call("GET", "/tasks?due=soon")).status, 400);
  assert.equal((await call("GET", "/tasks?due=today&today=garbage")).status, 400);
  await call("POST", "/tasks/set", { path: "Roadmap", line: 8, text: "Ship the importer due:2026-10-01 @jane", done: true, today: "2026-10-02" });
  assert.equal((await call("GET", "/note?path=Roadmap")).body.content.split("\n")[7], "- [x] Ship the importer due:2026-10-01 @jane done:2026-10-02");
  const late = await call("POST", "/tasks/set", { path: "Roadmap", line: 8, text: "Ship the importer due:2026-10-01 @jane done:2026-10-02", done: false, today: "someday" });
  assert.deepEqual([late.status, late.body.error], [400, `"today" must be a date like 2026-10-01, not "someday"`]);
});

test("quick-add writes a task from words, and a task moves to another note", async () => {
  const { call, events } = setup();
  const added = await call("POST", "/tasks/add", { text: "Ship the importer docs → [[Roadmap]] tomorrow", today: "2026-10-01", ignore: [] });
  assert.deepEqual(added.body, { path: "Projects/Roadmap.md", version: added.body.version, line: 10, text: "Ship the importer docs due:2026-10-02" });
  assert.deepEqual(events, ["written Projects/Roadmap.md by tester"]);
  assert.equal((await call("POST", "/tasks/add", { text: "Stretch daily", today: "2026-10-01" })).body.path, "Journal/2026-10-01.md");
  assert.equal((await call("POST", "/tasks/add", { text: "x", ignore: "next week" })).status, 400);
  const toNote = await call("POST", "/tasks/add", { text: "Tidy up", today: "2026-10-01", to: "Welcome" });
  assert.deepEqual([toNote.body.path, toNote.body.text], ["Welcome.md", "Tidy up"]);
  const removed = await call("POST", "/tasks/remove", { path: "Welcome", line: toNote.body.line, text: "Tidy up" });
  assert.equal(removed.status, 200);
  assert.equal((await call("GET", "/note?path=Welcome")).body.content, "# Welcome\n\nStart with [[Roadmap]].\n\n![[chart.svg]]\n");
  const moved = await call("POST", "/tasks/move", { path: "Roadmap", line: 10, text: "Ship the importer docs due:2026-10-02", to: "Journal/2026-10-01" });
  assert.deepEqual([moved.status, moved.body.path, moved.body.line], [200, "Journal/2026-10-01.md", 6]);
});

test("a tag is starred and unstarred through the favorites routes a viewer can use", async () => {
  const { call } = setup();
  const starred = await call("POST", "/favorites/star", { tag: "plan" });
  assert.deepEqual(starred.body, [{ tag: "plan", display: "plan", notes: 1 }]);
  assert.equal((await call("POST", "/favorites/star", { tag: "27" })).status, 400);
  assert.deepEqual((await call("POST", "/favorites/unstar", { tag: "#plan" })).body, []);
});

test("favorites are starred, ordered and unstarred per person, and tell the other tabs", async () => {
  const { call, events } = setup();
  await call("POST", "/favorites/star", { path: "Welcome" });
  const starred = await call("POST", "/favorites/star", { path: "Projects/Roadmap.md" });
  assert.deepEqual(starred.body.map((n: { path: string }) => n.path), ["Welcome.md", "Projects/Roadmap.md"]);
  const ordered = await call("PUT", "/favorites", { paths: ["Projects/Roadmap.md"] });
  assert.deepEqual(ordered.body.map((n: { path: string }) => n.path), ["Projects/Roadmap.md", "Welcome.md"]);
  await call("POST", "/favorites/unstar", { path: "Welcome.md" });
  assert.deepEqual((await call("GET", "/favorites")).body.map((n: { path: string }) => n.path), ["Projects/Roadmap.md"]);
  assert.deepEqual(events, ["tree", "tree", "tree", "tree"]);
  assert.equal((await call("POST", "/favorites/star", { path: "Nope" })).status, 404);
  assert.equal((await call("PUT", "/favorites", { paths: "Welcome" })).status, 400);
});
