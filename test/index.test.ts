// The index behind search, tags, links and tasks: it answers the same after the changes that made
// it cheaper to keep up to date.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { agentSource } from "../src/core/actor.ts";
import { handleApi } from "../src/core/api.ts";
import { openVault } from "../src/core/local.ts";
import { openTempVault } from "./helpers.ts";

const found = (q: ReturnType<typeof openVault>, words: string) => q.search(words, 20, "all").map((h) => h.path);

test("search keeps exactly one entry per note through edits, moves, archiving and deletes", () => {
  const { dir, quire } = openTempVault();
  quire.save("Projects/Roadmap.md", "# Roadmap\n\nShip the exporter\n", { source: "t" });
  quire.save("Projects/Roadmap.md", "# Roadmap\n\nShip the exporter, then the importer\n", { source: "t" });
  assert.deepEqual(found(quire, "exporter"), ["Projects/Roadmap.md"]);
  quire.move("Projects/Roadmap.md", "Plans/Roadmap.md", "t");
  assert.deepEqual(found(quire, "exporter"), ["Plans/Roadmap.md"]);
  quire.archive("Plans/Roadmap.md", "t");
  assert.deepEqual(found(quire, "exporter"), ["Archive/Plans/Roadmap.md"]);
  fs.rmSync(path.join(dir, "Archive/Plans/Roadmap.md"));
  quire.sync();
  assert.deepEqual(found(quire, "exporter"), []);
  assert.deepEqual(found(quire, "welcome"), ["Welcome.md"]);
});

const brief = (q: ReturnType<typeof openVault>, opts?: Parameters<ReturnType<typeof openVault>["tasks"]>[0]) =>
  q.tasks(opts).map((t) => `${t.path}:${t.line} ${t.done ? "x" : " "} ${t.summary} [${t.heading}] ${t.meta.due ?? ""}`);

const TASKY: Record<string, string> = {
  "b/Plan.md": "# Plan\n\n## Now\n- [ ] Ship it due:2026-10-01 @jane\n```\n- [ ] not a task, it's code\n```\n:::kanban\n## Doing\n- [x] Card #work\n:::\n- [ ] After the board\n- [ ] \n",
  "A.md": "# A\n\n- [ ] First\n",
  "Archive/Old.md": "# Old\n\n- [ ] Archived\n",
};

test("tasks come from the index, and follow edits in the app, edits on disk, moves and deletes", () => {
  const { dir, quire } = openTempVault(TASKY);
  assert.deepEqual(brief(quire), [
    "A.md:3   First [A] ",
    "b/Plan.md:4   Ship it [Now] 2026-10-01",
    "b/Plan.md:10 x Card [Doing] ",
    "b/Plan.md:12   After the board [Now] ",
  ]);
  assert.deepEqual(brief(quire, { tag: "work" }), ["b/Plan.md:10 x Card [Doing] "]);
  assert.deepEqual(brief(quire, { assignee: "@Jane", due: "<=2026-10-01", today: "2026-09-28" }), ["b/Plan.md:4   Ship it [Now] 2026-10-01"]);
  assert.deepEqual(brief(quire, { note: "A", folder: "" }), ["A.md:3   First [A] "]);
  assert.deepEqual(brief(quire, { folder: "b" }).length, 3);

  quire.setTask("A", 3, "First", true, "t");
  fs.writeFileSync(path.join(dir, "b/Plan.md"), "# Plan\n\n- [ ] Rewritten on disk\n");
  quire.sync();
  assert.deepEqual(brief(quire), ["A.md:3 x First [A] ", "b/Plan.md:3   Rewritten on disk [Plan] "]);
  quire.archive("A", "t");
  quire.move("b/Plan.md", "c/Plan.md", "t");
  assert.deepEqual(brief(quire), ["c/Plan.md:3   Rewritten on disk [Plan] "]);
  fs.rmSync(path.join(dir, "c/Plan.md"));
  quire.sync();
  assert.deepEqual(brief(quire), []);
});

test("the Tasks badge's count is the open tasks in active notes, without sending the tasks", async () => {
  const { quire } = openTempVault(TASKY);
  const host = { quire, actor: "t", user: "t", canEditShared: true, info: () => ({}), written() {}, moved() {}, tree() {} };
  const count = async () => (await (await handleApi(host, new Request("http://localhost/api/tasks/count"), "/tasks/count"))!.json()).open;
  assert.equal(await count(), 3);
  quire.setTask("A", 3, "First", true, "t");
  assert.equal(await count(), 2);
});

