import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { dayFrom, dayPasses, formatQuery, parseQuery, queryProblem, toQuery, type NoteQuery } from "../src/core/query.ts";
import { format, parse, textWords, toFts } from "../src/core/queryGrammar.ts";
import { openTempVault } from "./helpers.ts";
import { openVault } from "../src/core/local.ts";
import { propsOf } from "../src/core/frontmatter.ts";

test("a note query is the ::query widget's args: q, folder, tag, sort and limit", () => {
  const src = 'q="launch plan" folder=Projects tag=work/acme sort=title limit=5';
  assert.deepEqual(parseQuery(src), { q: "launch plan", folder: "Projects", tag: "work/acme", sort: "title", limit: 5 });
  assert.equal(formatQuery(parseQuery(src)), src);
  assert.equal(formatQuery({ tag: "work", sort: "modified" }), "tag=work");
  assert.equal(formatQuery({}), "");
});

test("a widget's other args (label, id) aren't part of its query", () => {
  assert.deepEqual(toQuery({ label: "Active", id: "k3x9q", folder: "Projects", limit: "6" }), { folder: "Projects", limit: 6 });
  assert.deepEqual(toQuery({ sort: "sideways", limit: "lots" }), {});
});

test("a saved query is checked key by key", () => {
  assert.equal(queryProblem("tag=work sort=title"), null);
  assert.equal(queryProblem(""), null);
  assert.equal(queryProblem("colour=red"), null); // a frontmatter property
  assert.equal(queryProblem("sort=size"), '"sort" is modified, date, oldest, title or created, not "size"');
  assert.equal(queryProblem("limit=0"), '"limit" is a whole number above 0, not "0"');
  assert.equal(queryProblem("tag=27"), '"27" isn\'t a tag: use letters, numbers, - and _, nested with /');
  assert.equal(queryProblem("limit=99999999999999999999"), '"limit" is a whole number above 0, not "99999999999999999999"');
  assert.equal(queryProblem("tag folder=Ideas"), 'Give "tag" a value, like tag=work');
  assert.equal(queryProblem('q="unterminated'), "A quote isn't closed");
});

test("a query is tidied the way the Notes filters write it, so the two compare equal", () => {
  assert.equal(formatQuery(parseQuery("tag=#Plan folder=Projects/")), "folder=Projects tag=Plan");
});

test("several tags all have to match, however they're written", () => {
  for (const src of ["tag=work tag=plan", "tag=work,plan", 'tag="#work, #plan"', "tag=work plan", "tag=work+plan"]) {
    assert.deepEqual(parseQuery(src), { tag: "work,plan" }, src);
    assert.equal(queryProblem(src), null, src);
  }
  assert.equal(formatQuery(parseQuery("tag=work tag=Work tag=plan")), 'tag="work,plan"');
  assert.equal(queryProblem("tag=work,27"), '"27" isn\'t a tag: use letters, numbers, - and _, nested with /');
});

test('a folder or search with "and" in it stays one value, quoted or not', () => {
  assert.equal(queryProblem('folder="Health and Fitness"'), null);
  assert.equal(queryProblem('q="pros and cons" tag=work'), null);
  assert.deepEqual(parseQuery("folder=Health and Fitness sort=date"), { folder: "Health and Fitness", sort: "date" });
  assert.deepEqual(parseQuery("folder=2. Areas/Health and Fitness tag=x"), { folder: "2. Areas/Health and Fitness", tag: "x" });
  assert.equal(formatQuery(parseQuery("folder=Health and Fitness")), 'folder="Health and Fitness"');
  // A key with no value is still caught, even after a value that runs on.
  assert.equal(queryProblem("folder=Projects tag"), 'Give "tag" a value, like tag=work');
});

test("sort is modified, date, oldest or title, and modified goes unsaid", () => {
  assert.equal(formatQuery(parseQuery("tag=work sort=date")), "tag=work sort=date");
  assert.equal(formatQuery(parseQuery("sort=oldest")), "sort=oldest");
  assert.equal(formatQuery(parseQuery("sort=modified")), "");
  assert.deepEqual(toQuery({ tag: "work,plan", sort: "date" }), { tag: "work,plan", sort: "date" });
});

test("match=any makes several tags an or, and is dropped with fewer than two", () => {
  assert.deepEqual(parseQuery("tag=work,plan match=any"), { tag: "work,plan", match: "any" });
  assert.equal(formatQuery(parseQuery("tag=work tag=plan match=any")), 'tag="work,plan" match=any');
  assert.deepEqual(parseQuery("tag=work match=any"), { tag: "work" });
  assert.equal(formatQuery(parseQuery("tag=work,plan match=all")), 'tag="work,plan"');
  assert.equal(queryProblem("tag=a,b match=some"), '"match" is all or any, not "some"');
});

