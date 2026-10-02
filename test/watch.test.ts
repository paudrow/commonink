import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { watchTree } from "../src/server/watch.ts";
import { tempVault } from "./helpers.ts";

const root = process.getuid?.() === 0;
const nativeHere = process.platform === "darwin" || process.platform === "win32";

/** Seen paths, and a wait for one to show up. */
function recorder() {
  const seen = new Set<string>();
  const waiters: Array<[string, () => void]> = [];
  return {
    onChange(rel: string) {
      seen.add(rel);
      for (const [want, done] of waiters) if (want === rel) done();
    },
    until(rel: string) {
      if (seen.has(rel)) return Promise.resolve(true);
      return Promise.race([new Promise<boolean>((r) => waiters.push([rel, () => r(true)])), new Promise<boolean>((r) => setTimeout(() => r(false), 3000))]);
    },
  };
}

for (const native of nativeHere ? [false, true] : [false]) {
  const how = native ? "the native watch" : "a watch on each folder";
  test(`with ${how}, files the server can't read neither stop the watch nor hide changes to others`, { skip: root && "root reads any file" }, async () => {
    const dir = tempVault({ "Notes/A.md": "# A\n", "assets/early.png": "x" });
    fs.chmodSync(path.join(dir, "assets/early.png"), 0o000);
    const r = recorder();
    const w = watchTree(dir, (rel) => r.onChange(rel), native);
    try {
      const late = path.join(dir, "assets/late.png");
      fs.writeFileSync(late, "x");
      fs.chmodSync(late, 0o000);
      await new Promise((ok) => setTimeout(ok, 100));
      fs.writeFileSync(path.join(dir, "Notes/A.md"), "# A\n\nchanged\n");
      assert.equal(await r.until("Notes/A.md"), true, "a change to a note after that is still seen");
      fs.mkdirSync(path.join(dir, "Notes/Deeper"));
      await new Promise((ok) => setTimeout(ok, 100));
      fs.writeFileSync(path.join(dir, "Notes/Deeper/B.md"), "# B\n");
      assert.equal(await r.until("Notes/Deeper/B.md"), true, "and in a folder made after it started");
    } finally {
      w.close();
      for (const f of ["assets/early.png", "assets/late.png"]) fs.chmodSync(path.join(dir, f), 0o644);
    }
  });
}

test("with a watch on each folder, a folder deleted and made again at once is still watched", async () => {
  const dir = tempVault({ "Notes/A.md": "# A\n" });
  const r = recorder();
  const w = watchTree(dir, (rel) => r.onChange(rel), false);
  try {
    await new Promise((ok) => setTimeout(ok, 100));
    fs.rmSync(path.join(dir, "Notes"), { recursive: true });
    fs.mkdirSync(path.join(dir, "Notes"));
    await new Promise((ok) => setTimeout(ok, 200));
    fs.writeFileSync(path.join(dir, "Notes/B.md"), "# B\n");
    assert.equal(await r.until("Notes/B.md"), true, "a note written into the new folder is seen");
    fs.mkdirSync(path.join(dir, "Notes.new"));
    fs.rmSync(path.join(dir, "Notes"), { recursive: true });
    fs.renameSync(path.join(dir, "Notes.new"), path.join(dir, "Notes"));
    await new Promise((ok) => setTimeout(ok, 200));
    fs.writeFileSync(path.join(dir, "Notes/C.md"), "# C\n");
    assert.equal(await r.until("Notes/C.md"), true, "and in a folder swapped in under the same name");
  } finally {
    w.close();
  }
});
