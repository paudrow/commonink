import { test } from "node:test";
import assert from "node:assert/strict";
import { Text } from "@codemirror/state";
import { nameFromHeading, nameLine, renamedPath } from "../web/src/noteName.ts";

const doc = (s: string) => Text.of(s.split("\n"));

test("a note is named by the # heading on its first line, after any frontmatter", () => {
  assert.equal(nameFromHeading("Ideas/Draft.md", doc("# Garden plan\n\nBeds by the fence.")), "Garden plan");
  assert.equal(nameFromHeading("Draft.md", doc("---\ntags: [home]\n---\n# Garden plan ##\nText")), "Garden plan");
  assert.equal(nameFromHeading("Draft.md", doc("# Q3: plans/goals? [[Big]] #1")), "Q3 plans goals Big 1");
  assert.equal(nameFromHeading("Draft.md", doc("# " + "a".repeat(200))), "a".repeat(120));
});

test("a note keeps its name without a first-line heading, or when something else names it", () => {
  assert.equal(nameFromHeading("Draft.md", doc("Some text\n# Later heading")), null);
  assert.equal(nameFromHeading("Draft.md", doc("## Second level")), null);
  assert.equal(nameFromHeading("Draft.md", doc("# \nbody")), null);
  assert.equal(nameFromHeading("Draft.md", doc("# ***")), null);
  assert.equal(nameFromHeading("Draft.md", doc("---\ntitle: From frontmatter\n---\n# Heading")), null);
  assert.equal(nameFromHeading("Page.html", doc("# Heading")), null);
  assert.equal(nameFromHeading("AGENTS.md", doc("# Vault conventions")), null);
  assert.equal(nameFromHeading("Templates/Meeting.md", doc("# {{title}}")), null);
  assert.equal(nameFromHeading("Journal/2026-09-30.md", doc("# Wednesday")), null);
});

test("nameLine finds where the heading's words are, or where a heading would go", () => {
  const text = "---\ntags: [a]\n---\n#   Plan\nbody";
  const h = nameLine(doc(text));
  assert.deepEqual({ line: h.line, text: h.text, words: text.slice(h.from, h.to), titled: h.titled }, { line: 4, text: "Plan", words: "Plan", titled: false });
  const none = nameLine(doc("---\ntags: [a]\n---\nbody"));
  assert.deepEqual({ line: none.line, at: none.at, text: none.text }, { line: 4, at: 18, text: null });
  const empty = nameLine(doc("# \n"));
  assert.deepEqual({ text: empty.text, from: empty.from, to: empty.to }, { text: "", from: 2, to: 2 });
  assert.equal(nameLine(doc("---\ntitle: x\nno closing line")).titled, false);
});

test("renamedPath stays in the folder and adds a number after a taken name", () => {
  const paths = ["Ideas/Draft.md", "Ideas/Garden.md", "Ideas/garden 2.md", "Garden.md"];
  assert.equal(renamedPath("Ideas/Draft.md", "Garden", paths), "Ideas/Garden 3.md");
  assert.equal(renamedPath("Ideas/Draft.md", "Shed", paths), "Ideas/Shed.md");
  assert.equal(renamedPath("Draft.md", "Plan", ["Draft.md"]), "Plan.md");
  assert.equal(renamedPath("Archive/Ideas/Old.md", "Older", ["Archive/Ideas/Old.md"]), "Archive/Ideas/Older.md");
});

test("renamedPath is null when the name is the note's own, even one it got a number for", () => {
  assert.equal(renamedPath("Ideas/Garden.md", "Garden", ["Ideas/Garden.md"]), null);
  assert.equal(renamedPath("Ideas/Garden 2.md", "Garden", ["Ideas/Garden.md", "Ideas/Garden 2.md"]), null);
  assert.equal(renamedPath("Ideas/garden.md", "Garden", ["Ideas/garden.md"]), "Ideas/Garden.md");
});
