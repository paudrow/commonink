import { test } from "node:test";
import assert from "node:assert/strict";
import { openTempVault } from "./helpers.ts";

const WELCOME = "---\ntags: [start]\n---\n# Welcome\n\nRead me first.\n";

function vault() {
  let now = 1_000;
  const { quire } = openTempVault({}, { now: () => now++ });
  quire.create("Welcome.md", WELCOME, "Common Ink");
  quire.create("AGENTS.md", "# Vault conventions\n\nYou are a guest editor.\n", "Common Ink");
  quire.create("Plan.md", "# Plan\n", "you");
  quire.create("Ideas.md", "# Ideas\n", "you");
  return quire;
}

test("Notes starts with the note tagged start and puts the agents' instructions after your own notes", () => {
  const quire = vault();
  assert.deepEqual(
    quire.feed().items.map((i) => [i.path, i.role]),
    [
      ["Welcome.md", "start"],
      ["Ideas.md", null],
      ["Plan.md", null],
      ["AGENTS.md", "agents"],
    ],
  );
  assert.deepEqual(
    quire.feed({ sort: "title" }).items.map((i) => i.path),
    ["Ideas.md", "Plan.md", "AGENTS.md", "Welcome.md"],
  );
  assert.deepEqual(
    quire.feed({ q: "guest" }).items.map((i) => [i.path, i.role]),
    [["AGENTS.md", "agents"]],
  );
});

test("a start note drops back into date order once it loses the tag or is archived", () => {
  const quire = vault();
  quire.save("Welcome.md", "# Welcome\n\nRead me first.\n", { source: "you" });
  quire.save("Plan.md", "# Plan\n\nNext.\n", { source: "you" });
  assert.deepEqual(
    quire.feed().items.map((i) => [i.path, i.role]),
    [
      ["Plan.md", null],
      ["Welcome.md", null],
      ["Ideas.md", null],
      ["AGENTS.md", "agents"],
    ],
  );

  const fresh = vault();
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
