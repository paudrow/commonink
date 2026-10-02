import { test } from "node:test";
import assert from "node:assert/strict";
import { blockAt, blocksOf, blockText, findBlock } from "../src/core/blocks.ts";
import { openTempVault } from "./helpers.ts";

const NOTE = [
  "# Plan", //  1
  "", //  2
  "First line of a paragraph", //  3
  "and its end. ^intro", //  4
  "", //  5
  "- one", //  6
  "- two ^item2", //  7
  "  - under two", //  8
  "- three", //  9
  "", // 10
  "| a | b |", // 11
  "|---|---|", // 12
  "| 1 | 2 |", // 13
  "", // 14
  "^table", // 15
  "", // 16
  "```", // 17
  "code ^not-a-block", // 18
  "```", // 19
  "Text with x ^2 inside stays text.", // 20
].join("\n");

test("blocksOf finds paragraphs, list items (with what's nested) and blocks named on the line after, not code", () => {
  assert.deepEqual(blocksOf(NOTE), [
    { id: "intro", from: 3, to: 4, line: 4 },
    { id: "item2", from: 7, to: 8, line: 7 },
    { id: "table", from: 11, to: 15, line: 15 },
  ]);
  assert.equal(findBlock(NOTE, "^ITEM2")?.from, 7, "any case, with or without the ^");
  assert.equal(findBlock(NOTE, "not-a-block"), null);
});

test("blockText is the block without its ID: what an embed shows", () => {
  assert.equal(blockText(NOTE, findBlock(NOTE, "intro")!), "First line of a paragraph\nand its end.");
  assert.equal(blockText(NOTE, findBlock(NOTE, "item2")!), "- two\n  - under two");
  assert.equal(blockText(NOTE, findBlock(NOTE, "table")!), "| a | b |\n|---|---|\n| 1 | 2 |");
});

test("blockAt: the block at a line, or where its ID would go", () => {
  assert.deepEqual(blockAt(NOTE, 3), { id: "intro", from: 3, to: 4 });
  assert.deepEqual(blockAt(NOTE, 8), { id: "item2", from: 7, to: 8 });
  assert.deepEqual(blockAt(NOTE, 9), { id: null, from: 9, to: 9, at: 9, insert: " ^{id}" });
  assert.deepEqual(blockAt(NOTE, 20), { id: null, from: 20, to: 20, at: 20, insert: " ^{id}" });
  assert.equal(blockAt(NOTE, 1), null, "a heading is linked by its words");
  assert.equal(blockAt(NOTE, 2), null);
  assert.equal(blockAt(NOTE, 18), null, "code");
  const quote = "> said\n> twice\nAfter.\n";
  assert.deepEqual(blockAt(quote, 1), { id: null, from: 1, to: 3, at: 3, insert: " ^{id}" }, "lazy continuation joins the quote");
  const table = "| a |\n|---|\n| 1 |\nNext\n";
  assert.equal((blockAt(table, 2) as { insert: string }).insert, " ^{id}");
  const lone = "| a |\n|---|\n| 1 |\n\nNext\n";
  assert.deepEqual(blockAt(lone, 3), { id: null, from: 1, to: 3, at: 3, insert: "\n\n^{id}" });
  const tight = "> a quote\n\n";
  assert.deepEqual(blockAt(tight, 1), { id: null, from: 1, to: 1, at: 1, insert: "\n\n^{id}" });
  const fm = "---\ntitle: x\n---\nBody\n";
  assert.equal(blockAt(fm, 2), null, "frontmatter");
  assert.deepEqual(blockAt(fm, 4), { id: null, from: 4, to: 4, at: 4, insert: " ^{id}" });
});

test("a [[Note#^id]] link or embed is a backlink to the note, and isn't a missing link", () => {
  const { vault } = openTempVault({
    "Plan.md": "# Plan\n\nThe intro. ^intro\n",
    "A.md": "# A\n\nSee [[Plan#^intro]] and ![[Plan#^intro]].\n",
  });
  assert.deepEqual(vault.backlinks("Plan").map((b) => [b.path, b.kind]).sort(), [["A.md", "embed"], ["A.md", "wikilink"]]);
  assert.deepEqual(vault.missingLinks(), []);
});