test("a starred tag counts the active notes under it, as the tag list does, and drops out when only archived notes or assets have it", () => {
  const { quire } = openTempVault({
    "A.md": "# A\n\n#Work/Clients/acme and #work/clients again\n\n- [ ] Call #work/calls\n",
    "B.md": "# B\n\n#work\n",
    "Archive/C.md": "# C\n\n#work/old #gone\n",
    "assets/logo.svg": "<svg/>",
  });
  quire.setAssetTags("assets/logo.svg", ["brand", "work"]);
  quire.starTag("you", "work");
  quire.starTag("you", "work/clients");
  assert.throws(() => quire.starTag("you", "brand"), /No note has #brand/);
  assert.throws(() => quire.starTag("you", "gone"), /No note has #gone/);
  assert.deepEqual(quire.favorites("you"), [
    { tag: "work", display: "Work", notes: 2 },
    { tag: "work/clients", display: "Work/Clients", notes: 1 },
  ]);
  const listed = quire.tags().filter((t) => t.tag === "work" || t.tag === "work/clients");
  assert.deepEqual(listed.map((t) => ({ tag: t.tag, display: t.display, notes: t.notes })), quire.favorites("you"));
  quire.save("A.md", "# A\n", { source: "t" });
  assert.deepEqual(quire.favorites("you"), [{ tag: "work", display: "Work", notes: 1 }]);
});

test("a long Notes page still gives every note its tags, in the order written, and who changed it last", () => {
  let now = 1_000;
  const { quire } = openTempVault({}, { now: () => now++ });
  for (let i = 0; i < 120; i++) quire.create(`N${i}.md`, `# N${i}\n\n#Second${i} then #first${i}\n\n#second${i} again\n`, i % 2 ? agentSource("Claude", "you") : "you");
  quire.save("N7.md", "# N7\n\n#Second7 then #first7\n\n#second7 again\n\nMore.\n", { source: "Jane" });
  const page = quire.feed({ limit: 200 }).items;
  assert.equal(page.length, 120);
  const byPath = new Map(page.map((f) => [f.path, f]));
  assert.deepEqual(byPath.get("N0.md")!.tags, ["Second0", "first0"]);
  assert.deepEqual(byPath.get("N119.md")!.tags, ["Second119", "first119"]);
  assert.deepEqual([byPath.get("N0.md")!.lastSource, byPath.get("N7.md")!.lastSource, byPath.get("N119.md")!.lastSource], ["you", "Jane", "Claude (via you)"]);
  assert.deepEqual([byPath.get("N0.md")!.lastBy, byPath.get("N119.md")!.lastBy], [{ person: "you", agent: null }, { person: "you", agent: "Claude" }]);
});

test("the same [[name]] in different folders links to each folder's own note", () => {
  const { quire } = openTempVault({
    "a/Plan.md": "# Plan A\n",
    "b/Plan.md": "# Plan B\n",
    "a/Uses.md": "# Uses A\n\nSee [[Plan]].\n",
    "a/More.md": "# More A\n\n[[Plan]] again.\n",
    "b/Uses.md": "# Uses B\n\nSee [[Plan]].\n",
  });
  assert.deepEqual(quire.backlinks("a/Plan.md").map((b) => b.path).sort(), ["a/More.md", "a/Uses.md"]);
  assert.deepEqual(quire.backlinks("b/Plan.md").map((b) => b.path), ["b/Uses.md"]);
});

test("an index from before tasks were indexed learns them on the next start", () => {
  const { dir, quire } = openTempVault(TASKY);
  quire.db.exec("DROP TABLE tasks");
  assert.deepEqual(brief(openVault(dir), { note: "A" }), ["A.md:3   First [A] "]);
});

test("search ranks every hit and snippets the ones it returns, however large the notes that match", () => {
  const big = Array.from({ length: 20_000 }, (_, i) => (i % 7000 ? "filler words here" : "the launch plan again")).join("\n");
  const { quire } = openTempVault({ "Big.md": `# Big\n\n${big}\n`, "Launch.md": "# Launch plan\n\nThe launch plan for October.\n", "Other.md": "# Other\n\nNo match.\n" });
  const hits = quire.search("launch plan", 1);
  assert.deepEqual(hits.map((h) => [h.path, h.snippet]), [["Launch.md", "# \u0001Launch\u0002 \u0001plan\u0002\n\nThe \u0001launch\u0002 \u0001plan\u0002 for October.\n"]]);
  assert.deepEqual(quire.search("launch plan").map((h) => h.path), ["Launch.md", "Big.md"]);
});

test("an index from before full-text rows were tracked keeps one entry per note after an edit", () => {
  const { dir, quire } = openTempVault();
  quire.db.exec("ALTER TABLE notes DROP COLUMN fts");
  const reopened = openVault(dir);
  reopened.save("Welcome.md", "# Welcome\n\nStart with the garden.\n", { source: "t" });
  assert.deepEqual(found(reopened, "garden"), ["Welcome.md"]);
  assert.deepEqual(found(reopened, "roadmap"), ["Projects/Roadmap.md"]);
  // A row the upgrade couldn't place (as if it died partway) is still replaced, not duplicated.
  reopened.db.run("UPDATE notes SET fts = NULL WHERE path = ?", "Projects/Roadmap.md");
  reopened.save("Projects/Roadmap.md", "# Roadmap\n\nPlant the garden.\n", { source: "t" });
  assert.deepEqual(found(reopened, "garden").sort(), ["Projects/Roadmap.md", "Welcome.md"]);
  assert.deepEqual(found(reopened, "importer"), []);
});