// ---------------------------------------------------------------- the words in q (grammar v2)

const DAY = 86_400_000;

test("plain words read the way they always did: each one a prefix, all of them needed", () => {
  const s = parse("launch plan e-mail");
  assert.equal(format(s.expr), "launch plan e mail");
  assert.equal(toFts(s.expr), '"launch"* "plan"* "e"* "mail"*');
  // A lone dash and a quote that never closes are just words. (a=b is a property filter.)
  assert.equal(toFts(parse('a=b - "open').expr), '"open"*');
  assert.equal(toFts(parse("don't stop").expr), '"don"* "t"* "stop"*');
  assert.equal(parse('a=b - "open').error, null);
});

test('-word, OR and "phrase" in the words', () => {
  // OR goes after AND, so a group keeps budget OR costs together.
  const s = parse('"launch plan" (budget OR costs) -draft -"old idea"');
  assert.equal(toFts(s.expr), '("launch plan" ("budget"* OR "costs"*)) NOT ("draft"* OR "old idea")');
  assert.deepEqual(textWords(s.expr), ["launch", "plan", "budget", "costs"]);
  // Single quotes make a phrase too: that's how a ::query or smart folder writes one inside q="…".
  assert.equal(toFts(parse("'launch plan'").expr), '"launch plan"');
  // OR with nothing on one side is a mistake, said with where it is; the rest still reads.
  assert.equal(parse("OR plan OR").error?.message, "Nothing before OR at character 1: put a word or filter on each side");
  assert.equal(toFts(parse("OR plan OR").expr), '"plan"*');
  // A lowercase or is a word.
  assert.equal(toFts(parse("plan or").expr), '"plan"* "or"*');
});

