// Renaming a folder (and moving one under another): everything in it moves, archived notes too,
// links and smart folders follow, and nothing moves unless all of it can.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openTempVault, tempVault } from "./helpers.ts";
import { COMMANDS } from "../src/core/commands/index.ts";
import { FsContent, NodeDb } from "../src/core/local.ts";
import { migrate } from "../src/core/store.ts";
import { Vault } from "../src/core/vault.ts";

const FILES = {
  "Home.md": "See [[Plan]], [the notes](Ideas/Deep/Notes.md) and ![[Ideas/logo.png]].\n",
  "Ideas/Plan.md": "# Plan\n\nWith [[Notes]].\n",
  "Ideas/Deep/Notes.md": "# Notes\n",
  "Ideas/logo.png": "png",
  "Ideasbook.md": "# Not in Ideas\n",
};

test("renaming a folder moves everything in it and rewrites the links to it", () => {
  const { vault, dir } = openTempVault(FILES);
  const id = vault.meta("Ideas/Plan.md")!.id;
  vault.archive("Ideas/Deep/Notes", "you");
  const r = vault.moveFolder("Ideas", "Projects/Ideas 2026", "you");
  assert.deepEqual(
    r.moved.map((m) => [m.from, m.path]),
    [
      ["Ideas/Plan.md", "Projects/Ideas 2026/Plan.md"],
      ["Ideas/logo.png", "Projects/Ideas 2026/logo.png"],
      ["Archive/Ideas/Deep/Notes.md", "Archive/Projects/Ideas 2026/Deep/Notes.md"],
    ],
  );
  assert.deepEqual(vault.list(undefined, "all").map((n) => n.path), [
    "Archive/Projects/Ideas 2026/Deep/Notes.md",
    "Home.md",
    "Ideasbook.md",
    "Projects/Ideas 2026/logo.png",
    "Projects/Ideas 2026/Plan.md",
  ]);
  assert.equal(vault.meta("Projects/Ideas 2026/Plan.md")!.id, id, "a note keeps its ID");
  assert.equal(vault.read("Home").content, "See [[Plan]], [the notes](Archive/Projects/Ideas%202026/Deep/Notes.md) and ![[logo.png]].\n", "a [[name]] that finds just one file is kept short, as a note's move does");
  assert.equal(fs.existsSync(path.join(dir, "Ideas")), false, "the old folder doesn't stay behind on disk");
  // Unarchived, a note goes back to the folder under its new name.
  assert.equal(vault.unarchive("Archive/Projects/Ideas 2026/Deep/Notes.md", "you").path, "Projects/Ideas 2026/Deep/Notes.md");
});

test("smart folders narrowed to a renamed folder follow it", () => {
  const { vault } = openTempVault(FILES);
  const inside = vault.saveSmartFolder("you", { name: "Deep ideas", query: "folder=Ideas/Deep sort=title", shared: true }, true);
  const other = vault.saveSmartFolder("you", { name: "Book", query: "folder=Ideasbook", shared: false }, true);
  vault.moveFolder("Ideas", "Thoughts", "you");
  assert.deepEqual(vault.smartFolders("you").map((f) => [f.id, f.query, f.count]), [
    [inside.id, "folder=Thoughts/Deep sort=title", 1],
    [other.id, "folder=Ideasbook", 0],
  ]);
});

test("a folder can't be renamed onto one that has notes, into itself, or away from Archive, People or Templates", () => {
  const { vault } = openTempVault({ ...FILES, "Thoughts/Old.md": "# Old\n", "People/Ana.md": "# Ana\n", "Templates/Daily.md": "# {{date}}\n" });
  assert.throws(() => vault.moveFolder("Ideas", "Thoughts", "you"), /already a folder named Thoughts/);
  assert.throws(() => vault.moveFolder("Ideas", "Ideas/Deep/More", "you"), /can't move into itself/);
  assert.throws(() => vault.moveFolder("Nothing", "Else", "you"), /nothing in Nothing/);
  for (const f of ["People", "Templates", "Archive"]) assert.throws(() => vault.moveFolder(f, "Elsewhere", "you"), /keeps its name/);
  assert.throws(() => vault.moveFolder("Ideas", "Archive/Ideas", "you"), /unarchive/);
  assert.deepEqual(vault.list().filter((n) => n.path.startsWith("Ideas/")).length, 3, "nothing moved");
});

test("changing only a folder's case renames it, by way of another name", () => {
  const { vault, dir } = openTempVault(FILES);
  const r = vault.moveFolder("Ideas", "ideas", "you");
  assert.deepEqual(r.moved.map((m) => [m.from, m.path]), [
    ["Ideas/Deep/Notes.md", "ideas/Deep/Notes.md"],
    ["Ideas/Plan.md", "ideas/Plan.md"],
    ["Ideas/logo.png", "ideas/logo.png"],
  ]);
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.toLowerCase().startsWith("ideas")).sort(), ["Ideasbook.md", "ideas"]);
  assert.equal(vault.read("Home").content, "See [[Plan]], [the notes](ideas/Deep/Notes.md) and ![[logo.png]].\n");
});

