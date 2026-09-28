import { test } from "node:test";
import assert from "node:assert/strict";
import { editsBetween, merge3 } from "../web/src/merge.ts";

const apply = (text: string, edits: Array<{ from: number; to: number; insert: string }>) =>
  [...edits].reverse().reduce((t, e) => t.slice(0, e.from) + e.insert + t.slice(e.to), text);

test("editsBetween produces edits that turn a into b", () => {
  const a = "one\ntwo\nthree\nfour\n";
  const b = "one\n2\nthree\nfour\nfive\n";
  const { changes, touched } = editsBetween(a, b);
  assert.equal(apply(a, changes), b);
  assert.deepEqual(touched.map((r) => b.slice(r.from, r.to)), ["2\n", "five\n"]);
});

test("merge3 keeps both sides' edits to different lines", () => {
  const base = "a\nb\nc\n";
  assert.deepEqual(merge3(base, "A\nb\nc\n", "a\nb\nC\n"), { ok: true, text: "A\nb\nC\n" });
});

test("merge3 refuses when both sides changed the same line differently", () => {
  assert.deepEqual(merge3("a\nb\n", "a\nmine\n", "a\ntheirs\n"), { ok: false });
  assert.deepEqual(merge3("a\nb\n", "a\nsame\n", "a\nsame\n"), { ok: true, text: "a\nsame\n" });
});
