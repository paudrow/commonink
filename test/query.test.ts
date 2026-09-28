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
  assert.equal(queryProblem("colour=red"), 'Unknown query key "colour": use q, folder, tag, sort or limit');
  assert.equal(queryProblem("sort=size"), '"sort" is modified or title, not "size"');
  assert.equal(queryProblem("limit=0"), '"limit" is a whole number above 0, not "0"');
  assert.equal(queryProblem("tag=27"), '"27" isn\'t a tag: use letters, numbers, - and _, nested with /');
});