/** A disk that ignores case, as macOS's and Windows' do: a path finds whatever's there in any case. */
class CaseInsensitiveContent extends FsContent {
  override abs(rel: string) {
    let at = "";
    for (const part of rel.split("/").filter(Boolean)) {
      let names: string[] = [];
      try {
        names = fs.readdirSync(path.join(this.root, at));
      } catch {}
      const found = names.find((n) => n.toLowerCase() === part.toLowerCase()) ?? part;
      at = at ? `${at}/${found}` : found;
    }
    return super.abs(at);
  }
}

test("on a disk that ignores case, a folder's case changes even with a hidden file (.DS_Store) left in it", () => {
  const dir = tempVault({ "Home.md": "See [[ideas/a]].\n", "ideas/a.md": "# A\n", "ideas/.DS_Store": "x" });
  const db = new NodeDb(new DatabaseSync(":memory:"));
  migrate(db, { local: true });
  const vault = new Vault(db, new CaseInsensitiveContent(dir));
  vault.sync();
  const r = vault.moveFolder("ideas", "Ideas", "you");
  assert.deepEqual(r.moved.map((m) => [m.from, m.path]), [["ideas/a.md", "Ideas/a.md"]]);
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.toLowerCase().startsWith("ideas")), ["Ideas"], "the folder on disk takes the new case, nothing left in a temp folder");
  assert.deepEqual(fs.readdirSync(path.join(dir, "Ideas")).sort(), [".DS_Store", "a.md"]);
  assert.deepEqual(vault.list().map((n) => n.path), ["Home.md", "Ideas/a.md"]);
  assert.equal(vault.read("Home").content, "See [[a]].\n", "no link is left at the temp folder");
});

test("a folder's case can't change onto another folder already spelled that way, and nothing moves", () => {
  const { vault, dir } = openTempVault({ "Home.md": "See [[ideas/a]].\n", "ideas/a.md": "# A\n", "Ideas/b.md": "# B\n" });
  assert.throws(() => vault.moveFolder("ideas", "Ideas", "you"), /already a folder named Ideas/);
  assert.deepEqual(vault.list().map((n) => n.path).sort(), ["Home.md", "Ideas/b.md", "ideas/a.md"]);
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.toLowerCase().startsWith("ideas")).sort(), ["Ideas", "ideas"]);
  assert.equal(vault.read("Home").content, "See [[ideas/a]].\n");
});

test("a folder's case change that fails halfway puts everything back", () => {
  const { vault, dir } = openTempVault({ "Home.md": "See [[ideas/a]].\n", "ideas/a.md": "# A\n", "ideas/b.md": "# B\n", "Archive/Ideas/b.md": "# Other B\n" });
  vault.archive("ideas/b.md", "you"); // lands under a free name, Archive/ideas/b.md
  assert.throws(() => vault.moveFolder("ideas", "Ideas", "you"), /Archive\/Ideas\/b\.md already exists/);
  assert.deepEqual(vault.list(undefined, "all").map((n) => n.path).sort(), ["Archive/Ideas/b.md", "Archive/ideas/b.md", "Home.md", "ideas/a.md"]);
  assert.equal(fs.readdirSync(dir).some((f) => f.includes("renaming")), false, "nothing left in the temp folder");
  assert.equal(vault.read("Home").content, "See [[a]].\n", "its link leads to it again, not to the temp folder");
});

test("a folder's case change goes by a temp name nothing is archived under, so no other note moves with it", () => {
  const { vault } = openTempVault({ "ideas/a.md": "# A\n", "Archive/ideas (renaming)/z.md": "# Z\n" });
  const r = vault.moveFolder("ideas", "Ideas", "you");
  assert.deepEqual(r.moved.map((m) => [m.from, m.path]), [["ideas/a.md", "Ideas/a.md"]]);
  assert.deepEqual(vault.list(undefined, "all").map((n) => n.path).sort(), ["Archive/ideas (renaming)/z.md", "Ideas/a.md"]);
});

test("folder rename: the CLI command and MCP tool say what moved and which notes' links changed", async () => {
  const { vault } = openTempVault(FILES);
  const cmd = COMMANDS.find((c) => c.cli === "folder rename")!;
  assert.equal(cmd.mcp, "rename_folder");
  const moved: string[][] = [];
  const out = await cmd.run({ vault, source: "you", sharing: { folderMoved: async (a: string, b: string) => void moved.push([a, b]) } } as never, { folder: "Ideas/", to: "Thoughts" } as never);
  assert.match(out.text, /^Moved Ideas\/ to Thoughts\/ \(3 files\)\. Updated links in: Home\.md$/);
  assert.deepEqual((out.data as { updated: string[] }).updated, ["Home.md"]);
  assert.deepEqual(moved, [["Ideas", "Thoughts"]], "its shares are told to follow it");
});

test("a folder named with an emoji renames and deletes like any other", () => {
  const { vault } = openTempVault({ "📁 Projects/A.md": "# A\n", "📁 Projects/Sub/B.md": "# B\n", "📁 Projectsbook.md": "# Not in it\n" });
  assert.deepEqual(vault.moveFolder("📁 Projects", "📁 Work", "you").moved.map((m) => m.path), ["📁 Work/A.md", "📁 Work/Sub/B.md"]);
  assert.equal(vault.deleteCheck([], "📁 Work").notes, 2);
  assert.deepEqual(vault.deleteFolder("📁 Work", "trash", "you").deleted.map((d) => d.path), ["📁 Work/A.md", "📁 Work/Sub/B.md"]);
  assert.deepEqual(vault.list().map((n) => n.path), ["📁 Projectsbook.md"]);
});
