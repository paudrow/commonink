import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { agentSource, authorLabel, legacyActor, parseAuthorFilter } from "../src/core/actor.ts";
import { NodeDb } from "../src/core/local.ts";
import { migrate } from "../src/core/store.ts";
import { openTempVault } from "./helpers.ts";

test("an agent's change reads '<Agent> for <Person>', a person's as before", () => {
  assert.deepEqual(
    [
      authorLabel({ source: "Claude (via Audrow Nash)", person: "Audrow Nash", agent: "Claude" }),
      authorLabel({ source: "Claude Code (via you)", person: "you", agent: "Claude Code" }),
      authorLabel({ source: "Audrow Nash", person: "Audrow Nash", agent: null }),
      authorLabel({ source: "external", person: null, agent: null }),
      authorLabel({ source: "old", agent: null }),
    ],
    ["Claude for Audrow", "Claude Code for you", "Audrow Nash", "external", "old"],
  );
});

test("history filters read from text", () => {
  assert.deepEqual(["", "everyone", "people", "ai", "agents", "Claude Code", "agent:Cursor"].map(parseAuthorFilter), [
    undefined,
    undefined,
    "people",
    "agents",
    "agents",
    { agent: "Claude Code" },
    { agent: "Cursor" },
  ]);
});

test("changes from before actors were kept get theirs from the source text", () => {
  assert.deepEqual(
    [
      legacyActor("Claude (via Audrow)", false),
      legacyActor("Audrow Nash", false),
      legacyActor("Common Ink", false),
      legacyActor("you", true),
      legacyActor("cli", true),
      legacyActor("external", true),
      legacyActor("claude-code", true),
      legacyActor("mcp", true),
    ],
    [
      { agent: "Claude", person: "Audrow" },
      { person: "Audrow Nash", agent: null },
      { person: "Common Ink", agent: null },
      { person: "you", agent: null },
      { person: "you", agent: null },
      { person: null, agent: null },
      { person: "you", agent: "claude-code" },
      { person: "you", agent: "mcp" },
    ],
  );
});

test("upgrading a change log fills in who, once, for local vaults and workspaces alike", () => {
  for (const local of [true, false]) {
    const db = new NodeDb(new DatabaseSync(":memory:"));
    db.exec(`CREATE TABLE changes(id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, path TEXT NOT NULL, op TEXT NOT NULL,
      source TEXT NOT NULL, version TEXT, summary TEXT, from_path TEXT, before TEXT, note_id TEXT)`);
    for (const source of ["you", "claude-code", "Claude (via Sam)", "Sam Lee"]) db.run("INSERT INTO changes(ts, path, op, source) VALUES (1, 'a.md', 'edit', ?)", source);
    migrate(db, { local });
    migrate(db, { local }); // again: nothing changes
    assert.deepEqual(
      db.all("SELECT source, person, agent FROM changes ORDER BY id").map((r) => [r.source, r.person, r.agent]),
      local
        ? [["you", "you", null], ["claude-code", "you", "claude-code"], ["Claude (via Sam)", "Sam", "Claude"], ["Sam Lee", "you", "Sam Lee"]]
        : [["you", "you", null], ["claude-code", "claude-code", null], ["Claude (via Sam)", "Sam", "Claude"], ["Sam Lee", "Sam Lee", null]],
    );
  }
});

test("every write records who: people, agents for people, restores by whoever restored", () => {
  const { vault } = openTempVault();
  vault.create("Plan.md", "# Plan\n", "you");
  vault.append("Plan.md", "- one", agentSource("Claude Code", "you"));
  vault.append("Plan.md", "- two", agentSource("Cursor", "you"));
  const undo = vault.changes({ path: "Plan.md", limit: 1 })[0];
  vault.restore(undo.id, "you");
  const log = vault.changes({ path: "Plan.md" }).map((c) => [c.op, c.person, c.agent, c.source]);
  assert.deepEqual(log, [
    ["edit", "you", null, "you"],
    ["edit", "you", "Cursor", "Cursor (via you)"],
    ["edit", "you", "Claude Code", "Claude Code (via you)"],
    ["create", "you", null, "you"],
  ]);
  assert.deepEqual(vault.changes({ path: "Plan.md", by: "people" }).map((c) => c.op), ["edit", "create"]);
  assert.deepEqual(vault.changes({ path: "Plan.md", by: "agents" }).map((c) => c.agent), ["Cursor", "Claude Code"]);
  assert.deepEqual(vault.changes({ path: "Plan.md", by: { agent: "Cursor" } }).map((c) => c.agent), ["Cursor"]);
  assert.deepEqual(vault.agents(), ["Claude Code", "Cursor"]);
  const card = vault.feed({ q: "", limit: 30 }).items.find((i) => i.path === "Plan.md")!;
  assert.deepEqual(card.lastBy, { person: "you", agent: null });
});
