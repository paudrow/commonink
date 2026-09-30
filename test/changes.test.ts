import { test } from "node:test";
import assert from "node:assert/strict";
import { changeVerb, groupChanges } from "../src/core/format.ts";
import { handleApi, type ApiHost } from "../src/core/api.ts";
import { agentSource } from "../src/core/actor.ts";
import { openVault } from "../src/core/local.ts";
import { openTempVault } from "./helpers.ts";

test("a run of autosaves counts its net change, the same as the diff of that run", () => {
  const { quire } = openTempVault();
  quire.create("Churn.md", "# Churn\n\none\ntwo\n", "you");
  quire.save("Churn.md", "# Churn\n\none\ntwo\nthree\nfour\nfive\nsix\n", { source: "you" });
  quire.save("Churn.md", "# Churn\n\nONE\ntwo\nthree\n", { source: "you" });
  quire.save("Churn.md", "# Churn\n\nONE\ntwo\nthree\nfour\n", { source: "you" });
  const [saves, created] = groupChanges(quire.changes({ path: "Churn.md" }));
  assert.deepEqual([saves.count, saves.summary, created.op], [3, "+6 −4", "create"]);
  const ids = [saves.first, saves.first + 1, saves.id];
  assert.deepEqual(quire.diffSet(ids)[0].runs.map((r) => r.stat), [{ add: 3, del: 1 }]);
  assert.deepEqual(quire.diffStats([ids, [created.id], [saves.id], [999]]), [{ add: 3, del: 1 }, { add: 4, del: 0 }, { add: 1, del: 0 }, null]);
});

test("a move within its folder reads as a rename; to another folder, as a move", () => {
  const verb = (from_path: string, path: string) => changeVerb({ op: "move", from_path, path });
  assert.deepEqual(
    [verb("Untitled.md", "Groceries.md"), verb("Projects/Untitled.md", "Projects/Launch.md"), verb("Untitled.md", "Projects/Untitled.md"), verb("Ideas/Plan.md", "Projects/Plan.md")],
    ["renamed", "renamed", "moved", "moved"],
  );
  assert.equal(changeVerb({ op: "archive", from_path: "Plan.md", path: "Archive/Plan.md" }), "archived");
  assert.equal(changeVerb({ op: "edit", from_path: null, path: "Plan.md" }), "edited");
});

/** A vault on a fake clock, and the editor's autosave (PUT /note) as a person or an agent. */
function editor() {
  let now = Date.UTC(2026, 8, 30, 9);
  const vault = openTempVault({ "Plan.md": "# Plan\n", "Other.md": "# Other\n" }, { now: () => now });
  const save = async (path: string, content: string, actor = "ana") => {
    const host: ApiHost = { quire: vault.quire, actor, user: "ana", canEditShared: true, info: () => ({}), written() {}, moved() {}, removed() {}, tree() {} };
    const req = new Request("http://localhost/api/note", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path, content }) });
    const res = await handleApi(host, req, "/note");
    assert.equal(res!.status, 200);
  };
  const wait = (ms: number) => (now += ms);
  const log = (path = "Plan.md") => vault.quire.changes({ path }).map((c) => `${c.op} ${c.source} ${c.summary}`);
  return { quire: vault.quire, save, wait, log };
}

test("a person's autosaves to one note in one sitting are one change, from the text before the first", async () => {
  const { quire, save, wait, log } = editor();
  for (const text of ["# Plan\n\none\n", "# Plan\n\none\ntwo\n", "# Plan\n\nONE\ntwo\n"]) {
    wait(4 * 60_000);
    await save("Plan.md", text);
  }
  assert.deepEqual(log(), ["edit ana +3 −0"]);
  const [burst] = quire.changes({ path: "Plan.md" });
  assert.deepEqual(quire.diff(burst.id, burst.id), { path: "Plan.md", op: "edit", before: "# Plan\n", after: "# Plan\n\nONE\ntwo\n" });
  quire.restore(burst.id, "ana");
  assert.equal(quire.read("Plan.md").content, "# Plan\n");
});

test("a pause, another note, or someone else's change starts a new change", async () => {
  const { quire, save, wait, log } = editor();
  await save("Plan.md", "# Plan\n\na\n");
  wait(5 * 60_000 + 1);
  await save("Plan.md", "# Plan\n\na\nb\n");
  await save("Other.md", "# Other\n\nx\n");
  await save("Plan.md", "# Plan\n\na\nb\nc\n");
  quire.append("Plan.md", "from Claude", agentSource("Claude", "ana"));
  await save("Plan.md", "# Plan\n\na\nb\nc\n\nfrom Claude\nd\n");
  await save("Plan.md", "# Plan\n\na\nb\nc\n\nfrom Claude\nd\ne\n", "bo");
  assert.deepEqual(log(), ["edit bo +1 −0", "edit ana +1 −0", "edit Claude (via ana) +2 −0", "edit ana +1 −0", "edit ana +1 −0", "edit ana +2 −0"]);
  const agent = quire.changes({ path: "Plan.md" })[2];
  assert.deepEqual(quire.diff(agent.id, agent.id), { path: "Plan.md", op: "edit", before: "# Plan\n\na\nb\nc\n", after: "# Plan\n\na\nb\nc\n\nfrom Claude\n" });
});

test("a change that continues a sitting comes back under a new id, so catching up by id sees it", async () => {
  const { quire, save } = editor();
  await save("Plan.md", "# Plan\n\none\n");
  const seen = quire.changes({ limit: 1 })[0].id;
  await save("Plan.md", "# Plan\n\none\ntwo\n");
  assert.deepEqual(quire.changes({ since: seen }).map((c) => `${c.op} ${c.path} ${c.summary}`), ["edit Plan.md +3 −0"]);
  assert.deepEqual(quire.changes({ path: "Plan.md" }).length, 1);
});

test("an autosave after a History restore or a tag rename is a change of its own, so their Undo still works", async () => {
  const { quire, save, log } = editor();
  await save("Plan.md", "# Plan\n\none #old\n");
  const typed = quire.changes({ limit: 1 })[0];
  const restored = quire.restore(typed.id, "ana");
  await save("Plan.md", "# Plan\n\nagain #old\n");
  const renamed = quire.renameTag("old", "new", "ana");
  await save("Plan.md", "# Plan\n\nagain #new, more\n");
  assert.deepEqual(log(), ["edit ana +1 −1", "edit ana +1 −1", "edit ana +2 −0", "edit ana +0 −2", "edit ana +2 −0"]);
  quire.restore(renamed.edits[0].change.id, "ana");
  assert.equal(quire.read("Plan.md").content, "# Plan\n\nagain #old\n");
  assert.ok(restored.change);
});

test("a change log from before sittings opens, keeps its changes, and new autosaves join into sittings", () => {
  const { dir, quire } = openTempVault({ "Plan.md": "# Plan\n" });
  quire.save("Plan.md", "# Plan\n\nold\n", { source: "ana" });
  quire.db.exec("ALTER TABLE changes DROP COLUMN autosave");

  const reopened = openVault(dir);
  reopened.save("Plan.md", "# Plan\n\nold\nnew\n", { source: "ana", autosave: true });
  reopened.save("Plan.md", "# Plan\n\nold\nnew\nnewer\n", { source: "ana", autosave: true });
  assert.deepEqual(reopened.changes({ path: "Plan.md" }).map((c) => c.summary), ["+2 −0", "+2 −0"]);
});
