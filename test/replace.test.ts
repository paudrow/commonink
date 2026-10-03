import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { findPattern, replaceIn } from "../src/core/replace.ts";
import { handleApi, type ApiHost } from "../src/core/api.ts";
import { openTempVault, tempVault } from "./helpers.ts";

test("replaceIn: plain text, any case unless asked, whole words when asked; the changed lines before and after", () => {
  const md = "# Colour\n\nThe colour (and Colour) of colours.\nNo match here.\n";
  assert.deepEqual(replaceIn(md, "colour", "color"), {
    content: "# color\n\nThe color (and color) of colors.\nNo match here.\n",
    count: 4,
    lines: [
      { line: 1, before: "# Colour", after: "# color" },
      { line: 3, before: "The colour (and Colour) of colours.", after: "The color (and color) of colors." },
    ],
  });
  assert.equal(replaceIn(md, "colour", "color", { matchCase: true }).count, 2);
  assert.equal(replaceIn(md, "colour", "color", { wholeWord: true }).count, 3, "not inside colours");
  assert.equal(replaceIn("a.b a+b $1", "a.b", "x").content, "x a+b $1", "the find is text, not a pattern");
  assert.equal(replaceIn("cost", "cost", "$1 & $&").content, "$1 & $&", "the replacement is written as it is");
  assert.equal(replaceIn("x", "", "y").count, 0);
  assert.ok(findPattern("(c++)", { wholeWord: true })!.test("use (c++) here"), "ends that aren't letters need no boundary");
});

test("replaceIn: only prose; frontmatter, code, link targets, URLs and #tags are left as written", () => {
  const md = [
    "---",
    "tags: [acme]",
    "company: Acme",
    "---",
    "# Acme",
    "",
    "Met Acme about [[Acme]] and [[Acme|the Acme deal]]; see ![logo](assets/acme-logo.png) and [pricing](https://acme.com/pricing).",
    "Bare https://acme.com/pricing, `acme()` and #acme stay; Acme changes.",
    "",
    "```js",
    "const acme = 1; // Acme",
    "```",
    "",
  ].join("\n");
  const r = replaceIn(md, "Acme", "Acme Inc", { wholeWord: true });
  const want = md
    .replace("# Acme", "# Acme Inc")
    .replace("Met Acme about", "Met Acme Inc about")
    .replace("; Acme changes.", "; Acme Inc changes.");
  assert.equal(r.content, want);
  assert.equal(r.count, 3);
  assert.deepEqual(r.lines.map((l) => l.line), [5, 7, 8]);
  // The preview's lines are exactly what's written.
  const lines = md.split("\n");
  for (const l of r.lines) lines[l.line - 1] = l.after;
  assert.equal(lines.join("\n"), r.content);
});

test("replaceAcross: a dry run changes nothing; then one change per note, active notes only, in a folder if asked", () => {
  const { vault } = openTempVault({
    "A.md": "# A\n\nAcme Corp signed.\n",
    "Projects/B.md": "# B\n\nCall Acme Corp, then acme corp again.\n",
    "Archive/C.md": "# C\n\nAcme Corp, archived.\n",
    "Page.html": "<p>Acme Corp</p>\n",
  });
  const dry = vault.replaceAcross("Acme Corp", "Acme Inc", { dryRun: true }, "tester");
  assert.deepEqual(dry.notes.map((n) => [n.path, n.count]), [["A.md", 1], ["Projects/B.md", 2]]);
  assert.deepEqual(dry.edits, []);
  assert.equal(vault.read("A.md").content, "# A\n\nAcme Corp signed.\n");

  const only = vault.replaceAcross("Acme Corp", "Acme Inc", { folder: "Projects", matchCase: true }, "tester");
  assert.deepEqual(only.notes.map((n) => [n.path, n.count]), [["Projects/B.md", 1]]);
  assert.equal(vault.read("Projects/B.md").content, "# B\n\nCall Acme Inc, then acme corp again.\n");
  assert.equal(only.edits[0].change.source, "tester");

  const all = vault.replaceAcross("acme corp", "Acme Inc", {}, "tester");
  assert.deepEqual(all.edits.map((e) => e.path), ["A.md", "Projects/B.md"]);
  assert.equal(vault.read("Archive/C.md").content, "# C\n\nAcme Corp, archived.\n");
  assert.equal(vault.read("Page.html").content, "<p>Acme Corp</p>\n", "HTML notes are left alone");
  // Undo: each note restored to before its change.
  for (const e of all.edits) vault.restore(e.change.id, "tester", e.version);
  assert.equal(vault.read("A.md").content, "# A\n\nAcme Corp signed.\n");
  assert.throws(() => vault.replaceAcross("", "x", {}, "tester"), /what to find/);
  assert.throws(() => vault.replaceAcross("a\nb", "x", {}, "tester"), /line at a time/);
});

