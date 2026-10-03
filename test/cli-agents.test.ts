// The CLI as an agent uses it: exit codes, --json results and errors, stdin, --base, and the commands
// that reach what the app does (folders, files, tags, history, Trash, favorites' order).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { tempVault } from "./helpers.ts";

const BIN = path.resolve(import.meta.dirname, "../bin/commonink");

function commonink(vault: string, args: string[], input?: string) {
  const env: NodeJS.ProcessEnv = { ...process.env, COMMONINK_VAULT: vault };
  delete env.COMMONINK_AGENT;
  const r = spawnSync(BIN, args, { env, input, encoding: "utf8" });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}
const json = (vault: string, args: string[], input?: string) => {
  const r = commonink(vault, [...args, "--json"], input);
  return { status: r.status, data: JSON.parse(r.stdout), stderr: r.stderr };
};

test("exit codes say how it went, and --json errors are JSON on stdout", () => {
  const vault = tempVault();
  const read = json(vault, ["read", "Roadmap"]);
  assert.equal(read.status, 0);
  const cases: Array<[string[], number, string, RegExp]> = [
    [["read", "Nowhere"], 3, "not_found", /^No note matches "Nowhere"/],
    [["edit", "Roadmap", "--old", "Ship", "--new", "Send", "--base", "000000000000"], 4, "conflict", /is at version [0-9a-f]{12}, not 000000000000/],
    [["create", "Welcome", "# again"], 5, "exists", /^Welcome\.md already exists/],
    [["frobnicate"], 2, "usage", /^Unknown command: frobnicate$/],
    [["read"], 2, "usage", /^read needs <note>$/],
    [["create", "notes.png", "x"], 1, "invalid", /^Only \.md and \.html notes can be created$/],
  ];
  for (const [args, exit, code, error] of cases) {
    const r = json(vault, args);
    assert.equal(r.status, exit, args.join(" "));
    assert.equal(r.data.code, code, args.join(" "));
    assert.equal(r.data.exit, exit, args.join(" "));
    assert.match(r.data.error, error, args.join(" "));
    assert.equal(r.stderr, "", args.join(" "));
  }
});

test("--json prints each command's result as data", () => {
  const vault = tempVault();
  assert.deepEqual(json(vault, ["search", "importer"]).data.map((h: { path: string; lines: unknown }) => [h.path, h.lines]), [["Projects/Roadmap.md", [{ line: 8, text: "- [ ] Ship the importer" }]]]);
  assert.deepEqual(
    json(vault, ["tasks", "--all"]).data.map((t: { path: string; line: number; text: string; done: boolean }) => [t.path, t.line, t.text, t.done]),
    [["Projects/Roadmap.md", 8, "Ship the importer", false], ["Projects/Roadmap.md", 9, "Write the parser", true]],
  );
  const note = json(vault, ["read", "Roadmap"]).data;
  assert.deepEqual(Object.keys(note).sort(), ["content", "id", "kind", "mtime", "path", "size", "title", "version"]);
  assert.deepEqual(json(vault, ["folders"]).data, [{ folder: "Dashboards", notes: 1 }, { folder: "Projects", notes: 1 }]);
  const created = json(vault, ["create", "Inbox", "# Inbox"]).data;
  assert.equal(created.path, "Inbox.md");
  assert.match(created.version, /^[0-9a-f]{12}$/);
  assert.equal(created.change.op, "create");
});

test("create --overwrite replaces a note that's there, and still creates one that isn't", () => {
  const vault = tempVault();
  const replaced = json(vault, ["create", "Welcome", "# Welcome back", "--overwrite"]);
  assert.equal(replaced.status, 0);
  assert.equal(replaced.data.path, "Welcome.md");
  assert.equal(replaced.data.change.op, "edit");
  assert.equal(fs.readFileSync(path.join(vault, "Welcome.md"), "utf8"), "# Welcome back");
  assert.equal(json(vault, ["create", "Welcome", "# Welcome back", "--overwrite"]).data.change, null);
  const fresh = json(vault, ["create", "Brand/New", "# New", "--overwrite"]);
  assert.equal(fresh.data.change.op, "create");
  assert.equal(fs.readFileSync(path.join(vault, "Brand/New.md"), "utf8"), "# New");
});

