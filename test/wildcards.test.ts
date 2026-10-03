// Wildcards in note queries: a * in a word or in a filter's value (see src/core/queryGrammar.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatQuery, parseQuery, queryProblem } from "../src/core/query.ts";
import { cleanTagFilter, format, globMatch, inFolders, parse, SYNTAX, tagFits, textWords, toFts, valueFits } from "../src/core/queryGrammar.ts";
import { cpuMs, openTempVault } from "./helpers.ts";

test("a * fits any run of characters, or none, and the pattern is the whole text", () => {
  assert.equal(globMatch("pl*ing", "planning"), true);
  assert.equal(globMatch("pl*ing", "pling"), true);
  assert.equal(globMatch("pl*ing", "plannings"), false);
  assert.equal(globMatch("*ing", "ing"), true);
  assert.equal(globMatch("*a*b*", "xxaxxbxx"), true);
  assert.equal(globMatch("a*", "b"), false);
  assert.equal(globMatch("*", ""), true);
});

test("a hostile pattern is read in time that grows with the text, not explodes", () => {
  const text = "a".repeat(20_000);
  assert.ok(cpuMs(() => assert.equal(globMatch(`${"*a".repeat(20)}*b`, text), false)) < 500, "fast");
});

test("a word with a * is a pattern; a * only at the end is the prefix every word is already", () => {
  assert.deepEqual(parse("pl*ing").expr, { kind: "text", words: ["pl*ing"], phrase: false });
  assert.deepEqual(parse("plan*").expr, parse("plan").expr);
  assert.deepEqual(parse("*plan*").expr, { kind: "text", words: ["*plan*"], phrase: false });
  assert.equal(parse("*").expr, null);
  assert.deepEqual(parse('"launch pl*"').expr, { kind: "text", words: ["launch", "pl"], phrase: true }, "a phrase keeps its words");
  for (const q of ["pl*ing -*ed", "folder=*/Clients tag=work/* status=draft*", "(*ing OR owner=*Smith) plan"]) {
    assert.equal(parse(q).error, null, q);
    assert.deepEqual(parse(format(parse(q).expr)).expr, parse(q).expr, q);
  }
  // The full-text index can't find a pattern, so it isn't asked to; the list marks its longest run of letters.
  assert.equal(toFts(parse("launch pl*ing").expr), '"launch"*');
  assert.equal(toFts(parse("*ing").expr), null);
  assert.deepEqual(textWords(parse("launch pl*ing").expr), ["launch", "ing"]);
});

test("folders, tags and values fit their patterns", () => {
  assert.equal(inFolders("Work/Clients/Acme/Notes.md", ["*/Clients"]), true);
  assert.equal(inFolders("Clients/Acme.md", ["*/Clients"]), false, "Clients at the top is in no folder");
  assert.equal(inFolders("Projects/Plan.md", ["Projects/*"]), true, "anything under Projects");
  assert.equal(inFolders("Projects/Deep/Plan.md", ["Projects/*"]), true);
  assert.equal(inFolders("Projects/Plan.md", ["Proj*"]), true);
  assert.equal(inFolders("Proj.md", ["Proj*"]), false, "a note isn't a folder");
  assert.equal(inFolders("Areas/Health.md", ["Proj*", "Areas"]), true);

  assert.equal(tagFits("work/acme", "work/*"), true);
  assert.equal(tagFits("work/acme/q3", "work/*"), true);
  assert.equal(tagFits("work", "work/*"), false);
  assert.equal(tagFits("workshop", "work*"), true);
  assert.equal(tagFits("clients/acme", "*/acme"), true);
  assert.equal(cleanTagFilter("#Work/*"), "Work/*");
  assert.equal(cleanTagFilter("wo rk*"), null);
  assert.equal(cleanTagFilter("Work"), "Work");

  assert.equal(valueFits("Drafting", "draft*"), true);
  assert.equal(valueFits("Jo Smith", "*smith"), true);
  assert.equal(valueFits("Drafting", "draft"), false);
});

