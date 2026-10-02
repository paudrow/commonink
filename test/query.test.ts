import { test } from "node:test";
import assert from "node:assert/strict";
import { formatQuery, parseQuery, queryProblem, toQuery } from "../src/core/query.ts";

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
  assert.equal(queryProblem("colour=red"), 'Unknown query key "colour": use q, folder, tag, match, sort or limit');
  assert.equal(queryProblem("sort=size"), '"sort" is modified, date, oldest or title, not "size"');
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
