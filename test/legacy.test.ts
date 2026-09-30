// What people set up while Common Ink was called Quire keeps working: the QUIRE_* env vars, a
// vault's .quire/ folder, ~/.config/quire, the `quire` command, this browser's quire.* settings and
// quire: links. Each moves to its new name without losing anything.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { configFolder, dataFolder, readLegacyEnv } from "../src/legacy.ts";
import { openVault } from "../src/core/local.ts";
import { cleanPath } from "../src/core/paths.ts";
import { NOTE_LINKS, noteTarget } from "../web/src/noteLinks.ts";
import { tempVault } from "./helpers.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const said = () => {
  const lines: string[] = [];
  return { lines, say: (l: string) => void lines.push(l) };
};

test("QUIRE_* env vars set their COMMONINK_* names, which win when both are set, with a notice", () => {
  const env: NodeJS.ProcessEnv = { QUIRE_VAULT: "/old", QUIRE_AGENT: "Claude", COMMONINK_AGENT: "Cursor", PATH: "/bin" };
  const { lines, say } = said();
  readLegacyEnv(env, say);
  assert.equal(env.COMMONINK_VAULT, "/old");
  assert.equal(env.COMMONINK_AGENT, "Cursor");
  assert.deepEqual(lines, ["QUIRE_VAULT is now COMMONINK_VAULT. QUIRE_VAULT still works, for now.", "QUIRE_AGENT is now COMMONINK_AGENT. QUIRE_AGENT still works, for now."]);
});

test("a vault's .quire folder moves to .commonink on first open, with its note IDs, stars and change log", () => {
  const dir = tempVault();
  const before = openVault(dir);
  before.create("Inbox", "# Inbox\n", "you");
  before.star("you", "Inbox.md");
  const id = before.meta("Inbox.md")!.id;
  const changes = before.changes({ limit: 50 }).length;
  // As a vault from before the rename has it.
  fs.renameSync(path.join(dir, ".commonink"), path.join(dir, ".quire"));
  const after = openVault(dir);
  assert.ok(!fs.existsSync(path.join(dir, ".quire")));
  assert.ok(fs.existsSync(path.join(dir, ".commonink", "index.db")));
  assert.equal(after.meta("Inbox.md")!.id, id);
  assert.deepEqual(after.favorites("you").map((f) => ("path" in f ? f.path : f.tag)), ["Inbox.md"]);
  assert.equal(after.changes({ limit: 50 }).length, changes);
});

test("with both folders, the new one is used and the legacy one is left as it was", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "commonink-both-"));
  fs.mkdirSync(path.join(dir, ".quire"));
  fs.writeFileSync(path.join(dir, ".quire", "index.db"), "old");
  fs.mkdirSync(path.join(dir, ".commonink"));
  const { lines, say } = said();
  assert.equal(dataFolder(dir, say), path.join(dir, ".commonink"));
  assert.equal(fs.readFileSync(path.join(dir, ".quire", "index.db"), "utf8"), "old");
  assert.match(lines[0], /^Both \S+\.quire \(from before Common Ink's rename\) and \S+\.commonink are here: using \S+\.commonink, and leaving \S+\.quire as it was\.$/);
  // Neither: the new one, made by whoever uses it.
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "commonink-none-"));
  assert.equal(dataFolder(empty, say), path.join(empty, ".commonink"));
  assert.ok(!fs.existsSync(path.join(empty, ".commonink")));
});