test("a saved query keeps its wildcards in the folder and tag keys", () => {
  const src = 'q="pl*ing" folder=*/Clients tag=work/*';
  assert.equal(queryProblem(src), null);
  assert.deepEqual(parseQuery(src), { q: "pl*ing", folder: "*/Clients", tag: "work/*" });
  assert.equal(formatQuery(parseQuery(src)), 'q="pl*ing" folder="*/Clients" tag="work/*"');
  assert.match(queryProblem("tag=wo!*") ?? "", /isn't a tag/);
});

test("the feed and search run wildcards over a vault", () => {
  const { vault } = openTempVault({
    "Work/Clients/Acme.md": "---\nstatus: drafting\nowner: Jo Smith\ntags: [work/clients]\n---\n# Acme\n\nplanning the playing field\n",
    "Projects/Deep/Plan.md": "---\nstatus: done\nowner: Al Jones\ntags: [work]\n---\n# Plan\n\nplanned and shipped\n",
    "Projects/Roadmap.md": "# Roadmap\n\nwhat's next #workshop\n",
    "Inbox.md": "# Inbox\n\nnothing sorted\n",
  });
  const paths = (q: string, keys: { folder?: string; tag?: string } = {}) => vault.feed({ q, ...keys, limit: 50 }).items.map((i) => i.path).sort();
  assert.deepEqual(paths("pl*ing"), ["Work/Clients/Acme.md"]);
  assert.deepEqual(paths("PL*ING"), ["Work/Clients/Acme.md"], "in any case");
  assert.deepEqual(paths("*ed"), ["Inbox.md", "Projects/Deep/Plan.md"]);
  assert.deepEqual(paths("plan*"), ["Projects/Deep/Plan.md", "Work/Clients/Acme.md"]);
  assert.deepEqual(paths("-*ing"), ["Projects/Deep/Plan.md", "Projects/Roadmap.md"], "nothing ends in ing too");
  assert.deepEqual(paths("folder=*/Clients"), ["Work/Clients/Acme.md"]);
  assert.deepEqual(paths("folder=Projects/*"), ["Projects/Deep/Plan.md", "Projects/Roadmap.md"]);
  assert.deepEqual(paths("folder=*o*"), ["Projects/Deep/Plan.md", "Projects/Roadmap.md", "Work/Clients/Acme.md"]);
  assert.deepEqual(paths("tag=work/*"), ["Work/Clients/Acme.md"]);
  assert.deepEqual(paths("tag=work*"), ["Projects/Deep/Plan.md", "Projects/Roadmap.md", "Work/Clients/Acme.md"]);
  assert.deepEqual(paths("-tag=work/*"), ["Inbox.md", "Projects/Deep/Plan.md", "Projects/Roadmap.md"]);
  assert.deepEqual(paths("status=draft*"), ["Work/Clients/Acme.md"]);
  assert.deepEqual(paths("owner=*Smith OR owner=al*"), ["Projects/Deep/Plan.md", "Work/Clients/Acme.md"]);
  assert.deepEqual(paths("title=*map"), ["Projects/Roadmap.md"]);
  // The keys a smart folder's rows write.
  assert.deepEqual(paths("", { folder: "*/Clients|Proj*", tag: "work/*" }), ["Work/Clients/Acme.md"]);

  const hits = vault.search("pl*ing");
  assert.deepEqual(hits.map((h) => h.path), ["Work/Clients/Acme.md"]);
  assert.deepEqual(hits[0].lines.map((l) => l.text), ["planning the playing field"]);
  assert.deepEqual(vault.search("*ed -shipped").map((h) => h.path), ["Inbox.md"]);
  assert.deepEqual(vault.search("zz*zz"), []);
});

test("the syntax help lists the wildcards", () => {
  assert.ok(SYNTAX.some((s) => s.example === "pl*ing"));
  assert.ok(SYNTAX.some((s) => s.example === "folder=*/Clients"));
  for (const s of SYNTAX) assert.equal(parse(s.example).error, null, s.example);
});
