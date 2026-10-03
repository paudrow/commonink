// The app runs the core's import in the browser, where Vite has no node:path ("Couldn't import:
// Cannot read properties of undefined (reading 'basename')"). So nothing the app's import reaches may
// import a node: module, and core/posix.ts must do what path.posix does.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import * as posix from "../src/core/posix.ts";

const ROOT = path.resolve(import.meta.dirname, "..");

/** Every module `entry` loads at run time (type-only imports left out), as absolute paths. */
function graph(entry: string, seen = new Set<string>()): Set<string> {
  if (seen.has(entry)) return seen;
  seen.add(entry);
  const src = fs.readFileSync(entry, "utf8");
  for (const m of src.matchAll(/^\s*(import|export)\s+(type\s+)?[^;]*?\sfrom\s+"([^"]+)"/gm)) {
    if (m[2]) continue;
    const spec = m[3];
    if (spec.startsWith(".")) graph(path.resolve(path.dirname(entry), spec), seen);
    else seen.add(spec);
  }
  return seen;
}

test("the app's import (and every module it loads) uses no node: module", () => {
  for (const entry of ["web/src/importNotes.ts", "src/core/import.ts", "src/core/convert.ts"]) {
    const nodeOnly = [...graph(path.join(ROOT, entry))].filter((m) => m.startsWith("node:"));
    assert.deepEqual(nodeOnly, [], `${entry} reaches ${nodeOnly.join(", ")}`);
  }
});

test("core/posix matches path.posix", () => {
  const paths = ["", ".", "..", "/", "a", "a/", "a//b", "/a/b/", "a/./b/../c", "../a", "a/../..", "x.md", ".bashrc", "a.", "a.b.c", "Notion/Page 1a2b.md", "dir.v2/file", "a/b/c.png", "/..", "a/b/../../.."];
  for (const p of paths) {
    for (const fn of ["basename", "dirname", "extname", "normalize", "isAbsolute"] as const) {
      assert.equal(posix[fn](p), path.posix[fn](p), `${fn}(${JSON.stringify(p)})`);
    }
  }
  const pairs: Array<[string, string]> = [["a/b", "a/c/d.png"], ["a", "a"], ["", "x/y"], ["x/y", ""], ["Garden/Plants", "Garden/sketch.png"], ["a/b/c", "d"], ["Home projects", "Home projects/Shed.png"]];
  for (const [a, b] of pairs) {
    assert.equal(posix.relative(a, b), path.posix.relative(a, b), `relative(${a}, ${b})`);
    assert.equal(posix.join(a, b), path.posix.join(a, b), `join(${a}, ${b})`);
  }
  assert.equal(posix.join("a", "", "../b"), path.posix.join("a", "", "../b"));
  assert.equal(posix.join(), path.posix.join());
});
