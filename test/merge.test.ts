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

test("a merge keeps every line either side added and one side's changes whole, over thousands of random edits", async () => {
  const { diffLines } = await import("diff");
  let seed = 42;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  const doc = () => Array.from({ length: Math.floor(rand() * 7) }, () => ["a", "b", "- [ ] t", "", "# H"][Math.floor(rand() * 5)]).join("\n") + (rand() < 0.8 ? "\n" : "");
  const edit = (s: string) => {
    const lines = s.split("\n");
    for (let k = 0; k < 1 + rand() * 3; k++) {
      const i = Math.floor(rand() * (lines.length + 1));
      const op = rand();
      if (op < 0.4) lines.splice(i, 0, `new${Math.floor(rand() * 100)}`);
      else if (op < 0.7 && i < lines.length) lines[i] += `!${Math.floor(rand() * 100)}`;
      else if (i < lines.length) lines.splice(i, 1);
    }
    return lines.join("\n");
  };
  const eol = (s: string) => (s && !s.endsWith("\n") ? `${s}\n` : s);
  const added = (from: string, to: string) => diffLines(eol(from), eol(to)).filter((p) => p.added).flatMap((p) => p.value.split("\n").filter(Boolean));
  for (let n = 0; n < 3000; n++) {
    const base = doc();
    const [ours, theirs] = [edit(base), edit(base)];
    const r = merge3(base, ours, theirs);
    if (!r.ok) continue;
    if (ours === base) assert.equal(r.text, theirs);
    if (theirs === base) assert.equal(r.text, ours);
    const lines = r.text.split("\n");
    for (const l of [...added(base, ours), ...added(base, theirs)]) assert.ok(lines.includes(l), JSON.stringify({ base, ours, theirs, text: r.text, lost: l }));
  }
});

test("merge3 refuses when both sides changed the same line differently", () => {
  assert.deepEqual(merge3("a\nb\n", "a\nmine\n", "a\ntheirs\n"), { ok: false });
  assert.deepEqual(merge3("a\nb\n", "a\nsame\n", "a\nsame\n"), { ok: true, text: "a\nsame\n" });
});
