import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeTag, renameTagIn, scanTags, tagMatches, tagsInLine } from "../src/core/tags.ts";

const found = (md: string) => scanTags(md).map((t) => `${t.line}:${t.display}`);

test("a tag is lowercased for matching, with its slashes tidied, and needs a letter", () => {
  assert.equal(normalizeTag("#Work/Clients/Acme"), "work/clients/acme");
  assert.equal(normalizeTag("work//clients/"), "work/clients");
  assert.equal(normalizeTag("Q3-plan"), "q3-plan");
  assert.equal(normalizeTag("日本"), "日本");
  assert.equal(normalizeTag("27"), null);
  assert.equal(normalizeTag("2026/10"), null);
  assert.equal(normalizeTag("two words"), null);
  assert.equal(normalizeTag(""), null);
});

test("a parent tag matches every tag under it, and nothing that only starts the same", () => {
  assert.equal(tagMatches("work", "work"), true);
  assert.equal(tagMatches("work/clients/acme", "work"), true);
  assert.equal(tagMatches("work/clients/acme", "work/clients"), true);
  assert.equal(tagMatches("workshop", "work"), false);
  assert.equal(tagMatches("work", "work/clients"), false);
});

test("tags come from frontmatter lists and from #words in the body", () => {
  const md = "---\ntitle: Plan\ntags: [Plan, q3]\n---\n# Plan\n\nShip it #Work/Acme, then #rest.\n";
  assert.deepEqual(found(md), ["3:Plan", "3:q3", "7:Work/Acme", "7:rest"]);
  assert.deepEqual(
    scanTags(md).map((t) => t.tag),
    ["plan", "q3", "work/acme", "rest"],
  );
});

test("frontmatter tags can be a block list, a comma list or one word", () => {
  assert.deepEqual(found("---\ntags:\n  - alpha\n  - \"beta/b\"\nstatus: x\n---\n"), ["3:alpha", "4:beta/b"]);
  assert.deepEqual(found("---\ntags: one, #two\n---\n"), ["2:one", "2:two"]);
  assert.deepEqual(found("---\ntags: solo\n---\n"), ["2:solo"]);
});

test("#words stop counting in headings, URL fragments, code and frontmatter keys", () => {
  const cases: Array<[string, string]> = [
    ["headings", "# Title\n## Plan #work\n#nospace heading? no, a tag\n"],
    ["URL fragments", "See https://example.com/page#section and [docs](guide.md#setup) and [[Note#Heading]] and <https://x.com/#a>.\n"],
    ["inline code", "Run `git log #main` now.\n"],
    ["fenced code", "```sh\n# comment #shell\necho #hi\n```\n~~~\n#tilde\n~~~\n"],
    ["frontmatter keys", "---\n#key: value #inline\nstatus: #draft\n---\nBody.\n"],
    ["issue numbers and escapes", "Fixes #27 and \\#escaped and a#b.\n"],
  ];
  for (const [what, md] of cases) {
    const want = what === "headings" ? ["3:nospace"] : [];
    assert.deepEqual(found(md), want, what);
  }
});

test("tagsInLine reports each tag's columns so it can be replaced in place", () => {
  assert.deepEqual(tagsInLine("- [ ] Call #Acme about `#not` #work/clients"), [
    { tag: "acme", display: "Acme", from: 12, to: 16 },
    { tag: "work/clients", display: "work/clients", from: 31, to: 43 },
  ]);
});

test("renaming a tag rewrites it and every tag under it, and leaves the rest of the text alone", () => {
  const md = "---\ntags: [work, home]\n---\n# Work\n\n- [ ] Call #work/acme `#work` #Work\n\n```\n#work\n```\n#workshop\n";
  assert.equal(
    renameTagIn(md, "work", "Job"),
    "---\ntags: [Job, home]\n---\n# Work\n\n- [ ] Call #Job/acme `#work` #Job\n\n```\n#work\n```\n#workshop\n",
  );
  assert.equal(renameTagIn(md, "nothing", "x"), md);
});

test("merging a tag into one the note already has keeps one of it in the frontmatter", () => {
  assert.equal(renameTagIn("---\ntags: [a, b, c]\n---\n", "a", "b"), "---\ntags: [b, c]\n---\n");
  assert.equal(renameTagIn("---\ntags:\n  - a\n  - b\n---\n", "b", "a"), "---\ntags:\n  - a\n---\n");
  assert.equal(renameTagIn("---\ntags: a, b\n---\n", "b", "A"), "---\ntags: a\n---\n");
});
