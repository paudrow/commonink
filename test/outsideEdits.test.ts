// An edit made in another editor while the app's server is off (#310): the next time the vault is
// opened (the CLI, MCP or the app), sync() finds it and History gets it as its own change.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openVault } from "../src/core/local.ts";
import { dataFolder } from "../src/legacy.ts";
import { tempVault } from "./helpers.ts";

/** Write a file the way another editor would, a moment later so its time differs. */
function outside(dir: string, rel: string, text: string) {
  fs.writeFileSync(path.join(dir, rel), text);
  const at = new Date(Date.now() + 5000 + Math.random() * 1000);
  fs.utimesSync(path.join(dir, rel), at, at);
}
const log = (vault: ReturnType<typeof openVault>, rel: string) => vault.changes({ path: rel }).map((c) => `${c.op} by ${c.agent ?? c.person ?? "someone else"}: ${c.summary}`);

test("an edit made in another editor is in History, between the changes around it, with what it changed", () => {
  const dir = tempVault({});
  openVault(dir).create("K", "# K\n\nalpha\n", "you");
  outside(dir, "K.md", "# K\n\nalpha beta\n");
  const vault = openVault(dir);
  vault.edit("K", { oldString: "alpha", newString: "gamma" }, "you");
  assert.deepEqual(log(vault, "K.md"), ["edit by you: +1 −1", "edit by someone else: +1 −1", "create by you: 4 lines"]);
  const [, mine, made] = vault.changes({ path: "K.md" });
  assert.deepEqual(vault.diff(mine.id, mine.id), { path: "K.md", op: "edit", before: "# K\n\nalpha\n", after: "# K\n\nalpha beta\n" });
  assert.equal(vault.diff(made.id, made.id).after, "# K\n\nalpha\n", "the create shows what was written then, not the outside edit");
  // It can be undone on its own.
  vault.restore(mine.id, "you");
  assert.equal(fs.readFileSync(path.join(dir, "K.md"), "utf8"), "# K\n\nalpha\n");
});

test("a file saved again with the same text, or already in History, isn't a change", () => {
  const dir = tempVault({ "A.md": "# A\n\none\n" });
  openVault(dir);
  outside(dir, "A.md", "# A\n\none\n");
  assert.deepEqual(log(openVault(dir), "A.md"), []);
  outside(dir, "A.md", "# A\n\ntwo\n");
  assert.equal(log(openVault(dir), "A.md").length, 1);
  assert.equal(log(openVault(dir), "A.md").length, 1, "opening again finds nothing new");
});

test("a note keeps its text across a move, and a deleted note's is dropped", () => {
  const dir = tempVault({ "A.md": "# A\n\none\n", "B.md": "# B\n" });
  const first = openVault(dir);
  first.move("A", "Deep/A", "you");
  first.delete(["B"], "you");
  outside(dir, "Deep/A.md", "# A\n\none two\n");
  const vault = openVault(dir);
  const edit = vault.changes({ path: "Deep/A.md" })[0];
  assert.equal(edit.source, "external");
  assert.equal(vault.diff(edit.id, edit.id).before, "# A\n\none\n");
  assert.deepEqual(vault.db.all<{ path: string }>("SELECT path FROM note_texts ORDER BY path").map((r) => r.path), ["Deep/A.md"]);
});

test("an index from before it kept texts fills them in, so the first outside edit after is compared too", () => {
  const dir = tempVault({ "A.md": "# A\n\none\n" });
  openVault(dir);
  const db = new DatabaseSync(path.join(dataFolder(dir), "index.db"));
  db.exec("DELETE FROM note_texts");
  db.close();
  openVault(dir); // the upgrade: reads each note once
  outside(dir, "A.md", "# A\n\none two\n");
  const vault = openVault(dir);
  const edit = vault.changes({ path: "A.md" })[0];
  assert.equal(vault.diff(edit.id, edit.id).before, "# A\n\none\n");
});

test("a new file added outside the app isn't logged as an edit", () => {
  const dir = tempVault({ "A.md": "# A\n" });
  openVault(dir);
  outside(dir, "New.md", "# New\n");
  const vault = openVault(dir);
  assert.deepEqual(vault.changes({}), []);
  assert.equal(vault.resolve("New"), "New.md");
});
