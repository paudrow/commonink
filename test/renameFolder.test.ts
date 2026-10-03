// Renaming a folder (and moving one under another): everything in it moves, archived notes too,
// links and smart folders follow, and nothing moves unless all of it can.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { openTempVault } from "./helpers.ts";
import { COMMANDS } from "../src/core/commands/index.ts";

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
  for (const f of ["People", "Templates", "Archive", "Config", "Config/Users", "Journal", "Events"]) assert.throws(() => vault.moveFolder(f, "Elsewhere", "you"), /keeps its name/);
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

test("the app's own folders can't be deleted, by the app, an agent or the CLI; the notes in them can, one by one", () => {
  const { vault } = openTempVault({ "Templates/Daily.md": "# {{date}}\n", "Journal/2026-10-01.md": "# Day\n", "Config/Settings.md": "---\ngamified: true\n---\n", "Templates/Old/Thing.md": "# Thing\n" });
  const del = COMMANDS.find((c) => c.mcp === "delete_folder")!;
  for (const f of ["Templates", "Journal", "Config", "/Config/", "People", "Events"]) {
    assert.throws(() => vault.deleteFolder(f, "trash", "you"), /can't be deleted; its notes can still be deleted one by one/);
    assert.throws(() => del.run({ vault, source: "agent" } as never, { folder: f, notes: "lift" } as never), /can't be deleted/);
  }
  assert.equal(vault.list().length, 4, "nothing went");
  assert.deepEqual(vault.deleteFolder("Templates/Old", "trash", "you").deleted.map((d) => d.path), ["Templates/Old/Thing.md"], "a folder of your own inside one goes");
  assert.deepEqual(vault.delete(["Journal/2026-10-01.md"], "you").map((d) => d.path), ["Journal/2026-10-01.md"]);
});
