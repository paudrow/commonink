// The index behind search, tags, links and tasks: it answers the same after the changes that made
// it cheaper to keep up to date.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
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
