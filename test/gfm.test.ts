import { test } from "node:test";
import assert from "node:assert/strict";
import { footnotesIn, headingMatches, headingSlug, parseAlert } from "../src/core/gfm.ts";
import { EMOJI, withEmoji } from "../src/core/emoji.ts";

test("an alert is a blockquote whose first line names a type; Obsidian's names and fold marks count too", () => {
  assert.deepEqual(parseAlert("> [!NOTE]"), { type: "note", fold: null, title: "Note" });
  assert.deepEqual(parseAlert("> [!warning]- Read this first"), { type: "warning", fold: "-", title: "Read this first" });
  assert.deepEqual(parseAlert(">[!tip]+"), { type: "tip", fold: "+", title: "Tip" });
  assert.deepEqual(parseAlert("> [!danger] Careful"), { type: "caution", fold: null, title: "Careful" });
  assert.deepEqual([parseAlert("> [!unknown]"), parseAlert("[!NOTE]"), parseAlert("> text [!NOTE]")], [null, null, null]);
});

test("footnotes: definitions, references outside code, numbered by first reference like GitHub", () => {
  const md = "One[^b] two[^a] again[^b].\n\n`[^code]` stays\n\n```\n[^fenced]\n```\n\n[^a]: First def.\n[^b]: Second def.\n";
  const f = footnotesIn(md);
  assert.deepEqual([...f.defs].map(([id, d]) => [id, d.line, d.text]), [["a", 8, "First def."], ["b", 9, "Second def."]]);
  assert.deepEqual(f.refs.map((r) => [r.id, r.line, r.from, r.to]), [["b", 0, 3, 7], ["a", 0, 11, 15], ["b", 0, 21, 25]]);
  assert.deepEqual([...f.number], [["b", 1], ["a", 2]]);
});

test("heading anchors match GitHub's slugs, and a link can name a heading by its text or its slug", () => {
  assert.deepEqual(["Task lists", "What's new in v2.0?", "  Émoji & friends  "].map(headingSlug), ["task-lists", "whats-new-in-v20", "émoji--friends"]);
  assert.deepEqual([headingMatches("Task lists", "task-lists"), headingMatches("Task lists", "Task%20lists"), headingMatches("Task lists", "tasks")], [true, true, false]);
});

test("shortcodes become emoji where a word starts; times, URLs and unknown names stay as written", () => {
  assert.equal(withEmoji("Shipped :tada: :rocket: and :+1:"), "Shipped 🎉 🚀 and 👍");
  assert.equal(withEmoji("at 10:30:00, see https://x.test/:tada: or :not_an_emoji:"), "at 10:30:00, see https://x.test/:tada: or :not_an_emoji:");
  assert.ok(EMOJI.size > 300, String(EMOJI.size));
});
