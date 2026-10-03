// Saved views are notes in Views/ (core/views.ts): listed from their files, saved and deleted as
// notes, and written out once from the smart_folders table older databases kept them in.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openTempVault, tempVault } from "./helpers.ts";
import { FsContent, NodeDb, openVault } from "../src/core/local.ts";
import { migrate } from "../src/core/store.ts";
import { Vault } from "../src/core/vault.ts";
import { viewFileName, viewLine, viewQueryIn, withViewQuery } from "../src/core/views.ts";

const NOTES = {
  "Projects/Roadmap.md": "# Roadmap\n\n#plan\n",
  "Projects/Launch.md": "# Launch\n\nThe launch plan. #plan #work\n",
  "Ideas/Garden.md": "# Garden\n",
};

/** Put back a smart_folders table, as a database from before views were notes has it, and forget the upgrade ran. */
function oldTable(db: { exec(sql: string): void; run(sql: string, ...p: unknown[]): unknown }, rows: Array<[string, string, string, string | null]>) {
  db.exec("CREATE TABLE smart_folders(id TEXT PRIMARY KEY, name TEXT NOT NULL, query TEXT NOT NULL, owner TEXT, pos INTEGER NOT NULL)");
  rows.forEach(([id, name, query, owner], i) => db.run("INSERT INTO smart_folders(id, name, query, owner, pos) VALUES (?,?,?,?,?)", id, name, query, owner, i + 1));
  db.run("DELETE FROM upgrades WHERE name = 'views as notes'");
}

test("a view's query line: read outside code, tidied, rewritten in place, and a name that can be a file's", () => {
  assert.equal(viewLine("tag=work  sort=title limit=5"), "::query{tag=work sort=title}");
  assert.equal(viewLine(""), "::query");
  assert.deepEqual(viewQueryIn("# Work\n\n```\n::query{tag=no}\n```\n\n::query{tag=work limit=3 label=Mine}\n"), { query: "tag=work", line: 6 });
  assert.equal(viewQueryIn("Just words.\n"), null);
  assert.equal(withViewQuery("Above.\n\n::query{tag=work}\n\nBelow.\n", 'q="launch plan"'), 'Above.\n\n::query{q="launch plan"}\n\nBelow.\n');
  assert.equal(withViewQuery("Above.\n", "tag=x"), "Above.\n\n::query{tag=x}\n");
  assert.equal(viewFileName(" Q3 / Q4: #work [[links]] "), "Q3 Q4 work links");
  assert.equal(viewFileName("..."), "");
});

test("views are read from notes in Views/: shared ones right in it, each person's own in Views/<user ID>/", () => {
  const { vault } = openTempVault({
    ...NOTES,
    "Views/Plans.md": "Everything we plan.\n\n::query{tag=plan sort=title}\n",
    "Views/Readme.md": "# Not a view: no query line\n",
    "Views/ana/Mine.md": "::query{folder=Ideas}\n",
    "Views/bo/Theirs.md": "::query{folder=Projects}\n",
    "Views/ana/Deeper/Lost.md": "::query{tag=work}\n",
  });
  const list = (user: string) => vault.smartFolders(user).map((f) => `${f.name} ${f.path} ${f.query} ${f.count} ${f.shared ? "shared" : "own"}`);
  assert.deepEqual(list("ana"), ["Mine Views/ana/Mine.md folder=Ideas 1 own", "Plans Views/Plans.md tag=plan sort=title 2 shared"]);
  assert.deepEqual(list("bo"), ["Plans Views/Plans.md tag=plan sort=title 2 shared", "Theirs Views/bo/Theirs.md folder=Projects 2 own"]);
  assert.equal(vault.findSmartFolder("ana", "views/plans.md").name, "Plans", "a view is found by its note's path too");
  assert.throws(() => vault.findSmartFolder("ana", "Theirs"), /No view "Theirs"/);
  // Editing the note is editing the view.
  vault.save("Views/Plans.md", "Everything we plan.\n\n::query{tag=work}\n", { source: "ana" });
  assert.equal(vault.findSmartFolder("ana", "Plans").query, "tag=work");
  // A view note isn't one of the notes a view finds, unless the query asks for Views/.
  assert.equal(vault.feed({ limit: 50 }).items.some((n) => n.path.startsWith("Views/")), false);
  assert.deepEqual(vault.feed({ folder: "Views", limit: 50 }).items.map((n) => n.path).sort(), ["Views/Plans.md", "Views/Readme.md", "Views/ana/Deeper/Lost.md", "Views/ana/Mine.md", "Views/bo/Theirs.md"]);
  // Nor what a search for the words in its query finds; the words above it are searched.
  assert.deepEqual(vault.search("work").map((h) => h.path), ["Projects/Launch.md"]);
  assert.deepEqual(vault.search("everything").map((h) => h.path), ["Views/Plans.md"]);
});

