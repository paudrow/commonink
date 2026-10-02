import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { openTempVault } from "./helpers.ts";

const DAY = 86_400_000;

test("a deleted note goes to Trash: out of listings, search and links, and back with its ID on restore", () => {
  const { vault, dir } = openTempVault();
  const id = vault.meta("Projects/Roadmap.md")!.id;
  assert.deepEqual(vault.deleteCheck(["Roadmap"]), { notes: 1, assets: 0, linkedFrom: ["Welcome.md"] });
  const [gone] = vault.delete(["Roadmap"], "you");
  assert.equal(gone.path, "Projects/Roadmap.md");
  assert.equal(fs.existsSync(path.join(dir, ".trash", gone.id, "Projects/Roadmap.md")), true);
  assert.deepEqual(
    [vault.list().map((n) => n.path), vault.search("importer").length, vault.resolve("Roadmap"), vault.pathOf(id), vault.tasks().length],
    [["assets/chart.svg", "Dashboards/Stats.html", "Welcome.md"], 0, null, null, 0],
  );
  assert.deepEqual(
    vault.trash().map((t) => [t.path, t.kind, t.by?.source, t.expiresAt - t.deletedAt, t.excerpt]),
    [["Projects/Roadmap.md", "md", "you", 30 * DAY, "## Now\n\n- [ ] Ship the importer\n- [x] Write the parser"]],
  );
  const [back] = vault.untrash([gone.id], "you");
  assert.deepEqual([back.path, vault.meta("Projects/Roadmap.md")!.id, vault.resolve("Roadmap"), vault.trash()], ["Projects/Roadmap.md", id, "Projects/Roadmap.md", []]);
  assert.deepEqual(vault.changes({ path: "Projects/Roadmap.md", limit: 2 }).map((c) => [c.op, c.summary]), [["restore", "from Trash"], ["delete", "+0 −9"]]);
});

test("restoring onto a path that's been taken since picks a free name; restoring from History uses Trash", () => {
  const { vault } = openTempVault();
  const [gone] = vault.delete(["Welcome"], "you");
  vault.create("Welcome.md", "# A new welcome\n", "you");
  const deleted = vault.changes({ limit: 2 }).find((c) => c.op === "delete")!;
  const back = vault.restore(deleted.id, "you");
  assert.deepEqual([back.path, vault.read("Welcome 2").content, vault.trash().map((t) => t.id)], ["Welcome 2.md", "# Welcome\n\nStart with [[Roadmap]].\n\n![[chart.svg]]\n", []]);
  assert.throws(() => vault.untrash([gone.id], "you"), /no longer in Trash/);
});

test("restoring an older version of a note that's in Trash brings that note back, ID and all", () => {
  const { vault } = openTempVault();
  const id = vault.meta("Welcome.md")!.id;
  const edit = vault.save("Welcome.md", "# Welcome, edited\n", { source: "you" }).change!;
  vault.delete(["Welcome"], "you");
  const back = vault.restore(edit.id, "you");
  assert.deepEqual(
    [back.path, vault.meta("Welcome.md")!.id, vault.read("Welcome").content, vault.trash()],
    ["Welcome.md", id, "# Welcome\n\nStart with [[Roadmap]].\n\n![[chart.svg]]\n", []],
  );
  assert.deepEqual(vault.changes({ path: "Welcome.md", limit: 2 }).map((c) => c.op), ["edit", "restore"]);
});

test("restoring an older version of a deleted note never writes over a new note at its old path", () => {
  const { vault } = openTempVault();
  const id = vault.meta("Welcome.md")!.id;
  const edit = vault.save("Welcome.md", "# Welcome, edited\n", { source: "you" }).change!;
  vault.delete(["Welcome"], "you");
  const other = vault.create("Welcome.md", "# Someone else\n", "you");
  const back = vault.restore(edit.id, "you");
  assert.deepEqual(
    [back.path, vault.pathOf(id), vault.read(back.path).content, vault.read("Welcome.md").content, vault.meta("Welcome.md")!.id, vault.trash()],
    ["Welcome 2.md", "Welcome 2.md", "# Welcome\n\nStart with [[Roadmap]].\n\n![[chart.svg]]\n", "# Someone else\n", other.id, []],
  );
});

test("an asset keeps its tags through Trash; deleting forever drops its bytes and its text in the log", () => {
  const { vault, dir } = openTempVault();
  vault.setAssetTags("chart.svg", ["charts"]);
  assert.deepEqual(vault.deleteCheck(["assets/chart.svg"]), { notes: 0, assets: 1, linkedFrom: ["Welcome.md"] });
  const [a] = vault.delete(["assets/chart.svg"], "you");
  assert.deepEqual(vault.assetTags(), {});
  vault.untrash([a.id], "you");
  assert.deepEqual(vault.assetTags(), { "assets/chart.svg": ["charts"] });

  const [n] = vault.delete(["Roadmap"], "you");
  const del = vault.changes({ limit: 1 })[0];
  assert.equal(vault.diff(del.id, del.id).after, "");
  assert.deepEqual(vault.purge([n.id], "you"), ["Projects/Roadmap.md"]);
  assert.deepEqual([fs.existsSync(path.join(dir, ".trash", n.id)), vault.trash(), vault.diff(del.id, del.id).before], [false, [], null]);
  assert.equal(vault.changes({ limit: 1 })[0].op, "purge");
});

test("Trash empties itself of anything older than 30 days, without a log entry", () => {
  let now = Date.UTC(2026, 8, 1);
  const { vault } = openTempVault(undefined, { now: () => now });
  const [old] = vault.delete(["Roadmap"], "you");
  now += 20 * DAY;
  vault.delete(["Welcome"], "you");
  now += 11 * DAY;
  assert.deepEqual(vault.trash().map((t) => t.path), ["Welcome.md"]);
  assert.equal(vault.changes({ limit: 1 })[0].op, "delete");
  assert.throws(() => vault.untrash([old.id], "you"), /no longer in Trash/);
  assert.deepEqual(vault.emptyTrash("you"), ["Welcome.md"]);
});

test("deleting a folder sends its notes to Trash, or moves them up a level under free names", () => {
  const files = { "Projects/Launch/Plan.md": "# Plan\n", "Projects/Launch/Deep/Notes.md": "# Notes\n", "Projects/Plan.md": "# Other plan\n", "Home.md": "See [[Notes]].\n" };
  const { vault } = openTempVault(files);
  assert.deepEqual(vault.deleteCheck([], "Projects/Launch"), { notes: 2, assets: 0, linkedFrom: ["Home.md"] });
  vault.deleteFolder("Projects/Launch", "lift", "you");
  assert.deepEqual(vault.list().map((n) => n.path), ["Home.md", "Projects/Deep/Notes.md", "Projects/Plan 2.md", "Projects/Plan.md"]);
  const out = vault.deleteFolder("Projects", "trash", "you");
  assert.deepEqual([out.deleted.map((d) => d.path), vault.list().map((n) => n.path)], [["Projects/Deep/Notes.md", "Projects/Plan 2.md", "Projects/Plan.md"], ["Home.md"]]);
});

test("Trash ids can't reach outside Trash", () => {
  const { vault } = openTempVault();
  for (const id of ["../Welcome.md", "1-2/../../Welcome.md", "..", ""]) assert.throws(() => vault.untrash([id], "you"), /no longer in Trash/);
  assert.deepEqual(vault.purge(["../Welcome.md", ".."], "you"), []);
  assert.equal(vault.resolve("Welcome"), "Welcome.md");
});
