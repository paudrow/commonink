import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { openVault } from "../src/core/local.ts";
import { tempVault } from "./helpers.ts";

const BIN = path.resolve(import.meta.dirname, "../bin/commonink");
let vault: string;
let client: Client;

before(async () => {
  vault = tempVault();
  const env = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined && e[0] !== "COMMONINK_AGENT"));
  client = new Client({ name: "test-agent", version: "1.0.0" });
  await client.connect(new StdioClientTransport({ command: BIN, args: ["mcp"], env: { ...env, COMMONINK_VAULT: vault } }));
});

after(() => client.close());

async function call(name: string, args: Record<string, unknown>) {
  const r = (await client.callTool({ name, arguments: args })) as { content: Array<{ text: string }>; isError?: boolean };
  return { text: r.content.map((c) => c.text).join("\n"), isError: !!r.isError };
}

test("the server calls itself commonink", () => {
  assert.equal(client.getServerVersion()?.name, "commonink");
});

test("the server lists every tool", async () => {
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), [
    "add_card", "add_task", "append_to_note", "archive_note", "ask_decision", "backlinks", "create_contact", "create_from_template", "create_meeting_note", "create_note",
    "delete_folder", "delete_note", "delete_smart_folder", "diff_versions", "edit_card", "edit_note", "export_note", "get_event", "get_today",
    "import_contacts", "import_notes", "label_version", "list_contacts", "list_decisions", "list_events", "list_folders", "list_labels", "list_notes", "list_smart_folders", "list_tags",
    "list_tasks", "list_templates", "list_trash", "merge_contacts", "missing_links", "move_card", "move_note", "move_task", "open_journal", "order_favorites",
    "read_board", "read_contact", "read_note", "recent_changes", "remove_task", "rename_folder", "rename_tag", "replace_text", "restore_change", "restore_from_trash", "restore_label",
    "save_smart_folder", "search_notes", "set_asset_tags", "show_change", "star_note", "star_smart_folder", "star_tag", "unarchive_note", "unstar_note", "unstar_smart_folder", "unstar_tag",
    "update_contact", "update_task", "withdraw_decision", "workspace_checkup", "write_note",
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
  assert.match((await call("recent_changes", { path: "Launch.md", limit: 1 })).text, /test-agent for you: edited Launch\.md \(\+1 −1\)$/);
  assert.deepEqual(await call("move_card", { path: "Launch", card: "nope", to_column: "Done" }), { text: 'No card in Launch.md matches "nope"', isError: true });
});

test("agents add a task from words, to today's journal note or a named note, and move one", async () => {
  const today = new Date().toLocaleDateString("en-CA");
  const r = await call("add_task", { text: "Renew the domain every year on mar 1 !high" });
  assert.match(r.text, new RegExp(`^Added "- \\[ \\] Renew the domain !high due:\\d{4}-03-01 rec:mar-1" to Journal/${today}\\.md:5$`));
  const to = await call("add_task", { text: "Draft the agenda → [[Roadmap]]" });
  assert.equal(to.text, 'Added "- [ ] Draft the agenda" to Projects/Roadmap.md:10');
  assert.equal((await call("move_task", { path: "Roadmap", line: 10, text: "Draft the agenda", to: `Journal/${today}` })).text, `Moved "Draft the agenda" to Journal/${today}.md:6`);
  assert.equal((await call("add_task", { text: "tomorrow" })).isError, true);
});

test("an argument a tool doesn't take is refused, naming it and the ones it does, and nothing is written", async () => {
  const before = fs.readdirSync(vault, { recursive: true }).length;
  const r = await call("add_task", { text: "Book the venue for the offsite", to: "Projects/Plan" });
  assert.equal(r.isError, true);
  assert.match(r.text, /add_task has no argument `to`\. It takes: text\. .*→ \[\[Note\]\]/);
  assert.equal(fs.readdirSync(vault, { recursive: true }).length, before);
  assert.equal((await call("search_notes", { query: "offsite" })).text.includes("venue"), false);
  assert.match((await call("list_tags", { bogus: 1, other: 2 })).text, /list_tags has no argument `bogus`, `other`\. It takes/);
});

