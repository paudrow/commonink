// Regression tests for the security audit: hostile note text, paths and inputs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { openVault } from "../src/core/local.ts";
import { openTempVault } from "./helpers.ts";

test("a link that isn't valid percent-encoding can't take the vault down", () => {
  const { dir, quire } = openTempVault();
  quire.create("Progress.md", "# Progress\n\n[done](100%) and [x](%zz) and [[Welcome]]\n", "you");
  assert.deepEqual(quire.backlinks("Welcome.md").map((b) => b.path), ["Progress.md"]);
  quire.move("Welcome.md", "Hello.md", "you");
  assert.equal(quire.read("Progress.md").content, "# Progress\n\n[done](100%) and [x](%zz) and [[Hello]]\n");
  assert.equal(quire.resolve("/notes/progress-%zz"), null);
  const again = openVault(dir); // the index is rebuilt from disk on open
  assert.equal(again.read("Progress").path, "Progress.md");
});
