import { test } from "node:test";
import assert from "node:assert/strict";
import { openTempVault } from "./helpers.ts";

const WELCOME = "---\ntags: [start]\n---\n# Welcome\n\nRead me first.\n";

function seededVault() {
  let now = 1_000;
  const { vault } = openTempVault({}, { now: () => now++ });
  vault.create("Welcome.md", WELCOME, "Common Ink");
  vault.create("AGENTS.md", "# Vault conventions\n\nYou are a guest editor.\n", "Common Ink");
  vault.create("Plan.md", "# Plan\n", "you");
  vault.create("Ideas.md", "# Ideas\n", "you");
  return vault;
}

test("Notes starts with the note tagged start and puts the agents' instructions after your own notes", () => {
  const vault = seededVault();
  assert.deepEqual(
    vault.feed().items.map((i) => [i.path, i.role]),
    [
      ["Welcome.md", "start"],
      ["Ideas.md", null],
      ["Plan.md", null],
      ["AGENTS.md", "agents"],
    ],
  );
  assert.deepEqual(
    vault.feed({ sort: "title" }).items.map((i) => i.path),
    ["Ideas.md", "Plan.md", "AGENTS.md", "Welcome.md"],
  );
  assert.deepEqual(
    vault.feed({ q: "guest" }).items.map((i) => [i.path, i.role]),
    [["AGENTS.md", "agents"]],
  );
});

test("a start note drops back into date order once it loses the tag or is archived", () => {
  const vault = seededVault();
  vault.save("Welcome.md", "# Welcome\n\nRead me first.\n", { source: "you" });
  vault.save("Plan.md", "# Plan\n\nNext.\n", { source: "you" });
  assert.deepEqual(
    vault.feed().items.map((i) => [i.path, i.role]),
    [
      ["Plan.md", null],
      ["Welcome.md", null],
      ["Ideas.md", null],
      ["AGENTS.md", "agents"],
    ],
  );

  const fresh = seededVault();
  fresh.archive("Welcome.md", "you");
  assert.deepEqual(
    fresh.feed().items.map((i) => i.path),
    ["Ideas.md", "Plan.md", "AGENTS.md"],
  );
  assert.deepEqual(
    fresh.feed({ scope: "archived" }).items.map((i) => [i.path, i.role]),
    [["Archive/Welcome.md", null]],
  );
});