test("agents read the day: overdue, due today, starting today, and the journal note", async () => {
  const text = (await call("get_today", { today: "2026-10-05" })).text;
  assert.match(text, /^Monday, October 5, 2026\n\nOverdue \(\d+\)\n/);
  assert.match(text, /\nDue today \(0\)\n- nothing\n/);
  assert.match(text, /\nJournal: Journal\/2026-10-05\.md \(not written yet\)$/);
  assert.equal((await call("get_today", { today: "someday" })).isError, true);
});

test("agents end a repeat with until and times", async () => {
  await call("create_note", { path: "Lessons", content: "# Lessons\n\n- [ ] Piano due:2026-10-01 rec:weekly\n" });
  await call("update_task", { path: "Lessons", line: 3, text: "Piano due:2026-10-01 rec:weekly", times: 2, until: "2026-12-31" });
  assert.match((await call("list_tasks", { note: "Lessons" })).text, /Piano due:2026-10-01 rec:weekly until:2026-12-31 times:2/);
  assert.equal((await call("update_task", { path: "Lessons", line: 3, text: "Piano due:2026-10-01 rec:weekly until:2026-12-31 times:2", until: "soon" })).isError, true);
});

test("agents list tags as a tree and filter notes by a tag and the tags under it", async () => {
  await call("create_note", { path: "Ideas/Plan B", content: "# Plan B\n\nA backup #plan/b for the importer.\n" });
  openVault(vault).addTag("Plan/c"); // added in the app, before any note carries it
  assert.equal((await call("list_tags", {})).text, "- #plan (2 notes)\n  - #plan/b (1 note)\n  - #plan/c (added, not used yet)\n- #q3 (1 note)");
  assert.equal((await call("list_notes", { tag: "plan" })).text, "- Ideas/Plan B.md — Plan B\n- Projects/Roadmap.md — Roadmap");
  assert.equal((await call("search_notes", { query: "importer", tag: "plan/b" })).text, "- Ideas/Plan B.md — Plan B\n    L3: A backup #plan/b for the importer.");
});

