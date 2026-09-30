import { test } from "node:test";
import assert from "node:assert/strict";
import { applyDelta, makeDelta } from "../src/core/delta.ts";
import { random } from "./helpers.ts";

test("a delta rebuilds its target exactly, for any pair of texts", () => {
  for (let seed = 1; seed <= 400; seed++) {
    const r = random(seed);
    const base = r.text(r.int(80));
    const target = r.int(4) ? r.edit(base) : r.text(r.int(80));
    assert.equal(applyDelta(base, makeDelta(base, target)), target, `seed ${seed}`);
  }
});

test("a small edit to a long note is a small delta", () => {
  const long = "Some line of a long document that keeps going.\n".repeat(2000);
  const edited = long.replace("going.\n", "going, and on.\n") + "typed 1\n";
  const delta = makeDelta(edited, long);
  assert.ok(delta.length < 100, `${delta.length} bytes`);
  assert.equal(applyDelta(edited, delta), long);
});
