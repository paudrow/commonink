import { test } from "node:test";
import assert from "node:assert/strict";
import { blockAnchor, blockAt, blockLinkTarget, blockRange, blockRangeText, blocksOf, blockText, findBlock, newBlockId, noteLink, parseBlockAnchor, selectionBlocks } from "../src/core/blocks.ts";
import { COMMANDS } from "../src/core/commands/index.ts";
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

test("parseBlockAnchor reads one block or a range, and nothing else", () => {
  assert.deepEqual(parseBlockAnchor("^intro"), { start: "intro", end: "intro" });
  assert.deepEqual(parseBlockAnchor("^intro..^item2"), { start: "intro", end: "item2" });
  assert.deepEqual(parseBlockAnchor(" ^a1 .. ^b2 "), { start: "a1", end: "b2" }, "spaces around the dots");
  assert.deepEqual(parseBlockAnchor("^a1..b2"), { start: "a1", end: "b2" }, "the second ^ may be left out");
  assert.equal(parseBlockAnchor("Goals"), null, "a heading");
  assert.equal(parseBlockAnchor("^a..^b..^c"), null);
  assert.equal(parseBlockAnchor("^"), null);
  assert.equal(blockAnchor("a1"), "^a1");
  assert.equal(blockAnchor("a1", "A1"), "^a1", "the same block twice is one block");
  assert.equal(blockAnchor("a1", "b2"), "^a1..^b2");
  assert.equal(noteLink("Plan", blockAnchor("a1", "b2"), true), "![[Plan#^a1..^b2]]");
});

test("blockRange spans from the first block's start to the last block's end, in either order", () => {
  assert.deepEqual(blockRange(NOTE, "^intro"), { from: 3, to: 4 });
  assert.deepEqual(blockRange(NOTE, "^intro..^item2"), { from: 3, to: 8 }, "the list item takes what's nested under it");
  assert.deepEqual(blockRange(NOTE, "^item2..^intro"), { from: 3, to: 8 }, "written backwards");
  assert.deepEqual(blockRange(NOTE, "^INTRO..^table"), { from: 3, to: 15 });
  assert.equal(blockRange(NOTE, "^intro..^gone"), null, "an ID that isn't there");
  assert.equal(blockRange(NOTE, "Plan"), null, "not a block anchor");
});

test("blockRangeText is what an embed of the range shows: every line in it, without the IDs", () => {
  assert.equal(blockRangeText(NOTE, "^intro..^item2"), "First line of a paragraph\nand its end.\n\n- one\n- two\n  - under two");
  assert.equal(blockRangeText(NOTE, "^item2..^table"), "- two\n  - under two\n- three\n\n| a | b |\n|---|---|\n| 1 | 2 |");
  assert.equal(blockRangeText(NOTE, "^nope"), null);
  assert.equal(blockRangeText(NOTE, "^item2"), blockText(NOTE, findBlock(NOTE, "item2")!), "one block reads as blockText does");
});

test("selectionBlocks: the first and last block a highlight touches, partial lines included", () => {
  const md = ["# Plan", "", "One paragraph", "on two lines.", "", "## Next", "", "- an item ^has", "- another", "", "```", "code", "```", ""].join("\n");
  const one = selectionBlocks(md, 4, 4)!;
  assert.equal(one.first, one.last, "inside one paragraph: just it");
  assert.deepEqual([one.first.from, one.first.to, one.first.id], [3, 4, null]);
  const both = selectionBlocks(md, 1, 13)!;
  assert.deepEqual([both.first.from, both.first.id], [3, null], "the heading above is passed over");
  assert.deepEqual([both.last.from, both.last.id], [9, null], "and the code below");
  const mid = selectionBlocks(md, 4, 8)!;
  assert.deepEqual([mid.first.from, mid.last.from, mid.last.id], [3, 8, "has"], "a block that has an ID keeps it");
  assert.deepEqual(selectionBlocks(md, 8, 4), mid, "backwards");
  assert.equal(selectionBlocks(md, 5, 6), null, "a blank line and a heading");
  assert.equal(selectionBlocks(md, 11, 13), null, "only code");
});

test("giving a selection's first and last blocks IDs makes a range that reads back as what was highlighted", () => {
  const md = "# Plan\n\nFirst idea\nstill first.\n\nSecond idea.\n\n- third\n  - nested\n";
  const sel = selectionBlocks(md, 4, 8)!; // from partway into the first paragraph to the list item
  const lines = md.split("\n");
  for (const [b, id] of [[sel.last, "bbb222"], [sel.first, "aaa111"]] as const) {
    assert.ok(b.id === null);
    lines[b.at - 1] += b.insert.replace("{id}", id);
  }
  const next = lines.join("\n");
  assert.equal(next, "# Plan\n\nFirst idea\nstill first. ^aaa111\n\nSecond idea.\n\n- third ^bbb222\n  - nested\n");
  assert.deepEqual(blockRange(next, "^aaa111..^bbb222"), { from: 3, to: 9 });
  assert.equal(blockRangeText(next, "^aaa111..^bbb222"), "First idea\nstill first.\n\nSecond idea.\n\n- third\n  - nested");
});

test("read_note reads just a block, or a range of blocks, from a block link's target", () => {
  const { vault } = openTempVault({ "Plan.md": "# Plan\n\nThe intro. ^intro\n\nMiddle.\n\n- last ^end\n- after\n" });
  const read = COMMANDS.find((c) => c.mcp === "get_note")!;
  const run = (args: Record<string, unknown>) => (read.run as any)({ vault, user: "me" }, args).text as string;
  assert.match(run({ path: "Plan#^intro" }), /\(lines 3-3 of 9\)\n\n3│The intro\. \^intro$/);
  assert.match(run({ path: "Plan#^intro..^end" }), /\(lines 3-7 of 9\)\n\n3│The intro\. \^intro\n4│\n5│Middle\.\n6│\n7│- last \^end$/);
  assert.match(run({ path: "Plan#^end", offset: 1, limit: 2 }), /\(lines 1-2 of 9\)/, "offset and limit win");
  assert.throws(() => run({ path: "Plan#^gone" }), /Plan\.md has no block \^gone/);
  assert.deepEqual(vault.backlinks("Plan"), [], "nothing links to it yet");
  vault.create("Other.md", "See ![[Plan#^intro..^end]].\n", "test");
  assert.deepEqual(vault.backlinks("Plan").map((b) => [b.path, b.kind]), [["Other.md", "embed"]], "a range link is a backlink");
  assert.deepEqual(vault.missingLinks(), []);
});