test("writes are attributed to the connected client", async () => {
  assert.equal((await call("create_note", { path: "Agent log", content: "# Agent log\n" })).isError, false);
  assert.equal(fs.readFileSync(path.join(vault, "Agent log.md"), "utf8"), "# Agent log\n");
  const changes = await call("recent_changes", { path: "Agent log.md" });
  assert.match(changes.text, /^#\d+ \S+ test-agent for you: created Agent log\.md \(2 lines\)$/);
  assert.equal((await call("recent_changes", { path: "Agent log.md", by: "people" })).text, "No changes.");
  assert.match((await call("recent_changes", { path: "Agent log.md", by: "test-agent" })).text, /test-agent for you: created Agent log\.md/);
});

test("recent_changes counts a run of saves by its net change and says renamed, as History does", async () => {
  await call("create_note", { path: "Churn", content: "# Churn\n\none\ntwo\n" });
  await call("edit_note", { path: "Churn", old_string: "two\n", new_string: "two\nthree\nfour\nfive\nsix\n" });
  await call("edit_note", { path: "Churn", old_string: "one\ntwo\nthree\nfour\nfive\nsix\n", new_string: "ONE\ntwo\nthree\n" });
  await call("edit_note", { path: "Churn", old_string: "three\n", new_string: "three\nfour\n" });
  await call("move_note", { from: "Churn", to: "Churned" });
  const lines = (await call("recent_changes", { path: "Churned.md" })).text.split("\n").map((l) => l.replace(/^#\d+ \S+ /, ""));
  assert.deepEqual(lines, [
    "test-agent for you: renamed Churn.md → Churned.md",
    "test-agent for you: edited Churn.md (+3 −1, 3 saves)",
    "test-agent for you: created Churn.md (5 lines)",
  ]);
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

test("agents save smart folders, list them with counts and list the notes in one", async () => {
  const saved = await call("save_smart_folder", { name: "Q3", query: "tag=q3 sort=title" });
  assert.match(saved.text, /^- Q3 \(1 note\): tag=q3 sort=title \[[a-z2-9]{8}\]$/);
  assert.equal((await call("list_notes", { smart_folder: "q3" })).text, "- Projects/Roadmap.md — Roadmap");
  assert.equal((await call("save_smart_folder", { name: "Bad", query: "sort=size" })).text, '"sort" is modified, date, oldest, title or created, not "size"');
  assert.equal((await call("delete_smart_folder", { smart_folder: "Q3" })).text, "No smart folders.");
});

test("agents star and unstar tags as favorites too", async () => {
  assert.equal((await call("star_tag", { tags: ["#q3"] })).text, "Favorites:\n- #q3 (1 note)");
  assert.equal((await call("unstar_tag", { tags: ["q3"] })).text, "No favorites.");
  assert.equal((await call("star_tag", { tags: ["nowhere"] })).isError, true);
});

test("agents star and unstar notes for the vault's person", async () => {
  assert.equal((await call("star_note", { paths: ["Roadmap", "Welcome"] })).text, "Favorites:\n- Projects/Roadmap.md — Roadmap\n- Welcome.md — Welcome");
  assert.equal((await call("unstar_note", { paths: ["Roadmap"] })).text, "Favorites:\n- Welcome.md — Welcome");
  assert.equal((await call("list_notes", { starred: true })).text, "Favorites:\n- Welcome.md — Welcome");
  assert.equal((await call("star_note", { paths: ["Nope"] })).isError, true);
});

test("an agent's delete goes to Trash, attributed to it, and it has no way to delete for good", async () => {
  await call("create_note", { path: "Scratch", content: "# Scratch\n" });
  const deleted = await call("delete_note", { paths: ["Scratch"] });
  assert.match(deleted.text, /^Moved Scratch\.md to Trash \((\d+-\d+)\)$/);
  assert.match((await call("recent_changes", { limit: 1 })).text, /test-agent for you: deleted Scratch\.md/);
  assert.equal((await call("read_note", { path: "Scratch" })).isError, true);
  // It can see Trash and restore from it, and nothing deletes for good.
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).filter((n) => /trash|purge|forever|empty/.test(n)), ["list_trash", "restore_from_trash"]);
  const id = deleted.text.match(/\((\d+-\d+)\)/)![1];
  assert.match((await call("list_trash", {})).text, new RegExp(`^${id}  Scratch\\.md — deleted .* by test-agent for you`));
  assert.equal((await call("restore_from_trash", { ids: [id] })).text, "Restored Scratch.md");
  assert.equal((await call("read_note", { path: "Scratch" })).isError, false);
});

test("agents keep contacts: create, list, read one with where they're mentioned, update, import and merge", async () => {
  const made = await call("create_contact", { name: "Priya Shah", email: ["priya@initech.com"], company: "Initech", tags: ["client"] });
  assert.equal(made.text, "Created People/Priya Shah.md. Link to them with [[People/Priya Shah]].");
  await call("create_note", { path: "Journal/2026-09-18", content: "# Sep 18\n\nDemo for [[People/Priya Shah]].\n" });
  const list = await call("list_contacts", { company: "initech" });
  assert.equal(list.text, "People/Priya Shah.md — Priya Shah · Initech · priya@initech.com #client · last mentioned 2026-09-18 (1 note)");
  assert.match((await call("list_contacts", { q: "nobody" })).text, /No contacts match/);
  const one = await call("read_contact", { contact: "Priya Shah" });
  assert.equal(one.text, "# Priya Shah (People/Priya Shah.md)\nemail: priya@initech.com\ncompany: Initech\ntags: #client\n\nMentioned in:\n- 2026-09-18 Journal/2026-09-18.md:3 Demo for [[People/Priya Shah]].");
  assert.match((await call("update_contact", { contact: "Priya Shah", role: "VP Eng" })).text, /^Updated People\/Priya Shah\.md/);
  const imported = await call("import_contacts", { format: "vcard", text: "BEGIN:VCARD\nFN:P. Shah\nEMAIL:priya@initech.com\nTEL:555-0142\nEND:VCARD\nBEGIN:VCARD\nFN:Tom Wu\nEND:VCARD\n" });
  assert.equal(imported.text, "Created 1: People/Tom Wu.md\nUpdated 1: People/Priya Shah.md");
  const merged = await call("merge_contacts", { keep: "Priya Shah", drop: "Tom Wu" });
  assert.equal(merged.text, "Merged People/Tom Wu.md into People/Priya Shah.md (it's in Trash). Links updated in 0 notes.");
  assert.equal((await call("read_contact", { contact: "Journal/2026-09-18" })).isError, true);
});

test("agents list the tasks assigned to their person, and the ones their person gave out", async () => {
  await call("create_note", { path: "Assigned", content: "# Assigned\n\n- [ ] Pick up the keys @me\n- [ ] Book the venue @priya\n" });
  assert.match((await call("list_tasks", { assignee: "me" })).text, /Pick up the keys @me/);
  const by = (await call("list_tasks", { by: "me" })).text;
  assert.match(by, /Book the venue @priya/);
  assert.doesNotMatch(by, /Pick up the keys/);
});

test("agents list templates and make notes from them, told what's left to fill in", async () => {
  await call("create_note", { path: "Templates/Meeting", content: "---\ntitle: \"{{date}} {{ask:Client}}\"\nfolder: Meetings\napplies_to: Meetings/\n---\n# {{title}}\n\n**Attendees:** {{ask:Attendees}}\n\n- {{cursor}}\n" });
  assert.match((await call("list_templates", {})).text, /^Templates\/Meeting\.md — Meeting · asks: Client, Attendees · new notes in Meetings\/ start from it$/m);
  const made = await call("create_from_template", { template: "Meeting", variables: { Client: "Initech" } });
  assert.match(made.text, /^Created Meetings\/\d{4}-\d\d-\d\d Initech\.md from Templates\/Meeting\.md\. Still to fill in: \{\{ask:Attendees\}\} \(line 3\)\.$/);
});

test("list_templates says what kind of answer each question takes", async () => {
  await call("create_note", { path: "Templates/Typed", content: "{{ask:Who|people}} {{ask:Due|date}} {{ask:Size|choice:S,M,L}} {{ask:Note}}\n" });
  assert.match((await call("list_templates", {})).text, /^Templates\/Typed\.md — Typed · asks: Who \(people\), Due \(date\), Size \(one of S, M, L\), Note$/m);
});

test("replace_text won't run without dry_run said outright, and previews with dry_run true", async () => {
  await call("create_note", { path: "Typos", content: "# Typos\n\nrecieve the parcel\n" });
  assert.equal((await call("replace_text", { find: "recieve", replace: "receive" })).isError, true);
  const dry = await call("replace_text", { find: "recieve", replace: "receive", dry_run: true });
  assert.match(dry.text, /^Would replace 1 place in 1 note\nTypos\.md \(1\)/);
  assert.equal(fs.readFileSync(path.join(vault, "Typos.md"), "utf8"), "# Typos\n\nrecieve the parcel\n");
  assert.match((await call("replace_text", { find: "recieve", replace: "receive", dry_run: false })).text, /^Replaced 1 place/);
  assert.equal(fs.readFileSync(path.join(vault, "Typos.md"), "utf8"), "# Typos\n\nreceive the parcel\n");
});
