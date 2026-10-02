import { test } from "node:test";
import assert from "node:assert/strict";
import { blockAt, blockLinkTarget, blocksOf, blockText, findBlock, newBlockId, noteLink } from "../src/core/blocks.ts";
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

test("blockLinkTarget: what the editor's menu links to from a line, and what it calls it", () => {
  const md = ["---", "# not: a heading", "---", "# Plan {#plan}", "", "A paragraph", "", "- an item", "  under it", "", "> a quote", "", "| a |", "|---|"].join("\n");
  assert.equal(blockLinkTarget(md, 2), null, "frontmatter");
  assert.deepEqual(blockLinkTarget(md, 4), { kind: "heading", heading: "Plan" });
  assert.equal(blockLinkTarget(md, 5), null, "a blank line");
  assert.equal(blockLinkTarget(md, 6)?.kind, "paragraph");
  const item = blockLinkTarget(md, 9);
  assert.ok(item && item.kind === "list item");
  assert.equal(item.block.from, 8, "a line under an item is that item");
  assert.equal(blockLinkTarget(md, 11)?.kind, "quote");
  assert.equal(blockLinkTarget(md, 14)?.kind, "table");
  assert.deepEqual(blockLinkTarget(NOTE, 4), { kind: "paragraph", block: { id: "intro", from: 3, to: 4 } }, "one with an ID already");
  assert.equal(blockLinkTarget(NOTE, 18), null, "code");
});

test("newBlockId is six letters and numbers, with a letter, that the note doesn't use yet", () => {
  const id = newBlockId("Para", () => 0.123456789);
  assert.match(id, /^[a-z0-9]{6}$/);
  assert.match(id, /[a-z]/);
  const rolls = [0.123456789, 0.987654321];
  const next = newBlockId(`Para ^${id}`, () => rolls.shift()!);
  assert.notEqual(next, id, "skips an ID the note already uses");
  assert.match(next, /^[a-z0-9]{6}$/);
});

test("noteLink writes links and embeds, with or without an anchor", () => {
  assert.equal(noteLink("Plan"), "[[Plan]]");
  assert.equal(noteLink("Plan", "^ab12cd"), "[[Plan#^ab12cd]]");
  assert.equal(noteLink("Plan", "^ab12cd", true), "![[Plan#^ab12cd]]");
  assert.equal(noteLink("Plan", "Goals"), "[[Plan#Goals]]");
});

test("adding the ID where blockAt says gives the block that ID", () => {
  const md = "Intro\n\n- one\n  more\n- two\n";
  const at = blockAt(md, 4);
  assert.ok(at && at.id === null);
  const lines = md.split("\n");
  lines[at.at - 1] += at.insert.replace("{id}", "x1y2z3");
  assert.deepEqual(findBlock(lines.join("\n"), "x1y2z3"), { id: "x1y2z3", from: 3, to: 4, line: 3 });
});
