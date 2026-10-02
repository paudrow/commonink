import { test } from "node:test";
import assert from "node:assert/strict";
import { awayLine, taskChanges, type AwaySummary } from "../src/core/away.ts";
import { agentSource } from "../src/core/actor.ts";
import { handleApi, type ApiHost } from "../src/core/api.ts";
import { openTempVault } from "./helpers.ts";

test("tasks added and ticked between two texts; a moved task counts for nothing", () => {
  assert.deepEqual(taskChanges(null, "- [ ] One\n- [x] Two\n"), { added: 2, done: 0 });
  assert.deepEqual(taskChanges("- [ ] One\n- [ ] Two\n", "- [ ] Two\n- [x] One\n- [ ] Three due:2026-10-01\n"), { added: 1, done: 1 });
  assert.deepEqual(taskChanges("- [ ] One due:2026-10-01\n", "Text\n\n- [ ] One due:2026-10-09\n"), { added: 0, done: 0 });
  assert.deepEqual(taskChanges("- [x] Done\n", "- [ ] Done\n"), { added: 0, done: 0 });
});

const summary = (s: Partial<AwaySummary>): AwaySummary => ({ agents: ["Claude"], created: 0, edited: 0, tasksAdded: 0, tasksDone: 0, after: 0, last: 1, from: 0, to: 0, ...s });

test("the line names the agents and what they did", () => {
  assert.equal(awayLine(summary({ edited: 4, tasksAdded: 6 })), "Claude edited 4 notes and added 6 tasks while you were away");
  assert.equal(awayLine(summary({ created: 1, edited: 2 })), "Claude created 1 note and changed 2 other notes while you were away");
  assert.equal(awayLine(summary({ agents: ["Claude", "Codex"], tasksDone: 1 })), "Claude and Codex checked off 1 task while you were away");
  assert.equal(awayLine(summary({ agents: ["A", "B", "C"], edited: 1, tasksAdded: 1, tasksDone: 2 })), "A, B and 1 more agent edited 1 note, added 1 task and checked off 2 tasks while you were away");
});

test("the summary counts agents' changes since your own last change, and after a dismissed one", async () => {
  const { vault } = openTempVault({ "Plan.md": "# Plan\n\n- [ ] Old\n", "Other.md": "# Other\n" });
  const claude = agentSource("Claude", "you");
  vault.save("Plan.md", "# Plan\n\n- [ ] Old\n- [ ] Early\n", { source: claude });
  assert.equal(vault.awaySummary("you")?.tasksAdded, 1, "before any change of yours, everything agents did counts");
  vault.save("Other.md", "# Other\n\nmine\n", { source: "you" });
  assert.equal(vault.awaySummary("you"), null);

  vault.save("Plan.md", "# Plan\n\n- [x] Old\n- [ ] Early\n- [ ] New one\n- [ ] New two\n", { source: claude });
  vault.create("Fresh.md", "# Fresh\n\n- [ ] Three\n", agentSource("Codex", "you"));
  vault.save("Other.md", "# Other\n\nmine\n\nfrom Claude\n", { source: claude });
  const s = vault.awaySummary("you")!;
  assert.deepEqual([s.agents, s.created, s.edited, s.tasksAdded, s.tasksDone], [["Claude", "Codex"], 1, 2, 3, 1]);
  assert.equal(awayLine(s), "Claude and Codex created 1 note, changed 2 other notes, added 3 tasks and checked off 1 task while you were away");

  // Dismissed up to the last change: nothing until an agent does more.
  assert.equal(vault.awaySummary("you", s.last), null);
  const host: ApiHost = { vault, actor: "you", user: "you", canEditShared: true, info: () => ({}), written() {}, moved() {}, removed() {}, tree() {} };
  const get = async (route: string) => (await handleApi(host, new Request(`http://localhost/api${route}`), route.split("?")[0]))!.json();
  assert.equal((await get(`/changes/away?after=${s.after}`)).last, s.last);
  assert.equal(await get(`/changes/away?after=${s.last}`), null);
  // History's "since" span: only changes after that id.
  const since = (await get(`/changes?by=ai&after=${s.after}`)) as Array<{ id: number }>;
  assert.equal(since.length, 3);
});