test("replaceAcross: one note that would grow past the limit stops the replace before any note is written", () => {
  const { vault } = openTempVault({ "a.md": "x", "b.md": "x".repeat(300), "c.md": "x" }, { maxNoteBytes: 1000 });
  assert.throws(() => vault.replaceAcross("x", "yyyy", {}, "tester"), /b\.md would be over/);
  assert.deepEqual(["a.md", "b.md", "c.md"].map((p) => vault.read(p).content), ["x", "x".repeat(300), "x"]);
  const done = vault.replaceAcross("x", "yy", {}, "tester");
  assert.deepEqual(done.edits.map((e) => e.path), ["a.md", "b.md", "c.md"]);
  assert.equal(vault.read("a.md").content, "yy");
});

test("POST /replace previews with dryRun, then writes and hands back what Undo restores", async () => {
  const { vault } = openTempVault({ "A.md": "# A\n\nold name\n" });
  const written: string[] = [];
  const host: ApiHost = { vault, actor: "tester", user: "tester", canEditShared: true, info: () => ({}), written: (rel) => written.push(rel), moved: () => {}, removed: () => {}, tree: () => {} };
  const call = async (body: unknown) => {
    const res = await handleApi(host, new Request("http://localhost/api/replace", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), "/replace");
    return { status: res!.status, body: await res!.json() };
  };
  const dry = await call({ find: "old name", replace: "new name", dryRun: true });
  assert.deepEqual(dry.body.notes[0].lines, [{ line: 3, before: "old name", after: "new name" }]);
  assert.deepEqual([dry.body.changes, written], [[], []]);
  const done = await call({ find: "old name", replace: "new name" });
  assert.equal(done.body.changes.length, 1);
  assert.equal(done.body.versions.length, 1);
  assert.deepEqual(written, ["A.md"]);
});

test("commonink replace writes unless --dry-run; MCP's replace_text needs dry_run said outright", () => {
  const dir = tempVault();
  fs.writeFileSync(path.join(dir, "Draft.md"), "# Draft\n\nteh cat and teh dog\n");
  const env: NodeJS.ProcessEnv = { ...process.env, COMMONINK_VAULT: dir };
  delete env.COMMONINK_AGENT;
  const run = (args: string[]) => spawnSync(path.resolve(import.meta.dirname, "../bin/commonink"), args, { env, encoding: "utf8" });
  const dry = run(["replace", "teh", "the", "--dry-run"]);
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /^Would replace 2 places in 1 note\nDraft\.md \(2\)\n  3- teh cat and teh dog\n  3\+ the cat and the dog\n/);
  assert.equal(fs.readFileSync(path.join(dir, "Draft.md"), "utf8"), "# Draft\n\nteh cat and teh dog\n");
  assert.match(run(["replace", "teh", "the"]).stdout, /^Replaced 2 places in 1 note/);
  assert.equal(fs.readFileSync(path.join(dir, "Draft.md"), "utf8"), "# Draft\n\nthe cat and the dog\n");
});
