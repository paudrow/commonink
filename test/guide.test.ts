import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { asReplacement, DEMO_TEXT, FINISHED_TEXT, GUIDE_STEPS, guideNext, guideState } from "../src/core/guide.ts";
import { handleApi, type ApiHost } from "../src/core/api.ts";
import { openTempVault } from "./helpers.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const START = fs.readFileSync(path.join(ROOT, "examples/vault/Getting started.md"), "utf8");

const NOTE = `---
tags: [start]
---
# Getting started

- [ ] Type / <!-- guide:slash -->
- [ ] Search <!-- guide:search -->
- [x] Tick one <!-- guide:tick -->
- [ ] Watch <!-- guide:watch -->

  ::guide{step=watch}

::guide{step=done}

More in [[Tips]].
`;

test("both starter checklists have every step, the guide's cards, and the start tag", () => {
  for (const rel of ["examples/vault/Getting started.md", "cloud/seed/Getting started.md"]) {
    const text = fs.readFileSync(path.join(ROOT, rel), "utf8");
    assert.deepEqual(guideState(text), { open: [...GUIDE_STEPS], done: [], demo: false, finished: false }, rel);
    for (const card of ["watch", "connect", "done"]) assert.match(text, new RegExp(`^\\s*::guide\\{step=${card}\\}$`, "m"), `${rel} has the ${card} card`);
    assert.match(text, /^tags: \[start\]$/m, rel);
    assert.doesNotMatch(text, /Quire/, rel);
  }
});

test("a step ticks only its own box, found by its marker whatever the wording", () => {
  const reworded = NOTE.replace("Type / ", "Try the slash menu ");
  assert.deepEqual(asReplacement(reworded, guideNext(reworded, "slash")), {
    oldString: "- [ ] Try the slash menu <!-- guide:slash -->",
    newString: "- [x] Try the slash menu <!-- guide:slash -->",
  });
  assert.equal(guideNext(NOTE, "tick"), NOTE, "already ticked: nothing to do");
  assert.equal(guideNext(NOTE, "star"), NOTE, "a step the note doesn't have: nothing to do");
});

test("the demo goes under the watch card at its indent, once, and taking it back leaves the note as it was", () => {
  const demo = guideNext(NOTE, "demo");
  assert.ok(demo.includes(`  ::guide{step=watch}\n\n  ${DEMO_TEXT}\n\n::guide{step=done}`));
  assert.equal(guideState(demo)?.demo, true);
  assert.equal(guideNext(demo, "demo"), demo);
  assert.equal(demo.replace(`\n\n  ${DEMO_TEXT}`, ""), NOTE);
});

test("the last tick also adds the closing line above the done card, in the same edit", () => {
  let text = NOTE;
  for (const step of ["slash", "search"] as const) text = guideNext(text, step);
  assert.equal(guideState(text)?.finished, false);
  const last = guideNext(text, "watch");
  assert.deepEqual(guideState(last), { open: [], done: ["slash", "search", "tick", "watch"], demo: false, finished: true });
  assert.ok(last.includes(`${FINISHED_TEXT}\n\n::guide{step=done}`));
  const edit = asReplacement(text, last)!;
  assert.ok(edit.oldString.startsWith("- [ ] Watch <!-- guide:watch -->\n"));
  assert.equal(text.replace(edit.oldString, edit.newString), last);
  assert.equal(guideNext(last, "finish"), last, "closed once");
  // Ticked by hand, the checklist is closed by "finish".
  const byHand = text.replace("- [ ] Watch", "- [x] Watch");
  assert.equal(guideState(guideNext(byHand, "finish"))?.finished, true);
});

test("a note without the markers isn't a checklist, so the guide leaves it alone", () => {
  assert.equal(guideState("---\ntags: [start]\n---\n# Welcome\n\n- [ ] Click one\n"), null);
  assert.equal(guideState(START.replace(/<!-- guide:\w+ -->/g, "")), null);
});

test("a replacement is widened until its old text occurs once", () => {
  const before = "a\n- [ ] x\nb\n- [ ] x\nc";
  assert.deepEqual(asReplacement(before, "a\n- [ ] x\nb\n- [x] x\nc"), { oldString: "b\n- [ ] x", newString: "b\n- [x] x" });
  assert.deepEqual(asReplacement("a\nb", "a\nNEW\nb"), { oldString: "a", newString: "a\nNEW" });
  assert.equal(asReplacement("same", "same"), null);
});

function api(files: Record<string, string>, actor = "Audrow") {
  const { quire } = openTempVault(files);
  const written: string[] = [];
  const host: ApiHost = {
    quire,
    actor,
    user: actor,
    canEditShared: true,
    info: () => ({}),
    written: (rel, _c, _v, change) => written.push(`${rel} by ${change?.agent} for ${change?.person}`),
    moved: () => {},
    removed: () => {},
    tree: () => {},
  };
  const call = async (method: string, body?: unknown) => {
    const init: RequestInit = { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) };
    const res = await handleApi(host, new Request("http://localhost/api/guide", init), "/guide");
    return { status: res!.status, body: await res!.json() };
  };
  return { quire, written, call };
}

test("POST /guide ticks the start note as the Guide working for the person, through the change log", async () => {
  const { quire, written, call } = api({ "Getting started.md": START, "Other.md": "---\ntags: [start]\n---\n# Other\n" });
  assert.deepEqual((await call("GET")).body.open, [...GUIDE_STEPS]);
  const r = await call("POST", { action: "star" });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.done, ["star"]);
  assert.deepEqual(written, ["Getting started.md by Guide for Audrow"]);
  const [change] = quire.changes({ limit: 1 });
  assert.deepEqual([change.agent, change.person, change.summary], ["Guide", "Audrow", "+1 −1"]);
  assert.ok(quire.read("Getting started").content.includes("- [x] Star this note"));
  // Again: nothing to do, nothing written.
  await call("POST", { action: "star" });
  assert.equal(written.length, 1);
});

test("POST /guide takes only its own actions, and does nothing once the checklist is gone", async () => {
  const { quire, written, call } = api({ "Getting started.md": START });
  const bad = await call("POST", { action: "- [x] Anything I like" });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /"action" must be one of slash, link/);
  quire.save("Getting started.md", "# Getting started\n\nMine now.\n", { source: "Audrow" });
  assert.equal((await call("GET")).body, null);
  assert.equal((await call("POST", { action: "demo" })).body, null);
  assert.deepEqual(written, []);
  assert.equal(quire.read("Getting started").content, "# Getting started\n\nMine now.\n");
});
