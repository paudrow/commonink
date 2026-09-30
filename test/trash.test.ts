import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { openTempVault } from "./helpers.ts";

const DAY = 86_400_000;

test("a deleted note goes to Trash: out of listings, search and links, and back with its ID on restore", () => {
  const { quire, dir } = openTempVault();
  const id = quire.meta("Projects/Roadmap.md")!.id;
  assert.deepEqual(quire.deleteCheck(["Roadmap"]), { notes: 1, assets: 0, linkedFrom: ["Welcome.md"] });
  const [gone] = quire.delete(["Roadmap"], "you");
  assert.equal(gone.path, "Projects/Roadmap.md");
  assert.equal(fs.existsSync(path.join(dir, ".trash", gone.id, "Projects/Roadmap.md")), true);
  assert.deepEqual(
    [quire.list().map((n) => n.path), quire.search("importer").length, quire.resolve("Roadmap"), quire.pathOf(id), quire.tasks().length],
    [["assets/chart.svg", "Dashboards/Stats.html", "Welcome.md"], 0, null, null, 0],
  );
  assert.deepEqual(
    quire.trash().map((t) => [t.path, t.kind, t.by?.source, t.expiresAt - t.deletedAt, t.excerpt]),
    [["Projects/Roadmap.md", "md", "you", 30 * DAY, "## Now\n\n- [ ] Ship the importer\n- [x] Write the parser"]],
  );
  const [back] = quire.untrash([gone.id], "you");
  assert.deepEqual([back.path, quire.meta("Projects/Roadmap.md")!.id, quire.resolve("Roadmap"), quire.trash()], ["Projects/Roadmap.md", id, "Projects/Roadmap.md", []]);
  assert.deepEqual(quire.changes({ path: "Projects/Roadmap.md", limit: 2 }).map((c) => [c.op, c.summary]), [["restore", "from Trash"], ["delete", "+0 −9"]]);
});

test("restoring onto a path that's been taken since picks a free name; restoring from History uses Trash", () => {
  const { quire } = openTempVault();
  const [gone] = quire.delete(["Welcome"], "you");
  quire.create("Welcome.md", "# A new welcome\n", "you");
  const deleted = quire.changes({ limit: 2 }).find((c) => c.op === "delete")!;
  const back = quire.restore(deleted.id, "you");
  assert.deepEqual([back.path, quire.read("Welcome 2").content, quire.trash().map((t) => t.id)], ["Welcome 2.md", "# Welcome\n\nStart with [[Roadmap]].\n\n![[chart.svg]]\n", []]);
  assert.throws(() => quire.untrash([gone.id], "you"), /no longer in Trash/);
});

test("an asset keeps its tags through Trash; deleting forever drops its bytes and its text in the log", () => {
  const { quire, dir } = openTempVault();
  quire.setAssetTags("chart.svg", ["charts"]);
  assert.deepEqual(quire.deleteCheck(["assets/chart.svg"]), { notes: 0, assets: 1, linkedFrom: ["Welcome.md"] });
  const [a] = quire.delete(["assets/chart.svg"], "you");
  assert.deepEqual(quire.assetTags(), {});
  quire.untrash([a.id], "you");
  assert.deepEqual(quire.assetTags(), { "assets/chart.svg": ["charts"] });

  const [n] = quire.delete(["Roadmap"], "you");
  const del = quire.changes({ limit: 1 })[0];
  assert.equal(quire.diff(del.id, del.id).after, "");
  assert.deepEqual(quire.purge([n.id], "you"), ["Projects/Roadmap.md"]);
  assert.deepEqual([fs.existsSync(path.join(dir, ".trash", n.id)), quire.trash(), quire.diff(del.id, del.id).before], [false, [], null]);
  assert.equal(quire.changes({ limit: 1 })[0].op, "purge");
});

test("Trash empties itself of anything older than 30 days, without a log entry", () => {
  let now = Date.UTC(2026, 8, 1);
  const { quire } = openTempVault(undefined, { now: () => now });
  const [old] = quire.delete(["Roadmap"], "you");
  now += 20 * DAY;
  quire.delete(["Welcome"], "you");
  now += 11 * DAY;
  assert.deepEqual(quire.trash().map((t) => t.path), ["Welcome.md"]);
  assert.equal(quire.changes({ limit: 1 })[0].op, "delete");
  assert.throws(() => quire.untrash([old.id], "you"), /no longer in Trash/);
  assert.deepEqual(quire.emptyTrash("you"), ["Welcome.md"]);
});

test("deleting a folder sends its notes to Trash, or moves them up a level under free names", () => {
  const files = { "Projects/Launch/Plan.md": "# Plan\n", "Projects/Launch/Deep/Notes.md": "# Notes\n", "Projects/Plan.md": "# Other plan\n", "Home.md": "See [[Notes]].\n" };
  const { quire } = openTempVault(files);
  assert.deepEqual(quire.deleteCheck([], "Projects/Launch"), { notes: 2, assets: 0, linkedFrom: ["Home.md"] });
  quire.deleteFolder("Projects/Launch", "lift", "you");
  assert.deepEqual(quire.list().map((n) => n.path), ["Home.md", "Projects/Deep/Notes.md", "Projects/Plan 2.md", "Projects/Plan.md"]);
  const out = quire.deleteFolder("Projects", "trash", "you");
  assert.deepEqual([out.deleted.map((d) => d.path), quire.list().map((n) => n.path)], [["Projects/Deep/Notes.md", "Projects/Plan 2.md", "Projects/Plan.md"], ["Home.md"]]);
});

test("Trash ids can't reach outside Trash", () => {
  const { quire } = openTempVault();
  for (const id of ["../Welcome.md", "1-2/../../Welcome.md", "..", ""]) assert.throws(() => quire.untrash([id], "you"), /no longer in Trash/);
  assert.deepEqual(quire.purge(["../Welcome.md", ".."], "you"), []);
  assert.equal(quire.resolve("Welcome"), "Welcome.md");
});