test("tag=, -tag= and dates in the words are filters, not words", () => {
  const s = parse("plan tag=#Work -tag=draft,old modified>-7d created<=2026-09-01");
  assert.equal(toFts(s.expr), '"plan"*');
  assert.equal(format(s.expr), "plan tag=Work -tag=draft -tag=old modified>-7d created<=2026-09-01");
  assert.equal(s.error, null);
  assert.match(parse("modified>lastweek").error!.message, /isn't a day/);
  assert.match(parse("tag=27").error!.message, /isn't a tag/);
});

test("days count back from today: days, weeks, months and years", () => {
  assert.equal(dayFrom("today", "2026-10-02"), "2026-10-02");
  assert.equal(dayFrom("yesterday", "2026-10-02"), "2026-10-01");
  assert.equal(dayFrom("-7d", "2026-10-02"), "2026-09-25");
  assert.equal(dayFrom("-2w", "2026-10-02"), "2026-09-18");
  assert.equal(dayFrom("-1m", "2026-03-31"), "2026-02-28");
  assert.equal(dayFrom("-1y", "2026-10-02"), "2025-10-02");
  assert.equal(dayFrom("+3d", "2026-10-02"), "2026-10-05");
  assert.equal(dayFrom("2026-02-30", "2026-10-02"), null);
  assert.equal(dayFrom("soon", "2026-10-02"), null);
  // modified>-7d is the last seven days, today included.
  const f = { field: "modified", op: ">", day: "-7d" } as const;
  assert.equal(dayPasses("2026-09-26", f, "2026-10-02"), true);
  assert.equal(dayPasses("2026-09-25", f, "2026-10-02"), false);
});

test("filters written as keys of their own join q, so a query has one place for them", () => {
  assert.deepEqual(parseQuery("folder=Projects modified>-7d modified<-1d -tag=draft -tag=old"), { q: "modified>-7d modified<-1d -tag=draft -tag=old", folder: "Projects" });
  assert.deepEqual(toQuery({ q: "launch", modified: ">-7d", "-tag": "draft", label: "Recent" }), { q: "launch modified>-7d -tag=draft" });
  assert.equal(formatQuery(parseQuery('q="launch -draft" created>=2026-09-01 sort=created')), 'q="launch -draft created>=2026-09-01" sort=created');
  assert.deepEqual(parseQuery('q="launch plan" -tag=draft'), { q: "launch plan -tag=draft" });
  assert.equal(queryProblem('q="launch" modified>-7d -tag=draft sort=created'), null);
  assert.match(queryProblem("modified>someday")!, /isn't a day/);
  assert.match(queryProblem('q="plan -tag=27"')!, /isn't a tag/);
  assert.equal(queryProblem("size>3"), "Only modified and created compare with < and >: write size=… (at character 1)");
});

test("the feed runs the grammar: words left out, OR, phrases, tags left out, dates and sort=created", () => {
  let now = Date.parse("2026-10-02T12:00:00Z");
  const { dir, vault } = openTempVault({}, { now: () => now, timeZone: "UTC" });
  now -= 40 * DAY;
  vault.create("Old plan", "# Old plan\n\nThe launch plan, first draft. #work\n", "t");
  now += 30 * DAY;
  vault.create("Launch", "# Launch\n\nThe launch plan for real. #work #draft\n", "t");
  now += 5 * DAY;
  vault.create("Costs", "# Costs\n\nBudget for the plan launch. #work/acme\n", "t");
  now += 5 * DAY;
  const at = (rel: string, daysAgo: number) => fs.utimesSync(path.join(dir, rel), new Date(now - daysAgo * DAY), new Date(now - daysAgo * DAY));
  at("Old plan.md", 40);
  at("Launch.md", 10);
  at("Costs.md", 2);
  vault.sync();
  const titles = (src: string) => vault.feed(parseQuery(src)).items.map((i) => i.title);
  assert.deepEqual(titles('q="plan"'), ["Costs", "Launch", "Old plan"]);
  assert.deepEqual(titles('q="plan -draft"'), ["Costs"]);
  assert.deepEqual(titles(`q="'launch plan'"`), ["Launch", "Old plan"]);
  assert.deepEqual(titles('q="budget OR first"'), ["Costs", "Old plan"]);
  assert.deepEqual(titles("q=-draft"), ["Costs"]);
  assert.deepEqual(titles("tag=work -tag=draft"), ["Costs", "Old plan"]);
  assert.deepEqual(titles("-tag=work/acme"), ["Launch", "Old plan"]);
  assert.deepEqual(titles('q="tag=work tag=draft"'), ["Launch"]);
  assert.deepEqual(titles("modified>-7d"), ["Costs"]);
  assert.deepEqual(titles("modified<-7d modified>-30d"), ["Launch"]);
  assert.deepEqual(titles("modified<2026-09-01"), ["Old plan"]);
  // Created goes by each note's first change in History.
  assert.deepEqual(titles("created>=-5d"), ["Costs"]);
  assert.deepEqual(titles("sort=created"), ["Costs", "Launch", "Old plan"]);
  assert.deepEqual(titles("sort=created q=plan created<-20d"), ["Old plan"]);
  // A file added outside the app has no History: it goes by when its file last changed.
  fs.writeFileSync(path.join(dir, "Dropped in.md"), "# Dropped in\n");
  at("Dropped in.md", 1);
  vault.sync();
  assert.deepEqual(titles("created>-3d"), ["Dropped in"]);
  // Search reads the words the same way.
  assert.deepEqual(vault.search("plan -draft").map((h) => h.title), ["Costs"]);
  assert.deepEqual(vault.search('"plan for"').map((h) => h.title), ["Launch"]);
});

test("a note query's old forms find what they always found", () => {
  const { vault } = openTempVault({ "A.md": "# A\n\nlaunch plan\n", "B.md": "# B\n\nlaunching plans #work\n", "C.md": "# C\n\nplan only\n" });
  const paths = (q: NoteQuery) => vault.feed(q).items.map((i) => i.path).sort();
  assert.deepEqual(paths({ q: "launch plan" }), ["A.md", "B.md"]);
  assert.deepEqual(paths({ q: "launch, plan!" }), ["A.md", "B.md"]);
  assert.deepEqual(paths({ q: "pla", tag: "work" }), ["B.md"]);
  assert.deepEqual(paths({ q: "" }), ["A.md", "B.md", "C.md"]);
});

// ---------------------------------------------------------------- frontmatter properties

test("a note's properties: lowercase keys, one row per list item, tags and title left out", () => {
  const md = "---\nStatus: Draft\ntitle: Ignored\ntags: [a, b]\nowners: [Ana, \"Bo, Jr\"]\nsteps:\n  - one\n  - two\nnote: a, b\nempty:\n---\n# Body\n";
  assert.deepEqual(propsOf(md), [
    { key: "status", value: "Draft" },
    { key: "owners", value: "Ana" },
    { key: "owners", value: "Bo, Jr" },
    { key: "steps", value: "one" },
    { key: "steps", value: "two" },
    { key: "note", value: "a, b" },
  ]);
  assert.deepEqual(propsOf("# No frontmatter\n"), []);
});

test("status=draft, -status=done and has=due in the words are property filters", () => {
  const s = parse("plan Status=Draft -status=done has=due,owner -has=archived tags=work 'x y'");
  assert.equal(format(s.expr), `plan status=Draft -status=done has=due has=owner -has=archived tag=work "x y"`);
  assert.equal(toFts(s.expr), '"plan"* "x y"');
  assert.deepEqual(parse("stage='in review'").expr, { kind: "prop", key: "stage", value: "in review" });
  assert.match(parse("status>draft").error!.message, /Only modified and created compare/);
  // A dash leaves out a date range too, like any other term.
  assert.deepEqual(parse("-modified=today").expr, { kind: "not", item: { kind: "date", field: "modified", op: "=", day: "today" } });
  // Written as keys of their own (a smart folder, a ::query), they join q; a widget's own args don't.
  assert.deepEqual(parseQuery('folder=Projects status=draft stage="in review" -has=due'), { q: "status=draft stage='in review' -has=due", folder: "Projects" });
  assert.deepEqual(toQuery({ label: "Drafts", id: "x1", view: "table", cols: "status", status: "draft" }), { q: "status=draft" });
  assert.equal(formatQuery(parseQuery('stage="in review"')), `q="stage='in review'"`);
  assert.equal(queryProblem("status=draft -has=due"), null);
});

test("the feed filters on frontmatter properties", () => {
  const { vault } = openTempVault({
    "A.md": "---\nstatus: draft\ndue: 2026-10-10\n---\n# A\n",
    "B.md": "---\nStatus: Done\nowners: [Ana, Bo]\n---\n# B\n",
    "C.md": "---\nstatus: [draft, review]\ntags: [work]\n---\n# C\n",
    "D.md": "# D\n",
  });
  const paths = (src: string) => vault.feed(parseQuery(src)).items.map((i) => i.path).sort();
  assert.deepEqual(paths("status=draft"), ["A.md", "C.md"]);
  assert.deepEqual(paths("STATUS=DONE"), ["B.md"]);
  assert.deepEqual(paths("-status=done"), ["A.md", "C.md", "D.md"]);
  assert.deepEqual(paths("status=review"), ["C.md"]);
  assert.deepEqual(paths("owners=bo"), ["B.md"]);
  assert.deepEqual(paths("has=due"), ["A.md"]);
  assert.deepEqual(paths("-has=status"), ["D.md"]);
  assert.deepEqual(paths("tags=work"), ["C.md"]);
  assert.deepEqual(paths("title=d"), ["D.md"]);
  assert.deepEqual(paths("status=draft -has=due"), ["C.md"]);
  // The index follows edits.
  vault.edit("A", { oldString: "status: draft", newString: "status: done" }, "t");
  assert.deepEqual(paths("status=done"), ["A.md", "B.md"]);
  vault.delete(["B"], "t");
  assert.deepEqual(paths("status=done"), ["A.md"]);
});

test("an index from before properties reads every note again to fill them in", () => {
  const { dir, vault } = openTempVault({ "A.md": "---\nstatus: draft\n---\n# A\n" });
  vault.db.exec("DROP TABLE props");
  const again = openVault(dir);
  assert.deepEqual(again.feed(parseQuery("status=draft")).items.map((i) => i.path), ["A.md"]);
});

test("several folders are any of them, written with | or as folder= more than once", () => {
  assert.deepEqual(parseQuery("folder=Projects folder=/Areas/Health and Fitness/"), { folder: "Projects|Areas/Health and Fitness" });
  assert.equal(formatQuery(parseQuery('folder="Projects|Areas|Projects"')), 'folder="Projects|Areas"');
  assert.equal(queryProblem('folder="Projects|Areas"'), null);
});

test("an apostrophe inside a word is part of it; a ' only quotes at the start of a value", () => {
  assert.deepEqual(parseQuery("folder=Bob's Notes"), { folder: "Bob's Notes" });
  assert.equal(queryProblem("folder=Bob's Notes"), null);
  assert.deepEqual(parseQuery("q=don't stop"), { q: "don't stop" });
  assert.deepEqual(parseQuery("q=stop don't tag=work"), { q: "stop don't", tag: "work" });
  assert.equal(queryProblem("q=don't stop"), null);
  // Quoting still works either way, and a ' left open is called out as one.
  assert.deepEqual(parseQuery(`q='launch plan' folder="Bob's Notes"`), { q: "launch plan", folder: "Bob's Notes" });
  assert.equal(queryProblem("q='abc"), "A quote isn't closed");
  assert.equal(queryProblem("sort=title 'abc'"), 'Give "abc" a value, like abc=…');
  // What the app writes reads back the same (a " in a value is written as ').
  assert.deepEqual(parseQuery(formatQuery({ folder: "Bob's Notes" })), { folder: "Bob's Notes" });
  assert.deepEqual(parseQuery(formatQuery({ q: "don't stop", tag: "work" })), { q: "don't stop", tag: "work" });
  assert.deepEqual(parseQuery(formatQuery({ q: 'say "hi"' })), { q: "say 'hi'" });
});