test("the CLI's settings move from ~/.config/quire to ~/.config/commonink, readable only by you as before", () => {
  const xdg = fs.mkdtempSync(path.join(os.tmpdir(), "commonink-xdg-"));
  fs.mkdirSync(path.join(xdg, "quire"), { mode: 0o700 });
  fs.writeFileSync(path.join(xdg, "quire", "credentials.json"), '{"server":"x"}', { mode: 0o600 });
  const dir = configFolder({ XDG_CONFIG_HOME: xdg }, () => {});
  assert.equal(dir, path.join(xdg, "commonink"));
  assert.equal(fs.readFileSync(path.join(dir, "credentials.json"), "utf8"), '{"server":"x"}');
  assert.equal(fs.statSync(path.join(dir, "credentials.json")).mode & 0o777, 0o600);
  assert.ok(!fs.existsSync(path.join(xdg, "quire")));
  assert.equal(configFolder({ COMMONINK_CONFIG_DIR: "/somewhere" }), "/somewhere");
});

test("both data folders stay hidden: no API path reaches them", () => {
  for (const p of [".commonink/index.db", ".quire/index.db"]) assert.throws(() => cleanPath(p), /Hidden paths/);
});

test("the quire command says it's now commonink, and runs it with QUIRE_VAULT", () => {
  const dir = tempVault();
  const env: NodeJS.ProcessEnv = { ...process.env, QUIRE_VAULT: dir };
  delete env.COMMONINK_VAULT;
  const r = spawnSync(path.join(ROOT, "bin/quire"), ["ls", "Projects"], { env, encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Projects\/Roadmap\.md/);
  assert.equal(r.stderr, "quire is now commonink: use bin/commonink (this still works, for now).\nQUIRE_VAULT is now COMMONINK_VAULT. QUIRE_VAULT still works, for now.\n");
});

test("an MCP entry that still runs `quire mcp` keeps working", async () => {
  const dir = tempVault();
  const env = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined && !e[0].startsWith("COMMONINK_")));
  const client = new Client({ name: "old-entry", version: "1.0.0" });
  await client.connect(new StdioClientTransport({ command: path.join(ROOT, "bin/quire"), args: ["mcp"], env: { ...env, QUIRE_VAULT: dir }, stderr: "ignore" }));
  try {
    assert.equal(client.getServerVersion()?.name, "commonink");
    const r = (await client.callTool({ name: "read_note", arguments: { path: "Welcome" } })) as { content: Array<{ text: string }> };
    assert.match(r.content[0].text, /# Welcome/);
  } finally {
    await client.close();
  }
});

test("this browser's quire.* settings move to commonink.* before the app reads them, once", () => {
  const html = fs.readFileSync(path.join(ROOT, "web/index.html"), "utf8");
  const script = html.match(/<script>([\s\S]*?)<\/script>/)![1];
  const store = new Map<string, string>([
    ["quire.theme", "dark"],
    ["quire.ws", "old-workspace"],
    ["commonink.ws", "new-workspace"],
    ["quire.w.timer-1", '{"left":60}'],
    ["quire.details:Notes/A.md", "{}"],
    ["other", "kept"],
  ]);
  const localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  };
  // Object.keys(localStorage) lists its keys in a browser.
  const proxy = new Proxy(localStorage, { ownKeys: () => [...store.keys()], getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }) });
  const document = { documentElement: { dataset: {} as Record<string, string> } };
  vm.runInNewContext(script, { localStorage: proxy, document });
  assert.deepEqual(Object.fromEntries(store), {
    "commonink.ws": "new-workspace",
    other: "kept",
    "commonink.theme": "dark",
    "commonink.w.timer-1": '{"left":60}',
    "commonink.details:Notes/A.md": "{}",
  });
  assert.equal(document.documentElement.dataset.theme, "dark");
  // Again: nothing left to move.
  vm.runInNewContext(script, { localStorage: proxy, document });
  assert.equal(store.size, 5);
});

test("links to notes open from commonink: hrefs, and from the legacy quire: ones", () => {
  assert.equal(noteTarget("commonink:Projects%2FRoadmap"), "Projects/Roadmap");
  assert.equal(noteTarget("quire:Roadmap%23Now"), "Roadmap#Now");
  assert.equal(noteTarget("https://example.com"), null);
  assert.equal(NOTE_LINKS, 'a[href^="commonink:"], a[href^="quire:"]');
});
