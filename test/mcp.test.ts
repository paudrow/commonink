import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { tempVault } from "./helpers.ts";

const BIN = path.resolve(import.meta.dirname, "../bin/quire");
let vault: string;
let client: Client;

before(async () => {
  vault = tempVault();
  const env = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined && e[0] !== "QUIRE_AGENT"));
  client = new Client({ name: "test-agent", version: "1.0.0" });
  await client.connect(new StdioClientTransport({ command: BIN, args: ["mcp"], env: { ...env, QUIRE_VAULT: vault } }));
});

after(() => client.close());

async function call(name: string, args: Record<string, unknown>) {
  const r = (await client.callTool({ name, arguments: args })) as { content: Array<{ text: string }>; isError?: boolean };
  return { text: r.content.map((c) => c.text).join("\n"), isError: !!r.isError };
}

test("the server lists every tool", async () => {
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), [
    "add_card", "append_to_note", "archive_note", "backlinks", "create_note", "edit_card", "edit_note", "list_notes", "list_tags", "list_tasks",
    "move_card", "move_note", "read_board", "read_note", "recent_changes", "search_notes", "star_note", "unarchive_note", "unstar_note", "update_task",
  ]);
});

test("agents list tasks with their tokens and change one without touching the rest of its line", async () => {
  await call("create_note", { path: "Chores", content: "# Chores\n\n- [ ] Water the plants\n" });
  const r = await call("update_task", { path: "Chores", line: 3, text: "Water the plants", due: "2026-10-01", priority: "high", assignees: ["sam"] });
  assert.match(r.text, /^Updated Chores\.md → version [0-9a-f]{12} \(\+1 −1\)$/);
  assert.equal((await call("list_tasks", { assignee: "sam" })).text, "- [ ] Water the plants !high due:2026-10-01 @sam — Chores.md:3");
  await call("update_task", { path: "Chores", line: 3, text: "Water the plants !high due:2026-10-01 @sam", priority: null, done: true });
  assert.match((await call("list_tasks", { status: "done", due: "2026-10-01" })).text, /^- \[x\] Water the plants due:2026-10-01 @sam done:\d{4}-\d{2}-\d{2} — Chores\.md:3$/);
  assert.equal((await call("update_task", { path: "Chores", line: 3, text: "stale", done: false })).isError, true);
});

test("agents read a board and add, move and edit its cards, each change attributed to them", async () => {
  await call("create_note", { path: "Launch", content: "# Launch\n\n:::kanban\n## Backlog\n- [ ] Pricing page\n\n## Done\n:::\n" });
  await call("add_card", { path: "Launch", column: "backlog", text: "Webhooks @sam\nRetry on 500s" });
  await call("move_card", { path: "Launch", card: "pricing", to_column: "Done" });
  assert.match((await call("edit_card", { path: "Launch", card: "5", text: "Webhooks @sam due:2026-10-01\nRetry on 500s" })).text, /^Edited a card in Launch\.md/);
  assert.match((await call("read_board", { path: "Launch" })).text, /^Board 1 of 1 in Launch\.md\n\n## Backlog\n- \[ \] Webhooks @sam due:2026-10-01 — L5\n    Retry on 500s\n\n## Done \(done column\)\n- \[x\] Pricing page done:\d{4}-\d{2}-\d{2} — L9$/);
  assert.match((await call("recent_changes", { path: "Launch.md", limit: 1 })).text, /test-agent: edit Launch\.md \(\+1 −1\)$/);
  assert.deepEqual(await call("move_card", { path: "Launch", card: "nope", to_column: "Done" }), { text: 'No card in Launch.md matches "nope"', isError: true });
});

test("agents list tags as a tree and filter notes by a tag and the tags under it", async () => {
  await call("create_note", { path: "Ideas/Plan B", content: "# Plan B\n\nA backup #plan/b for the importer.\n" });
  assert.equal((await call("list_tags", {})).text, "- #plan (2 notes)\n  - #plan/b (1 note)\n- #q3 (1 note)");
  assert.equal((await call("list_notes", { tag: "plan" })).text, "- Ideas/Plan B.md — Plan B\n- Projects/Roadmap.md — Roadmap");
  assert.equal((await call("search_notes", { query: "importer", tag: "plan/b" })).text, "- Ideas/Plan B.md — Plan B\n    L3: A backup #plan/b for the importer.");
});

test("writes are attributed to the connected client", async () => {
  assert.equal((await call("create_note", { path: "Agent log", content: "# Agent log\n" })).isError, false);
  assert.equal(fs.readFileSync(path.join(vault, "Agent log.md"), "utf8"), "# Agent log\n");
  const changes = await call("recent_changes", { path: "Agent log.md" });
  assert.match(changes.text, /^#\d+ \S+ test-agent: create Agent log\.md \(2 lines\)$/);
});

test("tool errors come back as isError with the core's message", async () => {
  assert.deepEqual(await call("read_note", { path: "../../etc/passwd" }), {
    text: 'No note matches "../../etc/passwd". Try search_notes to find it.',
    isError: true,
  });
  assert.deepEqual(await call("edit_note", { path: "Roadmap", old_string: "not in the note", new_string: "x" }), {
    text: "old_string not found in Projects/Roadmap.md. Re-read the note; it may have changed.",
    isError: true,
  });
  assert.deepEqual(await call("create_note", { path: "assets/chart.svg", content: "x" }), {
    text: "Only .md and .html notes can be created",
    isError: true,
  });
  assert.deepEqual(await call("move_note", { from: "Welcome", to: "Welcome.png" }), {
    text: "Moving Welcome.md can't change its file type from .md to .png",
    isError: true,
  });
});

test("search_notes sees files written straight to disk", async () => {
  fs.writeFileSync(path.join(vault, "Side door.md"), "# Side door\n\nzeppelin\n");
  assert.equal((await call("search_notes", { query: "zeppelin" })).text, "- Side door.md — Side door\n    L3: zeppelin");
});

test("agents star and unstar notes for the vault's person", async () => {
  assert.equal((await call("star_note", { paths: ["Roadmap", "Welcome"] })).text, "Favorites:\n- Projects/Roadmap.md — Roadmap\n- Welcome.md — Welcome");
  assert.equal((await call("unstar_note", { paths: ["Roadmap"] })).text, "Favorites:\n- Welcome.md — Welcome");
  assert.equal((await call("list_notes", { starred: true })).text, "Favorites:\n- Welcome.md — Welcome");
  assert.equal((await call("star_note", { paths: ["Nope"] })).isError, true);
});
