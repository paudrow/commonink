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

test("create reads stdin, edits are attributed to --agent (or --as), and changes lists them", () => {
  const vault = tempVault();
  assert.equal(quire(vault, ["create", "Inbox", "-"], "# Inbox\n\n- milk\n").status, 0);
  assert.equal(fs.readFileSync(path.join(vault, "Inbox.md"), "utf8"), "# Inbox\n\n- milk\n");
  const edit = quire(vault, ["edit", "Inbox", "--old", "milk", "--new", "oat milk", "--as", "shopper"]);
  assert.match(edit.stdout, /^Edited Inbox\.md → version [0-9a-f]{12} \(\+1 −1\)\n$/);
  quire(vault, ["append", "Inbox", "- eggs", "--agent", "Planner"]);
  const changes = quire(vault, ["changes", "--json"]);
  assert.deepEqual(
    JSON.parse(changes.stdout).map((c: { op: string; path: string; person: string; agent: string | null }) => `${c.op} ${c.path} by ${c.agent ?? "-"} for ${c.person}`),
    ["edit Inbox.md by Planner for you", "edit Inbox.md by shopper for you", "create Inbox.md by - for you"],
  );
  assert.match(quire(vault, ["changes", "--by", "people"]).stdout, /^#1 \S+ you: create Inbox\.md \(4 lines\)\n$/);
  assert.equal(quire(vault, ["changes", "--by", "ai"]).stdout.split("\n").filter(Boolean).length, 2);
  assert.match(quire(vault, ["changes", "--by", "Planner"]).stdout, /^#3 \S+ Planner for you: edit Inbox\.md \(\+2 −0\)\n$/);
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

test("star, unstar and starred keep your favorites in order", () => {
  const vault = tempVault();
  assert.equal(quire(vault, ["star", "Welcome", "Roadmap"]).stdout, "Favorites:\n- Welcome.md — Welcome\n- Projects/Roadmap.md — Roadmap\n");
  assert.equal(quire(vault, ["unstar", "Welcome"]).stdout, "Favorites:\n- Projects/Roadmap.md — Roadmap\n");
  assert.deepEqual(JSON.parse(quire(vault, ["starred", "--json"]).stdout).map((n: { path: string }) => n.path), ["Projects/Roadmap.md"]);
  assert.equal(quire(vault, ["star"]).stderr, "star needs <note>\n");
});
