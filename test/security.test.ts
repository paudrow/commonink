// Regression tests for the security audit: hostile note text, paths and inputs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { openVault } from "../src/core/local.ts";
import { extractLinks, outlineOf, stripTags, titleOf } from "../src/core/parse.ts";
import { headingText, withoutCodeOrLinks } from "../src/core/prose.ts";
import { scanTags, tagsInLine } from "../src/core/tags.ts";
import { editTask, withTasksAdded } from "../src/core/tasks.ts";
import { boardsIn } from "../src/core/kanban.ts";
import { parseQuickAdd } from "../src/core/quickAdd.ts";
import { diffstat } from "../src/core/quire.ts";
import { openTempVault } from "./helpers.ts";

test("headings keep their words and lose their closing #s", () => {
  assert.deepEqual(
    ["Plan", "Plan ##", "Plan ##   ", "C#", "#", "  Plan \t# "].map(headingText),
    ["Plan", "Plan", "Plan", "C#", "", "  Plan"],
  );
  assert.deepEqual(outlineOf("# One #\n## Two\n### ###\n"), [{ level: 1, text: "One", line: 1 }, { level: 2, text: "Two", line: 2 }]);
});

/**
 * Inputs that took seconds to minutes before the audit (backtracking regexes on note text). Each
 * must now finish in well under a second; the old code took 4 s to 27 s on these sizes.
 */
test("hostile note text parses in linear time", () => {
  const spaces = " ".repeat(100_000);
  const cases: Array<[string, () => unknown]> = [
    ["a heading with a long run of spaces", () => titleOf(`# a${" ".repeat(4000)}b`, "md", "x.md")],
    ["the outline of the same", () => outlineOf(`## a${" ".repeat(4000)}b`)],
    ["a task section heading of the same", () => withTasksAdded(`## a${" ".repeat(4000)}b\n`, ["- [ ] x"], false)],
    ["a board column heading of the same", () => boardsIn(`:::kanban\n## a${spaces}b\n:::\n`)],
    ["100k [ in a row", () => extractLinks("[".repeat(100_000))],
    ["33k ![[ in a row", () => extractLinks("![[".repeat(33_000))],
    ["100k [ for tags", () => withoutCodeOrLinks("[".repeat(100_000))],
    ["a tag ending in 100k slashes", () => tagsInLine(`#${"/".repeat(100_000)}a`)],
    ["frontmatter tags ending in 100k spaces", () => scanTags(`---\ntags: a${spaces}b\n---\n`)],
    ["100k < in an HTML note", () => stripTags("<".repeat(100_000))],
    ["14k unclosed <script", () => stripTags("<script".repeat(14_000))],
    ["25k <h1> in an HTML note", () => titleOf("<h1>".repeat(25_000), "html", "x.html")],
    ["clearing a token after a long space run", () => editTask(`- [ ] a${spaces}b due:2026-10-01`, { due: undefined })],
    ["adding a token after a long space run", () => editTask(`- [ ] a${spaces}b`, { due: "2026-10-01" })],
    ["adding a task to a note with 100k blank lines", () => withTasksAdded(`a${"\n".repeat(100_000)}b`, ["- [ ] x"], false)],
    ["quick-add with 20k -> [[", () => parseQuickAdd("-> [[".repeat(20_000), "2026-10-01")],
    ["a diffstat of a 10k-line rewrite", () => diffstat(Array.from({ length: 10_000 }, (_, i) => `old ${i}`).join("\n"), Array.from({ length: 10_000 }, (_, i) => `new ${i}`).join("\n"))],
  ];
  const slow = cases.flatMap(([name, run]) => {
    const t = performance.now();
    run();
    const ms = performance.now() - t;
    return ms > 1000 ? [`${name}: ${Math.round(ms)} ms`] : [];
  });
  assert.deepEqual(slow, []);
});

test("a rewrite too big to diff still gets its line counts", () => {
  const before = Array.from({ length: 10_000 }, (_, i) => `old ${i}`).join("\n");
  const after = Array.from({ length: 10_000 }, (_, i) => `new ${i}`).join("\n");
  assert.equal(diffstat(before, after), "+10000 −10000");
  assert.equal(diffstat("a\nb\nc", "a\nB\nc"), "+1 −1");
});

test("a link that isn't valid percent-encoding can't take the vault down", () => {
  const { dir, quire } = openTempVault();
  quire.create("Progress.md", "# Progress\n\n[done](100%) and [x](%zz) and [[Welcome]]\n", "you");
  assert.deepEqual(quire.backlinks("Welcome.md").map((b) => b.path), ["Progress.md"]);
  quire.move("Welcome.md", "Hello.md", "you");
  assert.equal(quire.read("Progress.md").content, "# Progress\n\n[done](100%) and [x](%zz) and [[Hello]]\n");
  assert.equal(quire.resolve("/notes/progress-%zz"), null);
  const again = openVault(dir); // the index is rebuilt from disk on open
  assert.equal(again.read("Progress").path, "Progress.md");
});
