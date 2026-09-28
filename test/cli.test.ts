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
