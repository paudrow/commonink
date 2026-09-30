// Marked versions for agents: the CLI (quire mark, marks, diff, restore --to) and the MCP tools.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { tempVault } from "./helpers.ts";

const BIN = path.resolve(import.meta.dirname, "../bin/quire");
const VAULT = { "Spec.md": "# Spec\n\nVersion one.\n" };

function quire(vault: string, args: string[]) {
  const env: NodeJS.ProcessEnv = { ...process.env, QUIRE_VAULT: vault };
  delete env.QUIRE_AGENT;
  const r = spawnSync(BIN, args, { env, encoding: "utf8" });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

test("quire mark, marks, diff, restore --to, mark-rename and mark-rm", () => {
  const vault = tempVault(VAULT);
  assert.match(quire(vault, ["mark", "Spec", "v1", "--description", "As agreed"]).stdout, /^Marked Spec\.md as "v1" \[[a-z2-9]{8}\]\n$/);
  quire(vault, ["edit", "Spec", "--old", "Version one.", "--new", "Version two.", "--as", "Writer"]);
  const list = quire(vault, ["marks", "Spec"]).stdout;
  assert.match(list, /^- "v1" \[[a-z2-9]{8}\] Spec\.md, marked \S+ by you\n    As agreed\n$/);
  assert.equal(quire(vault, ["diff", "Spec", "--from", "v1"]).stdout, '--- Spec.md (v1)\n+++ Spec.md (now)\n@@ -1,3 +1,3 @@\n # Spec\n \n-Version one.\n+Version two.\n');
  assert.match(quire(vault, ["restore", "Spec", "--to", "v1"]).stdout, /^Restored to "v1": Spec\.md → version [0-9a-f]{12} \(\+1 −1\)\n$/);
  assert.equal(fs.readFileSync(path.join(vault, "Spec.md"), "utf8"), VAULT["Spec.md"]);
  assert.match(quire(vault, ["mark-rename", "v1", "Agreed v1", "--note", "Spec"]).stdout, /^Renamed the mark to "Agreed v1"/);
  assert.match(quire(vault, ["mark-rm", "Agreed v1", "--note", "Spec"]).stdout, /^Deleted the mark "Agreed v1" from Spec\.md; the note is as it was\n$/);
  assert.equal(quire(vault, ["marks"]).stdout, "No marked versions yet.\n");
  const bad = quire(vault, ["diff", "Spec", "--from", "nope"]);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /No marked version "nope" on Spec/);
});

let client: Client;
let vault: string;
before(async () => {
  vault = tempVault(VAULT);
  const env = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined && e[0] !== "QUIRE_AGENT"));
  client = new Client({ name: "test-agent", version: "1.0.0" });
  await client.connect(new StdioClientTransport({ command: BIN, args: ["mcp"], env: { ...env, QUIRE_VAULT: vault } }));
});
after(() => client?.close());

async function call(name: string, args: Record<string, unknown>) {
  const r = (await client.callTool({ name, arguments: args })) as { content: Array<{ text: string }>; isError?: boolean };
  return { text: r.content.map((c) => c.text).join("\n"), isError: !!r.isError };
}

test("an agent marks a version before a rewrite, compares, and restores it", async () => {
  assert.match((await call("mark_version", { path: "Spec", name: "Before the rewrite" })).text, /^Marked Spec\.md as "Before the rewrite" \[[a-z2-9]{8}\]\.$/);
  await call("edit_note", { path: "Spec", old_string: "Version one.", new_string: "Rewritten." });
  assert.match((await call("list_marks", { path: "Spec" })).text, /^- "Before the rewrite" \[[a-z2-9]{8}\] Spec\.md, marked \S+ by test-agent for you$/);
  assert.match((await call("diff_versions", { from: "Before the rewrite", path: "Spec" })).text, /-Version one\.\n\+Rewritten\.$/);
  assert.match((await call("restore_mark", { mark: "Before the rewrite", path: "Spec" })).text, /^Restored to "Before the rewrite": Spec\.md → version/);
  assert.equal(fs.readFileSync(path.join(vault, "Spec.md"), "utf8"), VAULT["Spec.md"]);
  assert.equal((await call("restore_mark", { mark: "Before the rewrite", path: "Spec" })).text, 'Spec.md is already at "Before the rewrite".');
  const dupe = await call("mark_version", { path: "Spec", name: "before the rewrite" });
  assert.deepEqual(dupe, { text: 'Spec.md already has a version marked "before the rewrite"', isError: true });
});