test("content comes from stdin (- or piped), and --base guards write, append and edit", () => {
  const vault = tempVault();
  assert.equal(commonink(vault, ["create", "Log"], "# Log\n").status, 0);
  assert.equal(commonink(vault, ["append", "Log", "-"], "- first\n").status, 0);
  const v = json(vault, ["read", "Log"]).data.version;
  assert.equal(commonink(vault, ["write", "Log", "-", "--base", v], "# Log\n\n- rewritten\n").status, 0);
  assert.equal(fs.readFileSync(path.join(vault, "Log.md"), "utf8"), "# Log\n\n- rewritten\n");
  // The version from before the write is stale now.
  assert.equal(commonink(vault, ["append", "Log", "- late", "--base", v]).status, 4);
  assert.equal(commonink(vault, ["write", "Log", "-", "--base", v], "# clobber\n").status, 4);
  assert.equal(fs.readFileSync(path.join(vault, "Log.md"), "utf8"), "# Log\n\n- rewritten\n");
  assert.equal(commonink(vault, ["edit", "Log", "--old", "rewritten", "--new", "-"], "kept").status, 0);
  assert.equal(fs.readFileSync(path.join(vault, "Log.md"), "utf8"), "# Log\n\n- kept\n");
  assert.equal(commonink(vault, ["write", "Log", "-"], "  \n").stderr, "That would leave the note empty. To remove it, use delete.\n");
});

test("upload adds files under a free name, and download copies them back out (or to stdout)", () => {
  const vault = tempVault();
  const here = fs.mkdtempSync(path.join(os.tmpdir(), "commonink-files-"));
  fs.writeFileSync(path.join(here, "logo.png"), Buffer.from([137, 80, 78, 71, 1, 2, 3]));
  const up = json(vault, ["upload", path.join(here, "logo.png"), path.join(here, "logo.png"), "--folder", "brand", "--agent", "Designer"]);
  assert.deepEqual(up.data, [{ path: "brand/logo.png", size: 7 }, { path: "brand/logo 2.png", size: 7 }]);
  assert.match(commonink(vault, ["changes", "--limit", "1"]).stdout, /Designer for you: created brand\/logo 2\.png/);
  const out = path.join(here, "copy.png");
  assert.equal(commonink(vault, ["download", "brand/logo.png", "--out", out]).stdout, `Downloaded brand/logo.png (7 B) → ${out}\n`);
  assert.deepEqual([...fs.readFileSync(out)], [137, 80, 78, 71, 1, 2, 3]);
  const raw = spawnSync(BIN, ["download", "brand/logo.png", "--out", "-"], { env: { ...process.env, COMMONINK_VAULT: vault } });
  assert.deepEqual([...raw.stdout], [137, 80, 78, 71, 1, 2, 3]);
  assert.equal(commonink(vault, ["upload", path.join(here, "missing.png")]).status, 3);
  assert.equal(commonink(vault, ["upload", path.join(here, "logo.png"), "--folder", "../outside"]).status, 1);
});

