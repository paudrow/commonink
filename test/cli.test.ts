import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { tempVault } from "./helpers.ts";

const BIN = path.resolve(import.meta.dirname, "../bin/quire");

function quire(vault: string, args: string[], input?: string) {
  const env: NodeJS.ProcessEnv = { ...process.env, QUIRE_VAULT: vault };
  delete env.QUIRE_AGENT;
  const r = spawnSync(BIN, args, { env, input, encoding: "utf8" });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

test("create reads stdin, edits are attributed to --as, and changes lists them", () => {
  const vault = tempVault();
  assert.equal(quire(vault, ["create", "Inbox", "-"], "# Inbox\n\n- milk\n").status, 0);
  assert.equal(fs.readFileSync(path.join(vault, "Inbox.md"), "utf8"), "# Inbox\n\n- milk\n");
  const edit = quire(vault, ["edit", "Inbox", "--old", "milk", "--new", "oat milk", "--as", "shopper"]);
  assert.match(edit.stdout, /^Edited Inbox\.md → version [0-9a-f]{12} \(\+1 −1\)\n$/);
  const changes = quire(vault, ["changes", "--json"]);
  assert.deepEqual(
    JSON.parse(changes.stdout).map((c: { op: string; source: string; path: string }) => `${c.op} ${c.path} by ${c.source}`),
    ["edit Inbox.md by shopper", "create Inbox.md by cli"],
  );
});

test("read prints numbered lines and honours --offset/--limit", () => {
  const vault = tempVault();
  const r = quire(vault, ["read", "Roadmap", "--offset", "4", "--limit", "3"]);
  assert.equal(r.status, 0);
  assert.equal(r.stdout.split("\n").slice(2).join("\n"), "\n4│# Roadmap\n5│\n6│## Now\n");
});

test("missing or malformed arguments are one-line errors, not stack traces", () => {
  const vault = tempVault();
  const cases: Array<[string[], RegExp]> = [
    [["read"], /^read needs <note>\n$/],
    [["mv", "Roadmap"], /^mv needs <new-path>\n$/],
    [["backlinks"], /^backlinks needs <note>\n$/],
    [["restore"], /^restore needs <change-id>\n$/],
    [["restore", "abc"], /^<change-id> must be a whole number, not "abc"\n$/],
    [["search", "roadmap", "--limit", "abc"], /^--limit must be a positive whole number, not "abc"\n$/],
    [["read", "Roadmap", "--offset", "0"], /^--offset must be a positive whole number, not "0"\n$/],
    [["ls", "--recent", "x"], /^--recent must be a positive whole number, not "x"\n$/],
    [["read", "../../etc/passwd"], /^No note matches/],
  ];
  for (const [args, stderr] of cases) {
    const r = quire(vault, args);
    assert.equal(r.status, 1, args.join(" "));
    assert.match(r.stderr, stderr, args.join(" "));
  }
});

test("an unknown command prints help and exits 2", () => {
  const r = quire(tempVault(), ["frobnicate"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /^Unknown command: frobnicate\n\nquire — markdown notes/);
});

test("tags lists the tag tree, and ls and search take --tag", () => {
  const vault = tempVault();
  assert.equal(quire(vault, ["tags"]).stdout, "- #plan (1 note)\n- #q3 (1 note)\n");
  assert.equal(quire(vault, ["ls", "--tag", "Q3"]).stdout, "- Projects/Roadmap.md — Roadmap\n");
  assert.equal(quire(vault, ["search", "importer", "--tag", "nope"]).stdout, 'No notes match "importer".\n');
});

test("tasks lists open tasks, and task changes one's tokens or ticks it", () => {
  const vault = tempVault();
  assert.equal(quire(vault, ["tasks"]).stdout, "- [ ] Ship the importer — Projects/Roadmap.md:8\n");
  assert.match(quire(vault, ["task", "Roadmap", "8", "--due", "2026-10-01", "--assignee", "@jane,sam"]).stdout, /^Updated Projects\/Roadmap\.md/);
  assert.equal(quire(vault, ["tasks", "--assignee", "sam"]).stdout, "- [ ] Ship the importer due:2026-10-01 @jane @sam — Projects/Roadmap.md:8\n");
  quire(vault, ["task", "Roadmap", "8", "--due", "none", "--assignee", "none", "--done"]);
  assert.match(fs.readFileSync(path.join(vault, "Projects/Roadmap.md"), "utf8"), /\n- \[x\] Ship the importer done:\d{4}-\d{2}-\d{2}\n/);
  assert.equal(quire(vault, ["task", "Roadmap", "3"]).stderr, "There's no task on line 3 of Roadmap\n");
});

test("smart-save, smart and smart-rm keep saved note queries", () => {
  const vault = tempVault();
  assert.match(quire(vault, ["smart-save", "Planning", "tag=plan", "--just-me"]).stdout, /^- Planning \(1 note, just you\): tag=plan \[[a-z2-9]{8}\]\n$/);
  assert.equal(quire(vault, ["smart", "planning"]).stdout, "- Projects/Roadmap.md — Roadmap\n");
  assert.equal(quire(vault, ["smart-save", "Bad", "colour=red"]).stderr, 'Unknown query key "colour": use q, folder, tag, sort or limit\n');
  assert.equal(quire(vault, ["smart-rm", "Planning"]).stdout, "No smart folders.\n");
});

test("star, unstar and starred keep your favorites in order", () => {
  const vault = tempVault();
  assert.equal(quire(vault, ["star", "Welcome", "Roadmap"]).stdout, "Favorites:\n- Welcome.md — Welcome\n- Projects/Roadmap.md — Roadmap\n");
  assert.equal(quire(vault, ["unstar", "Welcome"]).stdout, "Favorites:\n- Projects/Roadmap.md — Roadmap\n");
  assert.deepEqual(JSON.parse(quire(vault, ["starred", "--json"]).stdout).map((n: { path: string }) => n.path), ["Projects/Roadmap.md"]);
  assert.equal(quire(vault, ["star"]).stderr, "star needs <note>\n");
});
