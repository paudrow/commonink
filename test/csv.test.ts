import { test } from "node:test";
import assert from "node:assert/strict";
import { compareCells, csvTable, parseCsv, rowFilter, toNumber } from "../web/src/csv.ts";

test("parseCsv handles quotes, doubled quotes, embedded newlines and CRLF", () => {
  assert.deepEqual(parseCsv('name,note\r\n"Smith, J","said ""hi""\nthen left"\r\n\r\nLee,\n'), [
    ["name", "note"],
    ["Smith, J", 'said "hi"\nthen left'],
    ["Lee", ""],
  ]);
});

test("parseCsv drops Excel's byte-order mark so the first header is usable", () => {
  assert.deepEqual(parseCsv("﻿city,pop\nOslo,700000\n"), [["city", "pop"], ["Oslo", "700000"]]);
});

test("an unterminated quote keeps the rest of the file in that field", () => {
  assert.deepEqual(parseCsv('a,"b\nc'), [["a", "b\nc"]]);
});

test("csvTable names blank and missing headers and spots numeric columns", () => {
  assert.deepEqual(csvTable("city,,signups\nOslo,x,$1,200\nLima,y,15%,extra\n"), {
    headers: ["city", "Column 2", "signups", "Column 4"],
    data: [["Oslo", "x", "$1", "200"], ["Lima", "y", "15%", "extra"]],
    numeric: [false, false, true, false],
  });
  assert.equal(csvTable("\n\n"), null);
});

test("csvTable copes with a few hundred thousand rows", () => {
  const text = `n\n${"1\n".repeat(300_000)}`;
  assert.equal(csvTable(text)!.data.length, 300_000);
});

test("toNumber reads money, percentages and signs, and nothing else", () => {
  assert.deepEqual(["$1,200", "15%", "-3.5", "+.5", "£ 7", "1e5", "abc", "", "."].map(toNumber), [1200, 15, -3.5, 0.5, 7, NaN, NaN, NaN, NaN]);
});

test("sorting puts blanks last in both directions", () => {
  const cells = ["10", "", "9", "100"];
  assert.deepEqual([...cells].sort((a, b) => compareCells(a, b, true, 1)), ["9", "10", "100", ""]);
  assert.deepEqual([...cells].sort((a, b) => compareCells(a, b, true, -1)), ["100", "10", "9", ""]);
  assert.deepEqual(["item 10", "item 9", "Item 1"].sort((a, b) => compareCells(a, b, false, 1)), ["Item 1", "item 9", "item 10"]);
});

test("the filter language: words, columns, comparisons, quotes and exclusions", () => {
  const { headers, data, numeric } = csvTable("city,signups\nNew York,120\nLondon,80\nNew Delhi,300\nYork,\n")!;
  const run = (q: string) => data.filter(rowFilter(q, headers, numeric)).map((r) => r[0]);
  assert.deepEqual(run(""), ["New York", "London", "New Delhi", "York"]);
  assert.deepEqual(run("york"), ["New York", "York"]);
  assert.deepEqual(run('city:"new york"'), ["New York"]);
  assert.deepEqual(run("sign:>100"), ["New York", "New Delhi"]);
  assert.deepEqual(run("signups:<=120 -london"), ["New York"]);
  assert.deepEqual(run("new -delhi"), ["New York"]);
});