test("folders, folder delete, tag rename, tag asset, journal, diff, restore and starred order", () => {
  const vault = tempVault({ ...JSON.parse(JSON.stringify({})), "Ideas/Old/A.md": "# A\n\n#research\n", "Ideas/Old/B.md": "# B\n", "Welcome.md": "# Welcome\n", "assets/chart.svg": "<svg/>" });
  assert.equal(commonink(vault, ["folders"]).stdout, "- Ideas/ (2)\n  - Old/ (2)\n");
  assert.equal(commonink(vault, ["folder", "delete", "Ideas/Old", "--notes", "lift"]).stdout, "Moved Ideas/Old/A.md → Ideas/A.md\nMoved Ideas/Old/B.md → Ideas/B.md\n");
  assert.match(commonink(vault, ["tag", "rename", "research", "research/ml"]).stdout, /^Renamed #research to #research\/ml in 1 note: Ideas\/A\.md\n$/);
  assert.equal(commonink(vault, ["tag", "asset", "assets/chart.svg", "charts", "#brand"]).stdout, "Tags on assets/chart.svg: #charts #brand\n");
  assert.equal(commonink(vault, ["tag", "asset", "assets/chart.svg"]).status, 2);
  assert.equal(commonink(vault, ["tag", "asset", "assets/chart.svg", "--clear"]).stdout, "No tags on assets/chart.svg\n");
  assert.equal(commonink(vault, ["journal", "--date", "2026-10-01"]).stdout, "Started Journal/2026-10-01.md\n");
  assert.equal(commonink(vault, ["journal", "--date", "2026-10-01"]).stdout, "Already there: Journal/2026-10-01.md\n");
  commonink(vault, ["edit", "Welcome", "--old", "Welcome", "--new", "Hello"]);
  const id = json(vault, ["changes", "--limit", "1"]).data[0].id;
  assert.deepEqual(json(vault, ["changes", "--path", "Welcome"]).data.map((c: { id: number }) => c.id)[0], id, "--path takes a note's name");
  assert.equal(commonink(vault, ["diff", String(id)]).stdout, "--- Welcome.md\tbefore #" + id + "\n+++ Welcome.md\tafter #" + id + "\n@@ -1,1 +1,1 @@\n-# Welcome\n+# Hello\n");
  assert.match(commonink(vault, ["restore", String(id)]).stdout, /^Restored Welcome\.md/);
  assert.equal(fs.readFileSync(path.join(vault, "Welcome.md"), "utf8"), "# Welcome\n");
  commonink(vault, ["star", "Welcome", "Ideas/A", "#research/ml"]);
  assert.equal(commonink(vault, ["starred", "order", "#research/ml", "Ideas/A"]).stdout, "Favorites:\n- #research/ml (1 note)\n- Ideas/A.md — A\n- Welcome.md — Welcome\n");
  assert.equal(commonink(vault, ["starred"]).stdout, "Favorites:\n- #research/ml (1 note)\n- Ideas/A.md — A\n- Welcome.md — Welcome\n");
});

test("task remove takes a task's line out, and a task is named by its line", () => {
  const vault = tempVault({ "Inbox.md": "# Inbox\n\n- [ ] Keep\n- [ ] Drop\n  - its note\n- [ ] Also keep\n" });
  assert.match(commonink(vault, ["task", "remove", "Inbox", "4"]).stdout, /^Removed a task from Inbox\.md/);
  assert.equal(fs.readFileSync(path.join(vault, "Inbox.md"), "utf8"), "# Inbox\n\n- [ ] Keep\n- [ ] Also keep\n");
  assert.equal(commonink(vault, ["task", "remove", "Inbox", "9"]).status, 3);
});

test("help lists every group, help <command> shows its options and examples, and completion scripts complete", () => {
  const vault = tempVault();
  const help = commonink(vault, ["help"]).stdout;
  for (const g of ["Notes:", "Folders and files:", "Tasks and today:", "Boards:", "Tags:", "Views:", "Favorites:", "History and Trash:", "The CLI itself:"]) assert.ok(help.includes(`\n${g}\n`), g);
  assert.match(help, /Exit codes: 0 ok, 1 error, 2 usage, 3 not found, 4 conflict, 5 exists, 6 forbidden, 7 auth, 8 unavailable\./);
  const one = commonink(vault, ["help", "task", "move"]).stdout;
  assert.match(one, /^commonink task move <note> <line> --to <to> \[--text <text>\]\n/);
  assert.match(one, /\nExamples:\n  commonink task move Journal\/2026-09-28 5 --to Launch\n/);
  assert.match(one, /\nThe MCP tool move_task does the same\.\n$/);
  assert.equal(commonink(vault, ["task", "move", "--help"]).stdout, one);
  assert.match(commonink(vault, ["help", "upload"]).stdout, /No MCP tool: MCP tools carry text; files' bytes go through the CLI or the app\.\n$/);
  const complete = (words: string[]) => {
    const script = commonink(vault, ["completion", "bash"]).stdout;
    const r = spawnSync("bash", ["-c", `${script}\nCOMP_WORDS=(${words.map((w) => `'${w}'`).join(" ")}); COMP_CWORD=${words.length - 1}; _commonink; echo "\${COMPREPLY[@]}"`], { encoding: "utf8" });
    return r.stdout.trim().split(" ");
  };
  assert.deepEqual(complete(["commonink", "ta"]), ["tag", "tags", "task", "tasks"]);
  assert.deepEqual(complete(["commonink", "task", ""]), ["add", "update", "move", "remove"]);
  assert.deepEqual(complete(["commonink", "task", "move", "Inbox", "3", "--t"]), ["--text", "--to"]);
  assert.match(commonink(vault, ["completion", "fish"]).stdout, /complete -c commonink -n "__fish_seen_subcommand_from search" -l limit/);
  assert.match(commonink(vault, ["completion", "zsh"]).stdout, /bashcompinit/);
  assert.equal(commonink(vault, ["completion", "tcsh"]).status, 2);
});
