// Importing many notes at once: the core, the CLI (files, a folder, a .zip), MCP's import_notes and the app's POST /import.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { strToU8, zipSync } from "fflate";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { handleApi, type ApiHost } from "../src/core/api.ts";
import { MAX_IMPORT_NOTES, pairsImport, readImport, writeImport } from "../src/core/import.ts";
import { openVault } from "../src/core/local.ts";
import { openTempVault, tempVault } from "./helpers.ts";

const BIN = path.resolve(import.meta.dirname, "../bin/commonink");
const out = fs.mkdtempSync(path.join(os.tmpdir(), "commonink-import-"));
after(() => fs.rmSync(out, { recursive: true, force: true }));

function commonink(vault: string, args: string[]) {
  const env: NodeJS.ProcessEnv = { ...process.env, COMMONINK_VAULT: vault };
  delete env.COMMONINK_AGENT;
  const r = spawnSync(BIN, args, { env, encoding: "utf8" });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

const zipOf = (files: Record<string, string>) => zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])));

test("a .zip's notes come in at their paths; hidden folders and zip leftovers stay out, other types are named", () => {
  const set = readImport([
    {
      name: "Vault.zip",
      bytes: zipOf({
        "1. Projects/Launch.md": "﻿# Launch\n",
        "Daily/2026-10-01.markdown": "# Today\n",
        "Dash.html": "<h1>Dash</h1>",
        "assets/pic.png": "png",
        ".obsidian/app.json": "{}",
        "__MACOSX/._Launch.md": "junk",
        "Projects/.DS_Store": "junk",
        "tool.exe": "x",
      }),
    },
  ]);
  assert.deepEqual(set.notes.map((n) => n.path).sort(), ["1. Projects/Launch.md", "Daily/2026-10-01.markdown", "Dash.html"]);
  assert.equal(set.notes.find((n) => n.path.endsWith("Launch.md"))!.content, "# Launch\n", "a byte-order mark is dropped");
  assert.deepEqual(set.files.map((f) => f.path), ["assets/pic.png"]);
  assert.deepEqual(set.ignored, [{ path: "tool.exe", why: "not a note or a file type the vault keeps" }]);
  assert.deepEqual(readImport([{ name: "a.md", bytes: strToU8("# A") }], "Inbox").notes, [{ path: "Inbox/a.md", content: "# A" }]);
  assert.throws(() => readImport([{ name: "bad.zip", bytes: strToU8("not a zip") }]), /bad\.zip isn't a \.zip that can be opened/);
});

test("an import creates every note, skips or replaces ones already there, and checks it all before writing", async () => {
  const { vault } = openTempVault();
  const r = await writeImport(vault, pairsImport({ "Areas/Health": "# Health\n", "Areas/Work.md": "# Work\n", "Welcome.md": "# Replaced\n" }), { source: "agent" });
  assert.deepEqual(r.created, ["Areas/Health.md", "Areas/Work.md"]);
  assert.deepEqual(r.skipped, ["Welcome.md"]);
  assert.match(vault.read("Welcome").content, /Start with/, "skip is the default");
  assert.equal(vault.read("Areas/Health").content, "# Health\n");

  const again = await writeImport(vault, pairsImport({ "Welcome.md": "# Replaced\n", "Areas/Work.md": "# Work\n" }), { source: "agent", existing: "replace" });
  assert.deepEqual(again.replaced, ["Welcome.md"]);
  assert.deepEqual(again.skipped, ["Areas/Work.md"], "the same text is left alone");
  assert.equal(vault.read("Welcome").content, "# Replaced\n");
  assert.equal(vault.changes({ path: "Welcome.md", limit: 1 })[0].op, "edit", "History keeps what it was");

  await assert.rejects(writeImport(vault, pairsImport({ "New/One.md": "1", "../escape.md": "x" }), { source: "agent" }), /Invalid path/);
  await assert.rejects(writeImport(vault, pairsImport({ "New/Two.md": "2", "new/two": "again" }), { source: "agent" }), /in the import twice/);
  await assert.rejects(writeImport(vault, pairsImport({ "New/Three.md": "3", "pic.png": "x" }), { source: "agent" }), /isn't a note/);
  assert.equal(vault.resolve("New/One"), null, "nothing was written when one path was bad");
  assert.equal(vault.resolve("New/Two"), null);

  const many = Object.fromEntries(Array.from({ length: MAX_IMPORT_NOTES + 1 }, (_, i) => [`Bulk/${i}.md`, "x"]));
  await assert.rejects(writeImport(vault, pairsImport(many), { source: "agent" }), /at most 2000 come in at once/);
  await assert.rejects(writeImport(vault, { notes: [], files: [{ path: "a.png", bytes: new Uint8Array() }], ignored: [] }, { source: "agent" }), /through the CLI or the app/);
});

test("commonink import takes .md files, a folder and a .zip, with pictures, under --folder", () => {
  const vault = tempVault();
  const md = path.join(out, "Loose note.md");
  fs.writeFileSync(md, "# Loose\n");
  const one = commonink(vault, ["import", md, "--folder", "Inbox"]);
  assert.equal(one.status, 0, one.stderr);
  assert.equal(one.stdout, "Imported 1 new note.\n");
  assert.equal(fs.readFileSync(path.join(vault, "Inbox/Loose note.md"), "utf8"), "# Loose\n");

  const zip = path.join(out, "export.zip");
  fs.writeFileSync(zip, zipOf({ "Projects/Plan.md": "# Plan\n\n![[logo.png]]\n", "Projects/logo.png": "png", "Welcome.md": "# Other\n" }));
  const z = commonink(vault, ["import", zip, "--json"]);
  assert.equal(z.status, 0, z.stderr);
  const data = JSON.parse(z.stdout);
  assert.deepEqual(data.created, ["Projects/Plan.md"]);
  assert.deepEqual(data.files, ["Projects/logo.png"]);
  assert.deepEqual(data.skipped, ["Welcome.md"]);
  assert.equal(fs.readFileSync(path.join(vault, "Projects/logo.png"), "utf8"), "png");

  const folder = path.join(out, "Obsidian");
  fs.mkdirSync(path.join(folder, "4. Archive"), { recursive: true });
  fs.mkdirSync(path.join(folder, ".obsidian"), { recursive: true });
  fs.writeFileSync(path.join(folder, "4. Archive/Old.md"), "# Old\n");
  fs.writeFileSync(path.join(folder, ".obsidian/workspace.json"), "{}");
  const f = commonink(vault, ["import", folder, "--folder", "Imported"]);
  assert.equal(f.status, 0, f.stderr);
  assert.equal(fs.readFileSync(path.join(vault, "Imported/4. Archive/Old.md"), "utf8"), "# Old\n");
  assert.ok(!fs.existsSync(path.join(vault, "Imported/.obsidian")), "a hidden folder isn't read");

  const replaced = commonink(vault, ["import", zip, "--existing", "replace"]);
  assert.match(replaced.stdout, /replaced 1 note/);
  assert.equal(fs.readFileSync(path.join(vault, "Welcome.md"), "utf8"), "# Other\n");
  assert.equal(commonink(vault, ["import", path.join(out, "missing.zip")]).status, 3);
});

let client: Client;
let mcpVault: string;
before(async () => {
  mcpVault = tempVault();
  const env = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined && e[0] !== "COMMONINK_AGENT"));
  client = new Client({ name: "test-agent", version: "1.0.0" });
  await client.connect(new StdioClientTransport({ command: BIN, args: ["mcp"], env: { ...env, COMMONINK_VAULT: mcpVault } }));
});
after(() => client.close());

