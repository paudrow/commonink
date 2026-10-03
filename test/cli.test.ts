import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { zipFolder } from "../src/cli/folder.ts";
import { browserCommand } from "../src/cli/hosted.ts";
import { readImport } from "../src/core/import.ts";
import { groupChanges } from "../src/core/format.ts";
import { openVault } from "../src/core/local.ts";
import { tempVault } from "./helpers.ts";

const BIN = path.resolve(import.meta.dirname, "../bin/commonink");

function commonink(vault: string, args: string[], input?: string) {
  const env: NodeJS.ProcessEnv = { ...process.env, COMMONINK_VAULT: vault };
  delete env.COMMONINK_AGENT;
  const r = spawnSync(BIN, args, { env, input, encoding: "utf8" });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

test("create reads stdin, edits are attributed to --agent (or --as), and changes lists them", () => {
  const vault = tempVault();
  assert.equal(commonink(vault, ["create", "Inbox", "-"], "# Inbox\n\n- milk\n").status, 0);
  assert.equal(fs.readFileSync(path.join(vault, "Inbox.md"), "utf8"), "# Inbox\n\n- milk\n");
  const edit = commonink(vault, ["edit", "Inbox", "--old", "milk", "--new", "oat milk", "--as", "shopper"]);
  assert.match(edit.stdout, /^Edited Inbox\.md → version [0-9a-f]{12} \(\+1 −1\)\n$/);
  commonink(vault, ["append", "Inbox", "- eggs", "--agent", "Planner"]);
  const changes = commonink(vault, ["changes", "--json"]);
  assert.deepEqual(
    JSON.parse(changes.stdout).map((c: { op: string; path: string; person: string; agent: string | null }) => `${c.op} ${c.path} by ${c.agent ?? "-"} for ${c.person}`),
    ["edit Inbox.md by Planner for you", "edit Inbox.md by shopper for you", "create Inbox.md by - for you"],
  );
  assert.match(commonink(vault, ["changes", "--by", "people"]).stdout, /^#1 \S+ you: created Inbox\.md \(4 lines\)\n$/);
  assert.equal(commonink(vault, ["changes", "--by", "ai"]).stdout.split("\n").filter(Boolean).length, 2);
  assert.match(commonink(vault, ["changes", "--by", "Planner"]).stdout, /^#3 \S+ Planner for you: edited Inbox\.md \(\+2 −0\)\n$/);
});

test("changes counts a run of saves by its net change and says renamed, the same as History", () => {
  const vault = tempVault();
  commonink(vault, ["create", "Churn", "-"], "# Churn\n\none\ntwo\n");
  commonink(vault, ["edit", "Churn", "--old", "two\n", "--new", "two\nthree\nfour\nfive\nsix\n"]);
  commonink(vault, ["edit", "Churn", "--old", "one\ntwo\nthree\nfour\nfive\nsix\n", "--new", "ONE\ntwo\nthree\n"]);
  commonink(vault, ["edit", "Churn", "--old", "three\n", "--new", "three\nfour\n"]);
  commonink(vault, ["mv", "Churn", "Churned"]);
  const lines = commonink(vault, ["changes"]).stdout.trimEnd().split("\n");
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
  const r = commonink(vault, ["read", "Roadmap", "--offset", "4", "--limit", "3"]);
  assert.equal(r.status, 0);
  assert.equal(r.stdout.split("\n").slice(2).join("\n"), "\n4│# Roadmap\n5│\n6│## Now\n");
});

test("missing or malformed arguments are one-line errors with exit code 2, not stack traces", () => {
  const vault = tempVault();
  const cases: Array<[string[], RegExp, number]> = [
    [["read"], /^read needs <note>\n$/, 2],
    [["mv", "Roadmap"], /^mv needs <new-path>\n$/, 2],
    [["backlinks"], /^backlinks needs <note>\n$/, 2],
    [["restore"], /^restore needs <change-id>\n$/, 2],
    [["restore", "abc"], /^<change-id> must be a whole number, not "abc"\n$/, 2],
    [["search", "roadmap", "--limit", "abc"], /^--limit must be a positive whole number from 1 to 50, not "abc"\n$/, 2],
    [["read", "Roadmap", "--offset", "0"], /^--offset must be a positive whole number, not "0"\n$/, 2],
    [["ls", "--recent", "x"], /^--recent must be a positive whole number from 1 to 100, not "x"\n$/, 2],
    [["ls", "--colour", "red"], /^ls has no --colour: see commonink help ls\n$/, 2],
    [["task", "Roadmap", "8", "--priority", "urgent"], /^--priority must be high or low, not "urgent"\n$/, 2],
    [["read", "../../etc/passwd"], /^No note matches/, 3],
  ];
  for (const [args, stderr, status] of cases) {
    const r = commonink(vault, args);
    assert.equal(r.status, status, args.join(" "));
    assert.match(r.stderr, stderr, args.join(" "));
  }
});

test("an unknown command prints help and exits 2", () => {
  const r = commonink(tempVault(), ["frobnicate"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /^Unknown command: frobnicate\n\ncommonink — markdown notes/);
});

test("tags lists the tag tree, and ls and search take --tag", () => {
  const vault = tempVault();
  assert.equal(commonink(vault, ["tags"]).stdout, "- #plan (1 note)\n- #q3 (1 note)\n");
  assert.equal(commonink(vault, ["ls", "--tag", "Q3"]).stdout, "- Projects/Roadmap.md — Roadmap\n");
  assert.equal(commonink(vault, ["search", "importer", "--tag", "nope"]).stdout, 'No notes match "importer".\n');
});

test("tasks lists open tasks, and task changes one's tokens or ticks it", () => {
  const vault = tempVault();
  assert.equal(commonink(vault, ["tasks"]).stdout, "- [ ] Ship the importer — Projects/Roadmap.md:8\n");
  assert.match(commonink(vault, ["task", "Roadmap", "8", "--due", "2026-10-01", "--assignee", "@jane,sam"]).stdout, /^Updated Projects\/Roadmap\.md/);
  assert.equal(commonink(vault, ["tasks", "--assignee", "sam"]).stdout, "- [ ] Ship the importer due:2026-10-01 @jane @sam — Projects/Roadmap.md:8\n");
  commonink(vault, ["task", "Roadmap", "8", "--due", "none", "--assignee", "none", "--done"]);
  assert.match(fs.readFileSync(path.join(vault, "Projects/Roadmap.md"), "utf8"), /\n- \[x\] Ship the importer done:\d{4}-\d{2}-\d{2}\n/);
  assert.equal(commonink(vault, ["task", "Roadmap", "3"]).stderr, "There's no task on line 3 of Roadmap\n");
  // --done-date lists what was ticked in that span, done tasks without --all.
  assert.match(commonink(vault, ["tasks", "--done-date", ">=-7d"]).stdout, /^- \[x\] Ship the importer done:/);
  assert.equal(commonink(vault, ["tasks", "--done-date", ">=+1d"]).stdout, commonink(vault, ["tasks", "--done-date", "<-7d"]).stdout);
  assert.equal(commonink(vault, ["tasks", "--priority", "high", "--all"]).stdout, "No tasks match.\n");
  assert.match(commonink(vault, ["tasks", "--due", ">=today <=soon"]).stderr, /^Bad due filter ">=today <=soon": use today, tomorrow/);
});

test("board shows a note's boards, and card adds, moves and edits cards", () => {
  const vault = tempVault({ "Launch.md": "# Launch\n\n:::kanban\n## To do\n- [ ] Tiers\n\n## Done\n:::\n" });
  assert.match(commonink(vault, ["card", "add", "Launch", "to do", "Pick", "a", "logo"]).stdout, /^Added a card to Launch\.md/);
  commonink(vault, ["card", "move", "Launch", "tiers", "Done"]);
  commonink(vault, ["card", "edit", "Launch", "logo", "--text", "Pick a logo @ana"]);
  assert.match(commonink(vault, ["board", "Launch"]).stdout, /^Board 1 of 1 in Launch\.md\n\n## To do\n- \[ \] Pick a logo @ana — L5\n\n## Done \(done column\)\n- \[x\] Tiers done:\d{4}-\d{2}-\d{2} — L8\n$/);
  assert.equal(commonink(vault, ["card", "edit", "Launch", "5", "--undone"]).stdout.startsWith("No change to Launch.md"), true);
  assert.equal(commonink(vault, ["card", "shuffle", "Launch"]).stderr, 'card needs add, move or edit, not "shuffle"\n');
  fs.writeFileSync(path.join(vault, "Messy.md"), "# Messy\n\n:::kanban\n## To do {color=blue}\nA loose line\n- [ ] Card\n:::\n\n:::kanban\n## Open\n");
  assert.equal(
    commonink(vault, ["board", "Messy"]).stdout,
    "Board 1 of 1 in Messy.md\n\nProblems (the lines stay as they are until fixed):\n- Line 5 in To do isn't a card (stray, L5)\n\n## To do {color=blue}\n- [ ] Card — L6\n\nProblem: the :::kanban on line 9 has no closing ::: line, so it shows as text.\n",
  );
});

test("task add writes a task from words, and task move moves one", () => {
  const vault = tempVault();
  const today = new Date().toLocaleDateString("en-CA");
  assert.equal(commonink(vault, ["task", "add", "Call the printer → [[Roadmap]] !high"]).stdout, 'Added "- [ ] Call the printer !high" to Projects/Roadmap.md:10\n');
  assert.equal(commonink(vault, ["task", "add", "Stretch every day"]).stdout, `Added "- [ ] Stretch due:${today} rec:daily" to Journal/${today}.md:5\n`);
  assert.equal(commonink(vault, ["task", "move", "Roadmap", "10", "--to", "Welcome"]).stdout, 'Moved "Call the printer !high" to Welcome.md:7\n');
  assert.equal(commonink(vault, ["task", "add"]).stderr, "Say what the task is: commonink task add \"Call mom tomorrow\"\n");
});

test("today prints the day's sections", () => {
  const vault = tempVault();
  commonink(vault, ["task", "Roadmap", "8", "--due", "2026-10-01"]);
  assert.equal(
    commonink(vault, ["today", "--date", "2026-10-01"]).stdout,
    "Thursday, October 1, 2026\n\nOverdue (0)\n- nothing\n\nDue today (1)\n- [ ] Ship the importer due:2026-10-01 — Projects/Roadmap.md:8\n\nStarting today (0)\n- nothing\n\nJournal: Journal/2026-10-01.md (not written yet)\n",
  );
  assert.equal(JSON.parse(commonink(vault, ["today", "--date", "2026-10-01", "--json"]).stdout).sections[1].tasks[0].line, 8);
});

test("smart-save, smart and smart-rm keep saved note queries", () => {
  const vault = tempVault();
  assert.match(commonink(vault, ["smart-save", "Planning", "tag=plan", "--just-me"]).stdout, /^- Planning \(1 note, just you\): tag=plan \[[a-z2-9]{8}\]\n$/);
  assert.equal(commonink(vault, ["smart", "planning"]).stdout, "- Projects/Roadmap.md — Roadmap\n");
  assert.equal(commonink(vault, ["smart-save", "Bad", "colour=red"]).stderr, 'Unknown query key "colour": use q, folder, tag, sort or limit\n');
  assert.equal(commonink(vault, ["smart-rm", "Planning"]).stdout, "No smart folders.\n");
});

test("task --until and --times end a repeat, and ticking counts it down", () => {
  const vault = tempVault();
  commonink(vault, ["task", "Roadmap", "8", "--due", "2026-10-01", "--rec", "weekly", "--times", "2", "--until", "2027-01-01"]);
  commonink(vault, ["task", "Roadmap", "8", "--done"]);
  assert.match(fs.readFileSync(path.join(vault, "Projects/Roadmap.md"), "utf8"), /\n- \[ \] Ship the importer due:2026-10-08 rec:weekly until:2027-01-01 times:1\n/);
  assert.equal(commonink(vault, ["task", "Roadmap", "8", "--times", "0"]).stderr, '--times must be a positive whole number, not "0"\n');
});

test("star and unstar take #tags as well as notes", () => {
  const vault = tempVault();
  assert.equal(commonink(vault, ["star", "Welcome", "#plan"]).stdout, "Favorites:\n- Welcome.md — Welcome\n- #plan (1 note)\n");
  assert.equal(commonink(vault, ["unstar", "#plan"]).stdout, "Favorites:\n- Welcome.md — Welcome\n");
});

test("star, unstar and starred keep your favorites in order", () => {
  const vault = tempVault();
  assert.equal(commonink(vault, ["star", "Welcome", "Roadmap"]).stdout, "Favorites:\n- Welcome.md — Welcome\n- Projects/Roadmap.md — Roadmap\n");
  assert.equal(commonink(vault, ["unstar", "Welcome"]).stdout, "Favorites:\n- Projects/Roadmap.md — Roadmap\n");
  assert.deepEqual(JSON.parse(commonink(vault, ["starred", "--json"]).stdout).map((n: { path: string }) => n.path), ["Projects/Roadmap.md"]);
  assert.equal(commonink(vault, ["star"]).stderr, "star needs <note>\n");
});

test("delete sends notes to Trash, trash lists them, and trash restore brings one back", () => {
  const vault = tempVault();
  assert.match(commonink(vault, ["delete", "Roadmap", "--agent", "Planner"]).stdout, /^Moved Projects\/Roadmap\.md to Trash \(\d+-\d+\)\n$/);
  const listed = commonink(vault, ["trash"]).stdout;
  assert.match(listed, /^\d+-\d+  Projects\/Roadmap\.md — deleted \d{4}-\d{2}-\d{2} \d{2}:\d{2} by Planner for you, gone for good \d{4}-\d{2}-\d{2}\n$/);
  assert.equal(commonink(vault, ["trash", "restore", listed.split(" ")[0]]).stdout, "Restored Projects/Roadmap.md\n");
  assert.equal(commonink(vault, ["trash"]).stdout, "Trash is empty.\n");
  assert.equal(commonink(vault, ["trash", "empty"]).stderr, 'trash takes restore, not "empty"\n');
});

test("contacts: add, list with filters, read, change, import a file and merge", () => {
  const vault = tempVault();
  assert.equal(commonink(vault, ["contact", "add", "Jane Doe", "--email", "jane@acme.com", "--company", "Acme", "--tag", "client"]).stdout, "Created People/Jane Doe.md. Link to them with [[People/Jane Doe]].\n");
  fs.writeFileSync(path.join(vault, "Call.md"), "# Call\n\nWith [[People/Jane Doe]].\n");
  assert.match(commonink(vault, ["contacts", "--company", "acme"]).stdout, /^People\/Jane Doe\.md — Jane Doe · Acme · jane@acme\.com #client · last mentioned \d{4}-\d\d-\d\d \(1 note\)\n$/);
  assert.equal(commonink(vault, ["contacts", "--tag", "vendor"]).stdout, "No contacts match. People are notes in People/; `commonink contact add <name>` makes one.\n");
  assert.match(commonink(vault, ["contact", "Jane Doe"]).stdout, /^# Jane Doe \(People\/Jane Doe\.md\)\nemail: jane@acme\.com\ncompany: Acme\ntags: #client\n\nMentioned in:\n- \S+ Call\.md:3 With \[\[People\/Jane Doe\]\]\.\n$/);
  assert.match(commonink(vault, ["contact", "Jane Doe", "--role", "CTO", "--phone", "555-0100,555-0199"]).stdout, /^Updated People\/Jane Doe\.md/);
  assert.match(fs.readFileSync(path.join(vault, "People/Jane Doe.md"), "utf8"), /phone: \[555-0100, 555-0199\]\ncompany: Acme\nrole: CTO/);
  const file = path.join(vault, "..", `import-${path.basename(vault)}.vcf`);
  fs.writeFileSync(file, "BEGIN:VCARD\nFN:Sam Lee\nEMAIL:sam@x.org\nEND:VCARD\n");
  assert.equal(commonink(vault, ["contacts", "import", file]).stdout, "Created 1: People/Sam Lee.md\n");
  assert.equal(commonink(vault, ["contacts", "import", file, "--format", "xlsx"]).stderr, '--format must be vcard or csv, not "xlsx"\n');
  assert.equal(commonink(vault, ["contacts", "merge", "Jane Doe", "Sam Lee"]).stdout, "Merged People/Sam Lee.md into People/Jane Doe.md (it's in Trash). Links updated in 0 notes.\n");
  assert.equal(commonink(vault, ["contact", "add"]).stderr, "contact add needs <name>\n");
});

test("tasks --assignee me and --by me", () => {
  const vault = tempVault();
  fs.writeFileSync(path.join(vault, "Mine.md"), "- [ ] Water plants @me\n- [ ] Call the bank @sam\n");
  commonink(vault, ["read", "Mine"]); // indexed; the file came from outside, so no one made it
  assert.match(commonink(vault, ["tasks", "--assignee", "me"]).stdout, /Water plants @me/);
  assert.doesNotMatch(commonink(vault, ["tasks", "--assignee", "me"]).stdout, /Call the bank/);
  commonink(vault, ["create", "Given", "- [ ] Send the deck @priya\n"]);
  assert.match(commonink(vault, ["tasks", "--by", "me"]).stdout, /Send the deck @priya/);
  assert.doesNotMatch(commonink(vault, ["tasks", "--by", "me"]).stdout, /Call the bank/, "a file made outside the app has no author");
});

test("templates and new --template", () => {
  const vault = tempVault();
  fs.mkdirSync(path.join(vault, "Templates"));
  fs.writeFileSync(path.join(vault, "Templates/Meeting.md"), "---\ntitle: \"{{date}} {{ask:Client}}\"\nfolder: Meetings\napplies_to: Meetings/\n---\n# {{title}}\n\n**Attendees:** {{ask:Attendees}}\n\n- {{cursor}}\n");
  assert.match(commonink(vault, ["templates"]).stdout, /Templates\/Meeting\.md — Meeting · asks: Client, Attendees/);
  const r = commonink(vault, ["new", "--template", "Meeting", "--var", "Client=Acme", "--var", "Attendees=Sam, Lee"]);
  assert.match(r.stdout, /^Created Meetings\/\d{4}-\d\d-\d\d Acme\.md from Templates\/Meeting\.md\.\n$/);
  const made = fs.readdirSync(path.join(vault, "Meetings"))[0];
  assert.match(fs.readFileSync(path.join(vault, "Meetings", made), "utf8"), /\*\*Attendees:\*\* Sam, Lee/);
  assert.equal(commonink(vault, ["new", "--template", "Meeting", "--var", "oops"]).stderr, "--var takes Name=value, not \"oops\"\n");
  assert.equal(commonink(vault, ["new"]).stderr, "new needs --template <name>\n");
});

test("calendars: an empty vault says how to subscribe, and a private address is refused and not kept", () => {
  const vault = tempVault();
  assert.equal(commonink(vault, ["events", "--from", "2026-10-05", "--tz", "UTC"]).stdout, "0 events, Mon, Oct 5 to Sun, Oct 11 (UTC). This workspace has no calendars yet: subscribe to an ICS feed from the Calendar page.\n");
  const add = commonink(vault, ["calendars", "add", "http://127.0.0.1:9/cal.ics"]);
  assert.deepEqual([add.status, add.stderr], [1, "That address isn't on the public internet\n"]);
  assert.equal(commonink(vault, ["calendars"]).stdout, "No calendars. Subscribe to an ICS or webcal feed: commonink calendars add <url>\n");
  assert.equal(commonink(vault, ["event", "nope"]).stderr, "No event nope; commonink events (list_events) lists them with their ids\n");
});

test("login opens the whole sign-in address, &s and all, and only a web address, with no shell in between", () => {
  const url = "https://commonink.app/oauth/authorize?response_type=code&client_id=c&state=s";
  assert.deepEqual(browserCommand(url, "win32"), ["rundll32", ["url.dll,FileProtocolHandler", url]]);
  assert.deepEqual(browserCommand(url, "darwin"), ["open", [url]]);
  assert.deepEqual(browserCommand(url, "linux"), ["xdg-open", [url]]);
  // A server's discovery document names the address, so it may try to be a command.
  for (const bad of ["file:///etc/passwd", "calc.exe", "javascript:alert(1)", "-a Terminal", ""]) assert.equal(browserCommand(bad, "win32"), null, bad);
});

test("import of a folder adds up sizes before reading: too big is refused unread, other files and node_modules aren't loaded", () => {
  const vault = tempVault();
  const src = fs.mkdtempSync(path.join(os.tmpdir(), "commonink-import-"));
  fs.writeFileSync(path.join(src, "a.md"), "# A\n");
  // Sparse files: gigabytes on paper, nothing on disk. Reading one whole would fail (or take gigabytes).
  fs.writeFileSync(path.join(src, "movie.mkv"), "");
  fs.truncateSync(path.join(src, "movie.mkv"), 3 * 1024 ** 3);
  fs.mkdirSync(path.join(src, "node_modules/pkg"), { recursive: true });
  fs.writeFileSync(path.join(src, "node_modules/pkg/README.md"), "# pkg\n");
  fs.writeFileSync(path.join(src, "node_modules/pkg/big.mp4"), "");
  fs.truncateSync(path.join(src, "node_modules/pkg/big.mp4"), 3 * 1024 ** 3);
  const ok = commonink(vault, ["import", src]);
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(ok.stdout, "Imported 1 new note.\nLeft out: movie.mkv (not a note or a file type the vault keeps)\n");
  assert.ok(!fs.existsSync(path.join(vault, "node_modules")));

  fs.writeFileSync(path.join(src, "talk.mp4"), "");
  fs.truncateSync(path.join(src, "talk.mp4"), 3 * 1024 ** 3);
  const big = commonink(vault, ["import", src]);
  assert.equal(big.status, 1);
  assert.equal(big.stderr, "That's more than 100 MB: import a folder at a time\n");

  // A file that's there but can't be read isn't "no file", and fails.
  const single = commonink(vault, ["import", path.join(src, "talk.mp4")]);
  assert.equal(single.status, 1);
  assert.match(single.stderr, /^Can't read .*talk\.mp4: /);
  assert.doesNotMatch(single.stderr, /There's no file|\n {4}at /);
  assert.equal(commonink(vault, ["import", path.join(src, "nope.md")]).stderr, `There's no file at ${path.join(src, "nope.md")}\n`);
});

test("zipFolder refuses past its limit before reading, and puts left-out files in empty", () => {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), "commonink-zip-"));
  fs.writeFileSync(path.join(src, "a.md"), "# A\n");
  fs.writeFileSync(path.join(src, "notes.xyz"), "x".repeat(5000));
  const set = readImport([{ name: "src.zip", bytes: zipFolder(src, 1024 * 1024) }]);
  assert.deepEqual(set.notes.map((n) => n.path), ["a.md"]);
  assert.deepEqual(set.ignored.map((i) => i.path), ["notes.xyz"]);
  fs.writeFileSync(path.join(src, "pic.png"), "");
  fs.truncateSync(path.join(src, "pic.png"), 2 * 1024 * 1024);
  assert.throws(() => zipFolder(src, 1024 * 1024), { message: "That's more than 1 MB: import a folder at a time" });
});