test("saving a view writes its note; renaming renames it; sharing moves it; deleting sends it to Trash", () => {
  const { dir, vault } = openTempVault(NOTES);
  const made = vault.saveSmartFolder("ana", { name: "Launch / plans", query: "tag=plan limit=5", shared: false }, true, "ana");
  assert.equal(made.view.path, "Views/ana/Launch plans.md");
  assert.equal(made.view.name, "Launch plans");
  assert.equal(fs.readFileSync(path.join(dir, made.view.path), "utf8"), "::query{tag=plan}\n");
  assert.equal(made.written?.change?.op, "create");
  assert.throws(() => vault.saveSmartFolder("ana", { name: "launch plans", query: "", shared: false }, true, "ana"), /already a view named launch plans/);

  // Words written above its query line stay through a change.
  vault.save(made.view.path, "Launch work.\n\n::query{tag=plan}\n", { source: "ana" });
  const renamed = vault.saveSmartFolder("ana", { id: made.view.id, name: "Launch", query: "tag=plan,work", shared: true }, true, "ana");
  assert.deepEqual([renamed.view.id, renamed.view.path, renamed.view.shared, renamed.view.count], [made.view.id, "Views/Launch.md", true, 1]);
  assert.deepEqual([renamed.moved?.from, renamed.moved?.path], ["Views/ana/Launch plans.md", "Views/Launch.md"]);
  assert.equal(fs.readFileSync(path.join(dir, "Views/Launch.md"), "utf8"), 'Launch work.\n\n::query{tag="plan,work"}\n');
  assert.equal(fs.existsSync(path.join(dir, "Views/ana/Launch plans.md")), false);
  assert.deepEqual(vault.smartFolders("bo").map((f) => f.name), ["Launch"], "shared now");

  vault.starSmartFolder("bo", "Launch");
  const gone = vault.deleteSmartFolder("ana", "Launch", true, "ana");
  assert.deepEqual(gone.views, []);
  assert.equal(gone.trashed.path, "Views/Launch.md");
  assert.deepEqual(vault.trash().map((t) => t.path), ["Views/Launch.md"]);
  assert.deepEqual(vault.favorites("bo"), [], "out of everyone's favorites");
  // Back from Trash, it's a view again.
  vault.untrash([gone.trashed.id], "ana");
  assert.deepEqual(vault.smartFolders("ana").map((f) => f.name), ["Launch"]);
});

test("a local vault's one person keeps their views right in Views/", () => {
  const { vault } = openTempVault(NOTES);
  const mine = vault.saveSmartFolder("you", { name: "Mine", query: "folder=Ideas", shared: false }, true, "you").view;
  assert.deepEqual([mine.path, mine.shared], ["Views/Mine.md", true]);
});

test("the upgrade writes each smart folder out as a view note, keeps its stars, and drops the table", () => {
  // A workspace online: no one person, so personal ones go to Views/<user ID>/.
  const dir = tempVault(NOTES);
  fs.mkdirSync(path.join(dir, ".commonink"), { recursive: true });
  const db = new NodeDb(new DatabaseSync(path.join(dir, ".commonink", "index.db")));
  migrate(db);
  const first = new Vault(db, new FsContent(dir));
  first.sync();
  first.upgradeSmartFolders();
  oldTable(db, [
    ["aaaaaaaa", "Plans", "tag=plan sort=title", null],
    ["bbbbbbbb", "Q3/Q4 #work", "folder=Projects", "u1"],
    ["cccccccc", "Plans", "folder=Ideas", "u2"],
    ["dddddddd", "Plans", "tag=work", null],
  ]);
  db.run("INSERT INTO favorites(user, note_id, path, pos) VALUES ('u1', '~bbbbbbbb', 'Q3/Q4 #work', 1)");

  const vault = new Vault(db, new FsContent(dir));
  vault.sync();
  vault.upgradeSmartFolders();
  const read = (rel: string) => fs.readFileSync(path.join(dir, rel), "utf8");
  assert.equal(read("Views/Plans.md"), "::query{tag=plan sort=title}\n");
  assert.equal(read("Views/Plans 2.md"), "::query{tag=work}\n", "a name taken already gets a free one");
  assert.equal(read("Views/u1/Q3 Q4 work.md"), "::query{folder=Projects}\n");
  assert.equal(read("Views/u2/Plans.md"), "::query{folder=Ideas}\n");
  assert.equal(db.get("SELECT 1 AS n FROM sqlite_master WHERE name = 'smart_folders'"), undefined, "the table is gone");
  assert.deepEqual(vault.smartFolders("u1").map((f) => `${f.name}:${f.shared}`), ["Plans:true", "Plans 2:true", "Q3 Q4 work:false"]);
  assert.deepEqual(vault.smartFolders("u2").map((f) => `${f.name}:${f.shared}`), ["Plans:false", "Plans:true", "Plans 2:true"]);
  // The star moved to the view's note.
  assert.deepEqual(vault.favorites("u1").map((f) => ("smartFolder" in f ? f.path : "?")), ["Views/u1/Q3 Q4 work.md"]);
  // Who wrote them, in History.
  assert.equal(vault.changes({ path: "Views/Plans.md" })[0].source, "Common Ink");

  // Once: a table that comes back isn't read again.
  oldTable(db, [["eeeeeeee", "Again", "", null]]);
  db.run("INSERT INTO upgrades(name) VALUES ('views as notes')");
  vault.upgradeSmartFolders();
  assert.equal(fs.existsSync(path.join(dir, "Views/Again.md")), false);
});

test("in a local vault the upgrade puts its person's smart folders in Views/ with the shared ones", () => {
  const dir = tempVault(NOTES);
  openVault(dir).db.exec("SELECT 1"); // made, upgraded (nothing to do), closed
  const before = openVault(dir);
  oldTable(before.db, [
    ["aaaaaaaa", "Shared", "tag=plan", null],
    ["bbbbbbbb", "Just me", "folder=Ideas", "you"],
  ]);
  const after = openVault(dir);
  assert.deepEqual(after.smartFolders("you").map((f) => [f.name, f.path, f.count]), [
    ["Just me", "Views/Just me.md", 1],
    ["Shared", "Views/Shared.md", 2],
  ]);
  assert.ok(after.db.get("SELECT 1 FROM upgrades WHERE name = 'views as notes'"));
  assert.equal(after.db.get("SELECT 1 FROM sqlite_master WHERE name = 'smart_folders'"), undefined);
});
