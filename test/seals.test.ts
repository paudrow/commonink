import { test } from "node:test";
import assert from "node:assert/strict";
import { agentHandles, agentTaskCount, earnedSeals, keptAgentEdits, NO_STATS, SEALS, sealProgress, sealsFor, sealToast, type SealStats } from "../web/src/seals.ts";

const seal = (id: string) => SEALS.find((s) => s.id === id)!;

test("nothing counted earns nothing; each seal comes at its first", () => {
  assert.deepEqual(earnedSeals(NO_STATS), []);
  assert.deepEqual(earnedSeals({ ...NO_STATS, linked: true, smartFolders: 0, agentEdits: 3 }), ["link", "agent-edit"]);
  const all: SealStats = { linked: true, followedBacklink: true, usedTemplate: true, madeBoard: true, smartFolders: 2, shares: 1, agentTasks: 1, agentEdits: 10 };
  assert.deepEqual(earnedSeals(all), SEALS.map((s) => s.id));
});

test("sharing's seal is only where sharing is", () => {
  assert.equal(sealsFor(true).length, SEALS.length);
  assert.ok(!sealsFor(false).some((s) => s.id === "shared"));
  assert.equal(sealsFor(false).length, 8);
});

test("progress reads as a count only toward ten agent edits", () => {
  assert.equal(sealProgress(seal("agent-ten"), { ...NO_STATS, agentEdits: 3 }), "3 of 10");
  assert.equal(sealProgress(seal("agent-ten"), { ...NO_STATS, agentEdits: 12 }), null);
  assert.equal(sealProgress(seal("agent-edit"), { ...NO_STATS, agentEdits: 0 }), null, "a first");
  assert.equal(sealProgress(seal("agent-ten"), null), null, "not counted yet");
});

test("an agent's edit counts unless the note was restored after it; the guide's never count", () => {
  const c = (ts: number, path: string, op: string, agent: string | null) => ({ ts, path, op, agent });
  const log = [c(5, "b.md", "restore", null), c(4, "b.md", "edit", "Claude"), c(3, "a.md", "edit", "Claude"), c(2, "a.md", "create", "Guide"), c(0, "b.md", "edit", "Claude"), c(0, "c.md", "move", "Claude")];
  assert.equal(keptAgentEdits(log), 1, "a.md's edit; both of b.md's were taken back");
  assert.equal(keptAgentEdits([c(2, "x.md", "edit", "Claude"), c(1, "x.md", "restore", null)]), 1, "restored before, kept after");
  assert.equal(keptAgentEdits([]), 0);
});

test("a task is an agent's when it's assigned to one by name", () => {
  const h = agentHandles(["Claude Code", "Guide", "Codex"]);
  assert.ok(h.has("claude-code") && h.has("claude") && h.has("codex") && h.has("agent"));
  assert.ok(!h.has("guide"));
  const t = (...assignees: string[]) => ({ meta: { assignees } });
  assert.equal(agentTaskCount([t("Jane"), t("Claude"), t("@codex"), t()], h), 2);
});

test("one seal gets its own toast; several at once, one that names them all", () => {
  assert.deepEqual(sealToast(["board"]), { text: "New seal: First board", detail: "You made a kanban board." });
  assert.deepEqual(sealToast(["link", "template", "agent-edit"]), { text: "New seals: First link, First template and First agent edit", detail: "They're on the Today page." });
  assert.equal(sealToast([]), null);
});
