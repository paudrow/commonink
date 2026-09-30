import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { handleApi, type ApiHost } from "../src/core/api.ts";
import { openTempVault } from "./helpers.ts";

/** The API over a fresh vault. `canEditShared: false` is how a viewer's requests reach a workspace online. */
function setup({ canEditShared = true, user = "tester" } = {}, vault?: ReturnType<typeof openTempVault>) {
  const { dir, quire } = vault ?? openTempVault();
  const events: string[] = [];
  const host: ApiHost = {
    quire,
    actor: user,
    user,
    canEditShared,
    info: () => ({ mode: "test" }),
    written: (rel, _content, _version, change) => events.push(`written ${rel} by ${change?.source ?? "-"}`),
    moved: (from, to) => events.push(`moved ${from} -> ${to}`),
    removed: (rel, change) => events.push(`removed ${rel} by ${change.source}`),
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

test("a save that names the note's ID follows it to where it moved, rather than making it again at the old path", async () => {
  const { call, quire, dir } = setup();
  const before = quire.read("Welcome.md");
  await call("POST", "/move", { from: "Welcome.md", to: "Hello.md" });
  const put = await call("PUT", "/note", { path: "Welcome.md", id: before.id, content: "# Welcome\n\nmore\n", baseVersion: before.version });
  assert.deepEqual([put.status, put.body.path], [200, "Hello.md"]);
  assert.equal(fs.readFileSync(path.join(dir, "Hello.md"), "utf8"), "# Welcome\n\nmore\n");
  assert.equal(fs.existsSync(path.join(dir, "Welcome.md")), false);
  const blank = await call("PUT", "/note", { path: "Welcome.md", id: before.id, content: "" });
  assert.deepEqual([blank.status, blank.body.code], [422, "empty"]);
  await call("POST", "/note", { path: "Welcome.md", content: "# A new welcome\n" });
  const again = await call("PUT", "/note", { path: "Welcome.md", id: before.id, content: "# Welcome\n\nmore still\n" });
  assert.equal(again.body.path, "Hello.md");
  assert.equal(fs.readFileSync(path.join(dir, "Welcome.md"), "utf8"), "# A new welcome\n");
});

test("undoing an agent's edit restores the note only while it's still at that edit's version", async () => {
  const { call, quire } = setup();
  quire.save("Plan.md", "# Plan\n\nship it\n", { source: "you" });
  const agent = quire.edit("Plan.md", { oldString: "ship it", newString: "ship it friday" }, "claude");
  const undo = await call("POST", "/restore", { id: agent.change!.id, version: agent.change!.version });
  assert.equal(undo.status, 200);
  assert.equal((await call("GET", "/note?path=Plan.md")).body.content, "# Plan\n\nship it\n");

  const again = quire.edit("Plan.md", { oldString: "ship it", newString: "ship it monday" }, "claude");
  quire.save("Plan.md", "# Plan\n\nship it monday, with notes\n", { source: "you" });
  const late = await call("POST", "/restore", { id: again.change!.id, version: again.change!.version });
  assert.deepEqual([late.status, late.body.code], [409, "conflict"]);
  assert.equal((await call("GET", "/note?path=Plan.md")).body.content, "# Plan\n\nship it monday, with notes\n", "the later edit is kept");
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

test("a name too long for the disk is a 400 that says so, not an internal error", async () => {
  const { call } = setup();
  const r = await call("POST", "/note", { path: `${"x".repeat(300)}.md`, content: "# x\n" });
  assert.deepEqual([r.status, r.body.error], [400, "That name is too long: a file or folder name can be up to 255 bytes"]);
  assert.equal((await call("POST", "/move", { from: "Welcome.md", to: `${"y".repeat(300)}.md` })).status, 400);
  assert.equal((await call("GET", "/note?path=Welcome.md")).status, 200);
  const near = `${"z".repeat(250)}.md`;
  assert.equal((await call("POST", "/note", { path: near, content: "# z\n" })).status, 200, "a name just under the limit");
  assert.equal((await call("GET", `/note?path=${near}`)).body.content, "# z\n");
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

test("a tag can be added before any note carries it, and taken away while none does", async () => {
  const { call, events } = setup();
  const added = await call("POST", "/tags", { tag: "#Areas/Home" });
  assert.deepEqual(added.body.map((t: { display: string; notes: number }) => `${t.display} ${t.notes}`), ["Areas 0", "Areas/Home 0", "plan 1", "q3 1"]);
  assert.deepEqual(events, ["tree"]);
  assert.equal((await call("POST", "/tags", { tag: "not a tag" })).status, 400);
  assert.equal((await call("POST", "/tags/delete", { tag: "plan" })).status, 409);
  const gone = await call("POST", "/tags/delete", { tag: "areas" });
  assert.deepEqual(gone.body.map((t: { tag: string }) => t.tag), ["plan", "q3"]);
});

test("undoing a tag rename leaves alone a note that changed since", async () => {
  const { call, quire } = setup({}, openTempVault({ "A.md": "# A\n\nAbout #plan\n", "B.md": "# B\n\nAbout #plan\n" }));
  const r = await call("POST", "/tags/rename", { from: "plan", to: "roadmap" });
  assert.equal(r.body.versions.length, 2);
  quire.append("B.md", "Typed after the rename.", "tester");
  const undo = await Promise.all(r.body.changes.map((id: number, i: number) => call("POST", "/restore", { id, version: r.body.versions[i] })));
  assert.deepEqual(undo.map((u) => u.status).sort(), [200, 409]);
  assert.equal(quire.read("A.md").content, "# A\n\nAbout #plan\n");
  assert.equal(quire.read("B.md").content, "# B\n\nAbout #roadmap\n\nTyped after the rename.\n");
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

test("today reads the viewer's day, and its journal note is made on request", async () => {
  const { call } = setup();
  await call("POST", "/tasks/update", { path: "Roadmap", line: 8, text: "Ship the importer", patch: { due: "2026-10-01" } });
  const t = await call("GET", "/today?today=2026-10-01");
  assert.deepEqual(t.body.sections.map((s: { id: string; tasks: unknown[] }) => [s.id, s.tasks.length]), [["overdue", 0], ["due", 1], ["starting", 0]]);
  assert.deepEqual(t.body.journal, { path: "Journal/2026-10-01.md", exists: false });
  assert.equal((await call("GET", "/today?today=2026-10-02")).body.sections[0].tasks[0].summary, "Ship the importer");
  const made = await call("POST", "/today/journal", { today: "2026-10-01" });
  assert.deepEqual(made.body, { path: "Journal/2026-10-01.md", created: true });
  assert.equal((await call("GET", "/today?today=soon")).status, 400);
});

test("smart folders: an editor shares one, a viewer keeps their own but can't create, change or delete shared ones", async () => {
  const vault = openTempVault();
  const editor = setup({ user: "ed" }, vault);
  const viewer = setup({ user: "vi", canEditShared: false }, vault);
  const shared = await editor.call("POST", "/smart-folders", { name: "Planning", query: "tag=plan", shared: true });
  assert.deepEqual(shared.body, { id: shared.body.id, name: "Planning", query: "tag=plan", shared: true, count: 1 });
  assert.deepEqual(editor.events, ["tree"]);

  const refused: Array<[string, unknown]> = [
    ["/smart-folders", { name: "Team view", query: "", shared: true }],
    ["/smart-folders", { id: shared.body.id, name: "Renamed", query: "tag=plan", shared: true }],
    ["/smart-folders", { id: shared.body.id, name: "Planning", query: "tag=plan", shared: false }],
    ["/smart-folders/delete", { id: shared.body.id }],
  ];
  for (const [route, body] of refused) {
    const r = await viewer.call("POST", route, body);
    assert.deepEqual([r.status, r.body.code], [403, "forbidden"], JSON.stringify(body));
  }
  const mine = await viewer.call("POST", "/smart-folders", { name: "Roadmap words", query: 'q="importer"' });
  assert.deepEqual([mine.status, mine.body.shared, mine.body.count], [200, false, 1]);
  assert.deepEqual((await viewer.call("GET", "/smart-folders")).body.map((f: { name: string }) => f.name), ["Planning", "Roadmap words"]);
  assert.deepEqual((await editor.call("GET", "/smart-folders")).body.map((f: { name: string }) => f.name), ["Planning"]);
  assert.equal((await viewer.call("POST", "/smart-folders/delete", { id: mine.body.id })).status, 200);
  assert.equal((await editor.call("POST", "/smart-folders", { name: "Bad", query: "sort=size" })).status, 400);
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

test("delete sends notes to Trash and says who links to them; Trash restores, and deletes for good", async () => {
  const { call, events } = setup();
  assert.deepEqual((await call("GET", "/delete-check?path=Roadmap&path=Welcome")).body, { notes: 2, assets: 0, linkedFrom: [] });
  assert.deepEqual((await call("GET", "/delete-check?path=Roadmap")).body, { notes: 1, assets: 0, linkedFrom: ["Welcome.md"] });
  const del = await call("POST", "/delete", { paths: ["Roadmap"] });
  assert.deepEqual(del.body.trashed.map((t: { path: string }) => t.path), ["Projects/Roadmap.md"]);
  assert.deepEqual(events, ["removed Projects/Roadmap.md by tester", "tree"]);
  assert.equal((await call("GET", "/note?path=Roadmap")).status, 404);
  const trash = (await call("GET", "/trash")).body;
  assert.deepEqual(trash.map((t: { id: string; path: string }) => [t.id, t.path]), [[del.body.trashed[0].id, "Projects/Roadmap.md"]]);
  assert.deepEqual((await call("POST", "/trash/restore", { ids: [trash[0].id] })).body, { restored: ["Projects/Roadmap.md"] });
  assert.equal((await call("GET", "/note?path=Roadmap")).status, 200);

  const again = (await call("POST", "/delete", { paths: ["Roadmap", "Welcome"] })).body.trashed;
  assert.deepEqual((await call("POST", "/trash/delete", { ids: [again[0].id] })).body, { deleted: ["Projects/Roadmap.md"] });
  assert.deepEqual((await call("POST", "/trash/empty", {})).body, { deleted: ["Welcome.md"] });
  assert.deepEqual((await call("GET", "/trash")).body, []);
  assert.equal((await call("POST", "/trash/restore", { ids: ["../Welcome.md"] })).status, 404);
  assert.equal((await call("POST", "/delete", { paths: ["Nope"] })).status, 404);
});

test("deleting a folder moves its notes up a level, or sends them all to Trash", async () => {
  const { call } = setup();
  await call("POST", "/note", { path: "Projects/Launch/Plan.md", content: "# Plan\n" });
  assert.deepEqual((await call("GET", "/delete-check?folder=Projects")).body, { notes: 2, assets: 0, linkedFrom: ["Welcome.md"] });
  assert.deepEqual((await call("POST", "/delete-folder", { folder: "Projects/Launch", notes: "lift" })).body, { trashed: [], moved: [{ from: "Projects/Launch/Plan.md", to: "Projects/Plan.md" }] });
  const gone = (await call("POST", "/delete-folder", { folder: "Projects", notes: "trash" })).body;
  assert.deepEqual(gone.trashed.map((t: { path: string }) => t.path), ["Projects/Plan.md", "Projects/Roadmap.md"]);
  assert.equal((await call("POST", "/delete-folder", { folder: "Projects", notes: "shred" })).status, 400);
});

test("contacts: list, read one with its timeline, create, change, merge and import", async () => {
  const { call, events } = setup();
  assert.deepEqual((await call("GET", "/contacts")).body, []);
  const made = await call("POST", "/contacts", { name: "Jane Doe", email: ["jane@acme.com"], company: "Acme" });
  assert.equal(made.body.path, "People/Jane Doe.md");
  assert.equal((await call("POST", "/contacts", { name: "Jane Doe" })).status, 409);
  assert.equal((await call("POST", "/contacts", { name: "X", email: "not-a-list" })).status, 400);
  await call("PUT", "/note", { path: "Journal/2026-09-20.md", content: "# Sep 20\n\nCalled [[People/Jane Doe]].\n" });
  const [jane] = (await call("GET", "/contacts")).body;
  assert.deepEqual([jane.name, jane.company, jane.mentions, jane.lastContacted], ["Jane Doe", "Acme", 1, "2026-09-20"]);
  const one = (await call("GET", "/contact?path=People/Jane Doe")).body;
  assert.deepEqual(one.timeline.map((t: { path: string }) => t.path), ["Journal/2026-09-20.md"]);
  await call("POST", "/contacts/update", { path: "People/Jane Doe.md", patch: { role: "CTO" } });
  assert.equal((await call("GET", "/contacts")).body[0].role, "CTO");
  assert.equal((await call("POST", "/contacts/update", { path: "People/Jane Doe.md", patch: { name: "Janet" } })).status, 400);
  const imported = await call("POST", "/contacts/import", { format: "csv", text: "Name,Email\nJ. Doe,jane@acme.com\nSam Lee,sam@x.org\n" });
  assert.deepEqual(imported.body, { created: ["People/Sam Lee.md"], updated: ["People/Jane Doe.md"], unchanged: [] });
  assert.equal((await call("POST", "/contacts/import", { format: "xlsx", text: "" })).status, 400);
  events.length = 0;
  const merged = await call("POST", "/contacts/merge", { keep: "People/Jane Doe.md", drop: "People/Sam Lee.md" });
  assert.equal(merged.body.path, "People/Jane Doe.md");
  assert.deepEqual(events, ["written People/Jane Doe.md by tester", "removed People/Sam Lee.md by tester", "tree"]);
  assert.deepEqual((await call("GET", "/contacts")).body.map((c: { name: string }) => c.name), ["Jane Doe"]);
});

test("members: the workspace's people, from the host (none in a local vault)", async () => {
  const { call } = setup();
  assert.deepEqual((await call("GET", "/members")).body, []);
});

test("templates: listed, rendered for inserting, and made into notes", async () => {
  const { call, events } = setup();
  await call("PUT", "/note", { path: "Templates/Meeting.md", content: "---\ntitle: \"{{date}} {{ask:Client}}\"\nfolder: Meetings\napplies_to: Meetings/\n---\n# {{title}}\n\n**Attendees:** {{ask:Attendees}}\n\n- {{cursor}}\n" });
  await call("PUT", "/note", { path: "Templates/Decision.md", content: "## Decision: {{ask:What}}\n\n{{cursor}}\n" });
  const list = (await call("GET", "/templates")).body;
  assert.deepEqual(list.map((t: { name: string; appliesTo: string[] }) => [t.name, t.appliesTo]), [["Decision", []], ["Meeting", ["Meetings"]]]);
  const r = (await call("POST", "/templates/render", { template: "Decision", at: "2026-09-29T09:00", answers: { What: "Ship it" } })).body;
  assert.deepEqual(r, { path: "Templates/Decision.md", text: "## Decision: Ship it\n\n\n", cursor: 22, unfilled: [] });
  events.length = 0;
  const made = await call("POST", "/notes/from-template", { template: "Meeting", at: "2026-09-29T09:00", answers: { Client: "Acme", Attendees: "Sam" } });
  assert.deepEqual([made.status, made.body.path, made.body.unfilled], [200, "Meetings/2026-09-29 Acme.md", []]);
  assert.equal((await call("GET", "/note?path=Meetings/2026-09-29 Acme.md")).body.content.slice(made.body.cursor - 2, made.body.cursor), "- ");
  assert.deepEqual(events, ["written Meetings/2026-09-29 Acme.md by tester", "tree"]);
  assert.equal((await call("POST", "/notes/from-template", { template: "Nope" })).status, 404);
  assert.equal((await call("POST", "/notes/from-template", { template: "Meeting", answers: { Client: 3 } })).status, 400);
});

test("a template's people picks become @handles on task lines and names elsewhere; bad picks are a 400", async () => {
  const { call } = setup();
  await call("PUT", "/note", { path: "Templates/Kickoff.md", content: "With {{ask:Who|people}}\n\n- [ ] Plan it {{ask:Who|people}}\n" });
  const picks = { Who: [{ name: "Sam Dev", handle: "Sam" }, { name: "Lee Chang", handle: "Lee" }] };
  const r = (await call("POST", "/templates/render", { template: "Kickoff", picks })).body;
  assert.equal(r.text, "With Sam Dev, Lee Chang\n\n- [ ] Plan it @Sam @Lee\n");
  assert.equal((await call("POST", "/templates/render", { template: "Kickoff", picks: { Who: [{ name: "Sam" }] } })).status, 400);
});
