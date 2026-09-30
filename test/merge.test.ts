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

test("merge3 keeps an agent's line added at the end while you type at the end", () => {
  const base = "# Day\n\n## Log\n- 09:00 — started\n";
  assert.deepEqual(merge3(base, `${base}my thought\n`, `${base}- 10:00 — agent\n`), { ok: true, text: `${base}- 10:00 — agent\nmy thought\n` });
  assert.deepEqual(merge3("# Day\n\nhello", "# Day\n\nhello world", "# Day\n\nhello\n\n- agent\n"), { ok: true, text: "# Day\n\nhello world\n\n- agent\n" });
  assert.deepEqual(merge3("x\n", "x\nmine", "x\ntheirs"), { ok: true, text: "x\ntheirs\nmine" });
});

test("merge3 keeps edits to neighbouring lines, each made on one side", () => {
  assert.deepEqual(merge3("a\nb\nc\n", "a\nB\nc\n", "a\nb\nC\n"), { ok: true, text: "a\nB\nC\n" });
  assert.deepEqual(merge3("- [ ] x\n- [ ] y\n", "- [ ] x typed\n- [ ] y\n", "- [ ] x\n- [x] y done:2026-09-29\n"), { ok: true, text: "- [ ] x typed\n- [x] y done:2026-09-29\n" });
  assert.deepEqual(merge3("a\nb\n", "a\nb\nmine\n", "A\nb\n"), { ok: true, text: "A\nb\nmine\n" });
});

test("merge3 still refuses a real overlap", () => {
  assert.deepEqual(merge3("a\nb\nc\n", "a\nc\n", "a\nB\nc\n"), { ok: false }, "you deleted the line they changed");
  assert.deepEqual(merge3("- [ ] x\n", "- [ ] x y\n", "- [x] x done:2026-09-29\n"), { ok: false }, "both changed the one line");
});

test("merge3 refuses when both sides changed the same line differently", () => {
  assert.deepEqual(merge3("a\nb\n", "a\nmine\n", "a\ntheirs\n"), { ok: false });
  assert.deepEqual(merge3("a\nb\n", "a\nsame\n", "a\nsame\n"), { ok: true, text: "a\nsame\n" });
});
