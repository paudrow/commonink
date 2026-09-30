import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { groupChanges } from "../src/core/format.ts";
import { openVault } from "../src/core/local.ts";
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
  assert.match(quire(vault, ["changes", "--by", "people"]).stdout, /^#1 \S+ you: created Inbox\.md \(4 lines\)\n$/);
  assert.equal(quire(vault, ["changes", "--by", "ai"]).stdout.split("\n").filter(Boolean).length, 2);
  assert.match(quire(vault, ["changes", "--by", "Planner"]).stdout, /^#3 \S+ Planner for you: edited Inbox\.md \(\+2 −0\)\n$/);
});

test("changes counts a run of saves by its net change and says renamed, the same as History", () => {
  const vault = tempVault();
  quire(vault, ["create", "Churn", "-"], "# Churn\n\none\ntwo\n");
  quire(vault, ["edit", "Churn", "--old", "two\n", "--new", "two\nthree\nfour\nfive\nsix\n"]);
  quire(vault, ["edit", "Churn", "--old", "one\ntwo\nthree\nfour\nfive\nsix\n", "--new", "ONE\ntwo\nthree\n"]);
  quire(vault, ["edit", "Churn", "--old", "three\n", "--new", "three\nfour\n"]);
  quire(vault, ["mv", "Churn", "Churned"]);
  const lines = quire(vault, ["changes"]).stdout.trimEnd().split("\n");
  assert.deepEqual(
    lines.map((l) => l.replace(/^#\d+ \S+ /, "")),
    ["you: renamed Churn.md → Churned.md", "you: edited Churn.md (+3 −1, 3 saves)", "you: created Churn.md (5 lines)"],
  );
  // History's list and its diff count the run from the same change ids.
  const q = openVault(vault);
  const run = groupChanges(q.changes({}))[1];
  assert.deepEqual(q.diffStats([[run.first, run.first + 1, run.id]]), [{ add: 3, del: 1 }]);
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

test("board shows a note's boards, and card adds, moves and edits cards", () => {
  const vault = tempVault({ "Launch.md": "# Launch\n\n:::kanban\n## To do\n- [ ] Tiers\n\n## Done\n:::\n" });
  assert.match(quire(vault, ["card", "add", "Launch", "to do", "Pick", "a", "logo"]).stdout, /^Changed a card in Launch\.md/);
  quire(vault, ["card", "move", "Launch", "tiers", "Done"]);
  quire(vault, ["card", "edit", "Launch", "logo", "--text", "Pick a logo @ana"]);
  assert.match(quire(vault, ["board", "Launch"]).stdout, /^Board 1 of 1 in Launch\.md\n\n## To do\n- \[ \] Pick a logo @ana — L5\n\n## Done \(done column\)\n- \[x\] Tiers done:\d{4}-\d{2}-\d{2} — L8\n$/);
  assert.equal(quire(vault, ["card", "edit", "Launch", "5", "--undone"]).stdout.startsWith("No change to Launch.md"), true);
  assert.equal(quire(vault, ["card", "shuffle", "Launch"]).stderr, 'card needs add, move or edit, not "shuffle"\n');
  fs.writeFileSync(path.join(vault, "Messy.md"), "# Messy\n\n:::kanban\n## To do {color=blue}\nA loose line\n- [ ] Card\n:::\n\n:::kanban\n## Open\n");
  assert.equal(
    quire(vault, ["board", "Messy"]).stdout,
    "Board 1 of 1 in Messy.md\n\nProblems (the lines stay as they are until fixed):\n- Line 5 in To do isn't a card (stray, L5)\n\n## To do {color=blue}\n- [ ] Card — L6\n\nProblem: the :::kanban on line 9 has no closing ::: line, so it shows as text.\n",
  );
});

test("task add writes a task from words, and task move moves one", () => {
  const vault = tempVault();
  const today = new Date().toLocaleDateString("en-CA");
  assert.equal(quire(vault, ["task", "add", "Call the printer → [[Roadmap]] !high"]).stdout, 'Added "- [ ] Call the printer !high" to Projects/Roadmap.md:10\n');
  assert.equal(quire(vault, ["task", "add", "Stretch every day"]).stdout, `Added "- [ ] Stretch due:${today} rec:daily" to Journal/${today}.md:5\n`);
  assert.equal(quire(vault, ["task", "move", "Roadmap", "10", "--to", "Welcome"]).stdout, 'Moved "Call the printer !high" to Welcome.md:7\n');
  assert.equal(quire(vault, ["task", "add"]).stderr, "Say what the task is: quire task add \"Call mom tomorrow\"\n");
});

test("today prints the day's sections", () => {
  const vault = tempVault();
  quire(vault, ["task", "Roadmap", "8", "--due", "2026-10-01"]);
  assert.equal(
    quire(vault, ["today", "--date", "2026-10-01"]).stdout,
    "Thursday, October 1, 2026\n\nOverdue (0)\n- nothing\n\nDue today (1)\n- [ ] Ship the importer due:2026-10-01 — Projects/Roadmap.md:8\n\nStarting today (0)\n- nothing\n\nJournal: Journal/2026-10-01.md (not written yet)\n",
  );
  assert.equal(JSON.parse(quire(vault, ["today", "--date", "2026-10-01", "--json"]).stdout).sections[1].tasks[0].line, 8);
});

test("smart-save, smart and smart-rm keep saved note queries", () => {
  const vault = tempVault();
  assert.match(quire(vault, ["smart-save", "Planning", "tag=plan", "--just-me"]).stdout, /^- Planning \(1 note, just you\): tag=plan \[[a-z2-9]{8}\]\n$/);
  assert.equal(quire(vault, ["smart", "planning"]).stdout, "- Projects/Roadmap.md — Roadmap\n");
  assert.equal(quire(vault, ["smart-save", "Bad", "colour=red"]).stderr, 'Unknown query key "colour": use q, folder, tag, sort or limit\n');
  assert.equal(quire(vault, ["smart-rm", "Planning"]).stdout, "No smart folders.\n");
});

test("task --until and --times end a repeat, and ticking counts it down", () => {
  const vault = tempVault();
  quire(vault, ["task", "Roadmap", "8", "--due", "2026-10-01", "--rec", "weekly", "--times", "2", "--until", "2027-01-01"]);
  quire(vault, ["task", "Roadmap", "8", "--done"]);
  assert.match(fs.readFileSync(path.join(vault, "Projects/Roadmap.md"), "utf8"), /\n- \[ \] Ship the importer due:2026-10-08 rec:weekly until:2027-01-01 times:1\n/);
  assert.equal(quire(vault, ["task", "Roadmap", "8", "--times", "0"]).stderr, '"times" must be a whole number of repeats left, 1 or more\n');
});

test("star and unstar take #tags as well as notes", () => {
  const vault = tempVault();
  assert.equal(quire(vault, ["star", "Welcome", "#plan"]).stdout, "Favorites:\n- Welcome.md — Welcome\n- #plan (1 note)\n");
  assert.equal(quire(vault, ["unstar", "#plan"]).stdout, "Favorites:\n- Welcome.md — Welcome\n");
});

test("star, unstar and starred keep your favorites in order", () => {
  const vault = tempVault();
  assert.equal(quire(vault, ["star", "Welcome", "Roadmap"]).stdout, "Favorites:\n- Welcome.md — Welcome\n- Projects/Roadmap.md — Roadmap\n");
  assert.equal(quire(vault, ["unstar", "Welcome"]).stdout, "Favorites:\n- Projects/Roadmap.md — Roadmap\n");
  assert.deepEqual(JSON.parse(quire(vault, ["starred", "--json"]).stdout).map((n: { path: string }) => n.path), ["Projects/Roadmap.md"]);
  assert.equal(quire(vault, ["star"]).stderr, "star needs <note>\n");
});

test("delete sends notes to Trash, trash lists them, and trash restore brings one back", () => {
  const vault = tempVault();
  assert.match(quire(vault, ["delete", "Roadmap", "--agent", "Planner"]).stdout, /^Moved Projects\/Roadmap\.md to Trash \(\d+-\d+\)\n$/);
  const listed = quire(vault, ["trash"]).stdout;
  assert.match(listed, /^\d+-\d+  Projects\/Roadmap\.md — deleted \d{4}-\d{2}-\d{2} \d{2}:\d{2} by Planner for you, gone for good \d{4}-\d{2}-\d{2}\n$/);
  assert.equal(quire(vault, ["trash", "restore", listed.split(" ")[0]]).stdout, "Restored Projects/Roadmap.md\n");
  assert.equal(quire(vault, ["trash"]).stdout, "Trash is empty.\n");
  assert.equal(quire(vault, ["trash", "empty"]).stderr, 'trash takes restore, not "empty"\n');
});

test("templates and new --template", () => {
  const vault = tempVault();
  fs.mkdirSync(path.join(vault, "Templates"));
  fs.writeFileSync(path.join(vault, "Templates/Meeting.md"), "---\ntitle: \"{{date}} {{ask:Client}}\"\nfolder: Meetings\napplies_to: Meetings/\n---\n# {{title}}\n\n**Attendees:** {{ask:Attendees}}\n\n- {{cursor}}\n");
  assert.match(quire(vault, ["templates"]).stdout, /Templates\/Meeting\.md — Meeting · asks: Client, Attendees/);
  const r = quire(vault, ["new", "--template", "Meeting", "--var", "Client=Acme", "--var", "Attendees=Sam, Lee"]);
  assert.match(r.stdout, /^Created Meetings\/\d{4}-\d\d-\d\d Acme\.md from Templates\/Meeting\.md\.\n$/);
  const made = fs.readdirSync(path.join(vault, "Meetings"))[0];
  assert.match(fs.readFileSync(path.join(vault, "Meetings", made), "utf8"), /\*\*Attendees:\*\* Sam, Lee/);
  assert.equal(quire(vault, ["new", "--template", "Meeting", "--var", "oops"]).stderr, "--var takes Name=value, not \"oops\"\n");
  assert.equal(quire(vault, ["new"]).stderr, "new needs --template <name>\n");
});
