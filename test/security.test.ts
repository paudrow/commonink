// Regression tests for the security audit: hostile note text, paths and inputs.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openVault } from "../src/core/local.ts";
import { extractLinks, outlineOf, stripTags, titleOf } from "../src/core/parse.ts";
import { headingName, headingText, withoutCodeOrLinks } from "../src/core/prose.ts";
import { scanTags, tagsInLine } from "../src/core/tags.ts";
import { editTask, withTasksAdded } from "../src/core/tasks.ts";
import { boardsIn } from "../src/core/kanban.ts";
import { capHtmlDepth, clip, tameMarkdown } from "../src/core/depth.ts";
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

/** The Tasks view's headings for a note's tasks. */
function tasksUnder(md: string) {
  const { quire } = openTempVault();
  quire.create("Hostile.md", md, "you");
  return quire.tasks({ note: "Hostile" }).map((t) => t.heading);
}

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
    ["a coloured board column heading of the same", () => boardsIn(`:::kanban\n## a${spaces}b {color=blue}\n:::\n`)],
    ["a heading ending in } after a long space run", () => headingName(`a${spaces}b}`)],
    ["the Tasks view's heading for a task under the same", () => tasksUnder(`## a${spaces}b\n- [ ] x\n`)],
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

test("no write can leave a note over the size limit, however it's made", () => {
  const { quire } = openTempVault(undefined, { maxNoteBytes: 1000 });
  assert.throws(() => quire.create("Big.md", "x".repeat(1001), "you"), /Big\.md would be over 0 MB, the most a note can hold/);
  quire.create("Small.md", "ab ".repeat(100), "you");
  // 50 bytes of arguments that would multiply the note 200 times over.
  assert.throws(() => quire.edit("Small.md", { oldString: "ab", newString: "ab".repeat(20), replaceAll: true }, "agent"), /would be over/);
  assert.equal(quire.read("Small.md").content, "ab ".repeat(100));
});

test("one request for diffs can't ask for unbounded text", () => {
  const { quire } = openTempVault();
  const mb = "x".repeat(1024 * 1024);
  quire.create("Log.md", mb, "you");
  for (let i = 0; i < 24; i++) quire.save("Log.md", i % 2 ? mb : `${mb}y`, { source: i % 2 ? "you" : "agent" });
  // Every other change, so each is a run of its own (with its full before and after text).
  const ids = quire.changes({ path: "Log.md", limit: 50 }).map((c) => c.id).filter((_, i) => i % 2 === 0);
  const runs = quire.diffSet(ids).flatMap((f) => f.runs);
  const text = runs.reduce((n, r) => n + (r.before?.length ?? 0) + (r.after?.length ?? 0), 0);
  assert.equal(runs.length, 13);
  assert.ok(text <= 18 * 1024 * 1024, `${text} bytes of text`);
  assert.equal(runs.at(-1)!.before, null, "the oldest runs come without their text");
  // Net stats for many sets share one budget: once it's spent, the rest come back unknown.
  const stats = quire.diffStats(Array.from({ length: 50 }, () => ids.slice(0, 2)));
  assert.deepEqual([stats[0], stats.at(-1)], [{ add: 2, del: 2 }, null]);
});

test("a symlink in the vault doesn't lead reads, writes or listings outside it", () => {
  const { dir, quire } = openTempVault();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "quire-outside-"));
  fs.writeFileSync(path.join(outside, "secret.md"), "# Secret\n");
  fs.symlinkSync(outside, path.join(dir, "linkdir"));
  fs.symlinkSync(path.join(outside, "secret.md"), path.join(dir, "linked.md"));
  quire.sync();
  assert.deepEqual(quire.list(undefined, "all").map((n) => n.path).filter((p) => p.includes("link")), []);
  assert.throws(() => quire.read("linkdir/secret.md"), /No note matches/);
  assert.equal(quire.files.read("linked.md"), null);
  assert.throws(() => quire.create("linkdir/pwned.md", "x", "agent"), /leads outside the vault/);
  assert.deepEqual(fs.readdirSync(outside), ["secret.md"]);
  fs.rmSync(outside, { recursive: true, force: true });
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

test("nesting caps leave ordinary notes as written, and flatten only what's past them", () => {
  const ordinary = ["- a\n  - b\n    - c", "> quote\n> > inner", "---", "* * *", "- - -", "**bold** _em_ ~~del~~", "1. one\n2. two", "```\n" + " ".repeat(200) + "code\n```"];
  for (const md of ordinary) assert.equal(tameMarkdown(md), md, md);
  assert.equal(tameMarkdown("> ".repeat(20) + "x"), "> ".repeat(20) + "x", "20 levels stay");
  assert.equal(tameMarkdown("> - ".repeat(15) + "x"), "> - ".repeat(10) + "x", "past 20, the extra markers go and the text stays at the deepest level");
  assert.equal(tameMarkdown("- a\n" + " ".repeat(300) + "- deep"), "- a\n" + " ".repeat(100) + "- deep", "list content indented past 100 columns");
  assert.equal(tameMarkdown("\n" + " ".repeat(300) + "code"), "\n" + " ".repeat(300) + "code", "an indented code block is code, and left alone");
  assert.equal(tameMarkdown("- " + "*".repeat(70) + "a"), "- " + "\\*".repeat(70) + "a", "a run of 70 * is text");
  assert.equal(tameMarkdown("*".repeat(70)), "*".repeat(70), "a line of them is still a thematic break");
  assert.equal(tameMarkdown("`" + "*".repeat(70) + "`"), "`" + "*".repeat(70) + "`", "code is left alone");
});

test("HTML nested past the cap loses its extra tags, closing ones included, and keeps its text; shallower HTML is untouched", () => {
  const shallow = "<div><p><kbd>K</kbd> <em>x</em><br><img src=a></p></div>";
  assert.equal(capHtmlDepth(shallow), shallow);
  assert.equal(capHtmlDepth("<b>".repeat(3) + "x" + "</b>".repeat(3), 2), "<b><b>x</b></b>");
  assert.equal(capHtmlDepth("<i>".repeat(4) + "<!-- <i> -->" + "<br/>", 2), "<i><i><!-- <i> --><br/>");
  // A paragraph's end closes what's still open in it, so what comes after isn't nested any deeper.
  assert.equal(capHtmlDepth("<p>" + "<kbd>".repeat(4) + "a</p><p>b</p>", 3), "<p><kbd><kbd>a</p><p>b</p>");
  assert.equal(capHtmlDepth("</div>x", 1), "</div>x", "a closing tag with nothing to close is left for the browser");
  assert.equal(clip("x".repeat(400)).length, 301);
  assert.equal(clip("short"), "short");
});