test("import_notes creates many notes in one MCP call", async () => {
  const r = (await client.callTool({ name: "import_notes", arguments: { notes: { "People/Axel": "# Axel\n", "People/Bea.md": "# Bea\n" }, folder: "CRM" } })) as { content: Array<{ text: string }>; isError?: boolean };
  assert.ok(!r.isError, r.content[0]?.text);
  assert.equal(r.content[0].text, "Imported 2 new notes.");
  assert.equal(openVault(mcpVault).read("CRM/People/Axel").content, "# Axel\n");
});

test("POST /import writes the app's notes and announces each", async () => {
  const { vault } = openTempVault();
  const events: string[] = [];
  const host: ApiHost = {
    vault,
    actor: "you",
    user: "you",
    canEditShared: true,
    info: () => ({}),
    // An open tab and History hear a change only when one comes with the write.
    written: (rel, content, version, change) => events.push(`written ${rel} ${change?.op ?? "no change"} ${version === vault.meta(rel)?.version} ${content === vault.files.read(rel)}`),
    moved: () => {},
    removed: () => {},
    tree: () => events.push("tree"),
  };
  const call = async (body: unknown) => {
    const res = (await handleApi(host, new Request("http://localhost/api/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), "/import"))!;
    return { status: res.status, body: await res.json() };
  };
  const ok = await call({ notes: { "A.md": "# A\n", "Welcome.md": "# W\n" }, folder: "" });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.created, ["A.md"]);
  assert.deepEqual(events, ["written A.md create true true", "tree"]);
  events.length = 0;
  const replaced = await call({ notes: { "A.md": "# A again\n", "Welcome.md": "# W\n" }, existing: "replace" });
  assert.deepEqual(replaced.body.replaced, ["A.md", "Welcome.md"]);
  assert.deepEqual(events, ["written A.md edit true true", "written Welcome.md edit true true"]);
  assert.equal((await call({ notes: ["A.md"] })).status, 400);
  assert.equal((await call({ notes: {}, existing: "merge" })).status, 400);
});
