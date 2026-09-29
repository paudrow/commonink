// The index behind search, tags, links and tasks: it answers the same after the changes that made
// it cheaper to keep up to date.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
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

test("an index from before tasks were indexed learns them on the next start", () => {
  const { dir, quire } = openTempVault(TASKY);
  quire.db.exec("DROP TABLE tasks");
  assert.deepEqual(brief(openVault(dir), { note: "A" }), ["A.md:3   First [A] "]);
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
