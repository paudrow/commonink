// Decisions: an agent asks (ask_decision), the person answers on the Today page or with the CLI, and
// the answer is written into that day's journal note.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { openTempVault, tempVault } from "./helpers.ts";
import { agentSource } from "../src/core/actor.ts";
import { answerText, askSpec, checkValue, journalLines, optionOf, parseAnswer, type Decision } from "../src/core/decisions.ts";

const AGENT = agentSource("Claude Code", "you");

test("asking, answering and recording a decision in the journal note", () => {
  const { vault, dir } = openTempVault({ "Sync design.md": "# Sync design\n", "Journal/2026-10-02.md": "# 2026-10-02\n\n## Tasks\n\n- [ ] Walk\n\n## Log\n\nMorning.\n" });
  const d = vault.askDecision({ question: "Postgres or SQLite for sync?", options: ["Postgres", "SQLite"], recommended: ["2"], context: "SQLite is simpler.", note: "Sync design" }, AGENT);
  assert.equal(d.status, "open");
  assert.equal(d.agent, "Claude Code");
  assert.equal(d.note, "Sync design.md");
  assert.deepEqual(vault.decisions().map((x) => x.id), [d.id]);

  const r = vault.answerDecision(d.id, { value: { choice: 1 }, comment: "Fewer moving parts.\nWe can move later." }, "you", "2026-10-02");
  assert.equal(r.decision.status, "answered");
  assert.equal(r.decision.answer, "SQLite");
  assert.equal(r.decision.journal, "Journal/2026-10-02.md");
  assert.equal(
    fs.readFileSync(path.join(dir, "Journal/2026-10-02.md"), "utf8"),
    "# 2026-10-02\n\n## Tasks\n\n- [ ] Walk\n\n## Log\n\nMorning.\n\n## Decisions\n\n" +
      "- Postgres or SQLite for sync? **SQLite** (asked by Claude Code, about [[Sync design]])\n  Fewer moving parts.\n  We can move later.\n",
  );
  assert.deepEqual(vault.decisions(), [], "no longer open");
  assert.deepEqual(vault.decisions({ status: "settled" }).map((x) => x.answer), ["SQLite"]);
  assert.throws(() => vault.answerDecision(d.id, { value: { choice: 0 } }, "you", "2026-10-02"), /already answered: SQLite/);

  // A second one goes under the first; a dismissed one says so; a day with no note gets one.
  const e = vault.askDecision({ question: "Name it ink?" }, AGENT);
  vault.answerDecision(e.id, { value: { text: "commonink, keep it" } }, "you", "2026-10-02");
  const f = vault.askDecision({ question: "Rewrite the parser?", options: ["Yes", "No"] }, AGENT);
  vault.answerDecision(f.id, { dismiss: true }, "you", "2026-10-03");
  assert.match(fs.readFileSync(path.join(dir, "Journal/2026-10-02.md"), "utf8"), /We can move later\.\n- Name it ink\? \*\*commonink, keep it\*\* \(asked by Claude Code\)\n$/);
  assert.match(fs.readFileSync(path.join(dir, "Journal/2026-10-03.md"), "utf8"), /## Decisions\n\n- Rewrite the parser\? _Not deciding_ \(asked by Claude Code\)\n$/);
});

test("changing an answer rewrites its lines where they were recorded", () => {
  const day = "Journal/2026-10-02.md";
  const { vault, dir } = openTempVault({ [day]: "# 2026-10-02\n\n## Log\n\nMorning.\n" });
  const read = (rel = day) => fs.readFileSync(path.join(dir, rel), "utf8");
  const ask = (q: Parameters<typeof vault.askDecision>[0]) => vault.askDecision(q, AGENT);
  const db = ask({ question: "Postgres or SQLite?", options: ["Postgres", "SQLite"] });
  const talks = ask({ question: "Which talks?", kind: "rows", rows: ["Keynote", "Panel"], options: ["Go", "Skip"] });
  const name = ask({ question: "Name it ink?", kind: "yes_no" });
  vault.answerDecision(db.id, { value: { choice: 1 }, comment: "Simpler." }, "you", "2026-10-02");
  vault.answerDecision(talks.id, { value: { rows: [0, 1] } }, "you", "2026-10-02");
  vault.answerDecision(name.id, { dismiss: true }, "you", "2026-10-02");
  assert.match(read(), /- Postgres or SQLite\? \*\*SQLite\*\* \(asked by Claude Code\)\n  Simpler\.\n- Which talks\? \(asked by Claude Code\)\n  - Keynote: \*\*Go\*\*\n  - Panel: \*\*Skip\*\*\n- Name it ink\? _Not deciding_/);

  // In place: the comment goes with the old answer, the rows are rewritten, and the others stay put.
  const r = vault.answerDecision(db.id, { value: { choice: 0 }, change: true }, "you", "2026-10-02");
  assert.equal(r.decision.answer, "Postgres");
  assert.equal(r.line, 9);
  vault.answerDecision(talks.id, { value: { rows: [1, 0] }, comment: "Swapped.", change: true }, "you", "2026-10-02");
  vault.answerDecision(name.id, { value: { choice: 0 }, change: true }, "you", "2026-10-02");
  assert.equal(
    read(),
    "# 2026-10-02\n\n## Log\n\nMorning.\n\n## Decisions\n\n" +
      "- Postgres or SQLite? **Postgres** (asked by Claude Code)\n" +
      "- Which talks? (asked by Claude Code)\n  - Keynote: **Skip**\n  - Panel: **Go**\n  Swapped.\n" +
      "- Name it ink? **Yes** (asked by Claude Code)\n",
  );
  assert.equal(vault.decision(name.id).status, "answered");

  // Changed on a later day, it's rewritten in the note it was recorded in.
  vault.answerDecision(db.id, { value: { text: "Neither" }, change: true }, "you", "2026-10-03");
  assert.match(read(), /^- Postgres or SQLite\? \*\*Neither\*\* \(asked by Claude Code\)$/m);
  assert.equal(fs.existsSync(path.join(dir, "Journal/2026-10-03.md")), false);
  assert.equal(vault.decision(db.id).journal, day);

  // When its lines were edited away, the new answer goes in that day's note instead.
  fs.writeFileSync(path.join(dir, day), "# 2026-10-02\n");
  vault.sync();
  const moved = vault.answerDecision(name.id, { value: { choice: 1 }, change: true }, "you", "2026-10-03");
  assert.equal(moved.decision.journal, "Journal/2026-10-03.md");
  assert.match(read("Journal/2026-10-03.md"), /- Name it ink\? \*\*No\*\*/);
  assert.throws(() => vault.answerDecision(name.id, { value: { choice: 0 } }, "you"), /already answered: No/, "changing needs asking for it");
});

test("a text question can carry the agent's suggested words, commas and all", () => {
  assert.deepEqual(askSpec({ question: "Name it?", recommended: ["Common Ink", "the app"] }).recommended, { text: "Common Ink, the app" });
  assert.deepEqual(askSpec({ question: "Name it?", recommended: { text: "Ink" } }).recommended, { text: "Ink" });
});

test("bad questions are refused, and withdrawn ones leave the list", () => {
  const { vault } = openTempVault({});
  assert.throws(() => vault.askDecision({ question: " " }, AGENT), /Say what the question is/);
  assert.throws(() => vault.askDecision({ question: "Q?", options: ["Only"] }, AGENT), /two or more options/);
  assert.throws(() => vault.askDecision({ question: "Q?", options: ["A", "a"] }, AGENT), /say the same thing/);
  assert.throws(() => vault.askDecision({ question: "Q?", options: ["A", "B"], recommended: ["3"] }, AGENT), /recommended: "3" isn't one of the options|recommended must be one of the options/);
  assert.throws(() => vault.askDecision({ question: "Q?", note: "Nope" }, AGENT), /Nope/);
  const d = vault.askDecision({ question: "Q?", options: ["A", "B"] }, AGENT);
  assert.throws(() => vault.answerDecision(d.id, { value: { choice: 5 } }, "you"), /from 1 to 2/);
  assert.equal(vault.withdrawDecision(d.id).status, "withdrawn");
  assert.deepEqual(vault.decisions(), []);
  assert.throws(() => vault.answerDecision(d.id, { value: { choice: 0 } }, "you"), /withdrawn/);
});

test("an answer typed as text picks an option by number or words", () => {
  assert.equal(optionOf(["Postgres", "SQLite"], "2"), 1);
  assert.equal(optionOf(["Postgres", "SQLite"], " sqlite "), 1);
  assert.equal(optionOf(["Postgres", "SQLite"], "3"), null);
  assert.equal(optionOf(["Postgres", "SQLite"], "Neither"), null);
  const base: Decision = { id: "x", kind: "text", question: "Bold *this*?", context: null, options: [], rows: [], media: [], min: null, max: null, labels: null, recommended: null, note: null, status: "answered", asked_at: 0, asked_by: "Ann", agent: null, value: null, comment: null, answered_at: 0, answered_by: "you", journal: null, answer: null };
  assert.deepEqual(journalLines({ ...base, answer: "a*b" }), ["- Bold *this*? **a\\*b** (asked by Ann)"]);
});

test("each kind of question: what it takes, how an answer reads, and how it's written down", () => {
  const { vault, dir } = openTempVault({ "assets/a.png": "x" });
  const ask = (q: Parameters<typeof vault.askDecision>[0]) => vault.askDecision(q, AGENT);
  const answer = (id: string, value: unknown, comment?: string) => vault.answerDecision(id, { value, comment }, "you", "2026-10-02").decision;

  const yes = ask({ question: "Merge the docs PR?", kind: "yes_no", recommended: ["yes"] });
  assert.deepEqual(yes.options.map((o) => o.label), ["Yes", "No"]);
  assert.deepEqual(yes.recommended, { choice: 0 });
  assert.equal(answer(yes.id, { choice: 1 }).answer, "No");

  const many = ask({ question: "Which to pack?", kind: "many", options: ["Tent", "Stove", "Rope"], max: 2, recommended: ["1", "Rope"] });
  assert.deepEqual(many.recommended, { choices: [0, 2] });
  assert.throws(() => answer(many.id, { choices: [0, 1, 2] }), /at most 2/);
  assert.equal(answer(many.id, { choices: [2, 0, 0] }).answer, "Tent, Rope");

  const rows = ask({ question: "Which talks?", kind: "rows", rows: ["Keynote", "Rust at scale", "Lunch panel"], options: ["Go", "Maybe", "Skip"], recommended: ["Keynote=Go"] });
  assert.deepEqual(rows.recommended, { rows: [0, null, null] });
  const r = answer(rows.id, { rows: [0, 2, null] }, "Lunch is with Sam.");
  assert.equal(r.answer, "Keynote: Go; Rust at scale: Skip; Lunch panel: no answer");

  const cmp = ask({ question: "Which logo?", kind: "compare", options: ["A", "B"], images: { A: "assets/a.png", b: "https://example.com/b.png" }, details: { A: "Rounder" } });
  assert.deepEqual(cmp.options, [{ label: "A", detail: "Rounder", image: "assets/a.png" }, { label: "B", image: "https://example.com/b.png" }]);
  assert.equal(answer(cmp.id, { choice: 1 }).answer, "B");

  const rank = ask({ question: "Order the launch work", kind: "rank", options: ["Docs", "Bugs", "Blog"], media: ["https://example.com/plan.png"] });
  assert.deepEqual(rank.media, ["https://example.com/plan.png"]);
  assert.throws(() => answer(rank.id, { order: [0, 0, 1] }), /each once/);
  assert.throws(() => answer(rank.id, { text: "whatever" }), /answered with an order/);
  assert.equal(answer(rank.id, { order: [1, 0, 2] }).answer, "1. Bugs, 2. Docs, 3. Blog");

  const scale = ask({ question: "How ready is the beta?", kind: "scale", labels: ["Not at all", "Ship it"], recommended: ["4"] });
  assert.deepEqual([scale.min, scale.max, scale.recommended], [1, 5, { scale: 4 }]);
  assert.throws(() => answer(scale.id, { scale: 6 }), /from 1 to 5/);
  assert.equal(answer(scale.id, { scale: 5 }).answer, "5 of 1–5 (Ship it)");

  // Every kind but rank and scale takes an answer in the person's own words.
  const own = ask({ question: "Lunch?", options: ["Tacos", "Ramen"] });
  assert.equal(answer(own.id, { text: "Leftovers" }).answer, "Leftovers");

  const note = fs.readFileSync(path.join(dir, "Journal/2026-10-02.md"), "utf8");
  assert.match(note, /- Merge the docs PR\? \*\*No\*\* \(asked by Claude Code\)\n/);
  assert.match(note, /- Which talks\? \(asked by Claude Code\)\n  - Keynote: \*\*Go\*\*\n  - Rust at scale: \*\*Skip\*\*\n  - Lunch panel: _no answer_\n  Lunch is with Sam\.\n/);
  assert.match(note, /- Order the launch work \*\*1\. Bugs, 2\. Docs, 3\. Blog\*\*/);
  assert.match(note, /- How ready is the beta\? \*\*5 of 1–5 \(Ship it\)\*\*/);
});

test("questions that don't fit their kind are refused", () => {
  assert.throws(() => askSpec({ question: "Q?", kind: "rows", options: ["Go", "Skip"] }), /Say the rows/);
  assert.throws(() => askSpec({ question: "Q?", rows: ["x"], options: ["A", "B"] }), /Only a "rows" question has rows/);
  assert.throws(() => askSpec({ question: "Q?", kind: "scale", options: ["A", "B"] }), /has no options/);
  assert.throws(() => askSpec({ question: "Q?", kind: "scale", min: 1, max: 30 }), /1 to 10 steps/);
  assert.throws(() => askSpec({ question: "Q?", kind: "one", options: ["A", "B"], min: 1 }), /Only "many" and "scale"/);
  assert.throws(() => askSpec({ question: "Q?", options: ["A", "B"], images: { C: "x.png" } }), /No option "C"/);
  assert.throws(() => askSpec({ question: "Q?", options: ["A", "B"], images: { A: "javascript:alert(1)" } }), /isn't a picture/);
  assert.throws(() => askSpec({ question: "Q?", media: ["http://example.com/x.png"] }), /isn't a picture/);
  assert.throws(() => askSpec({ question: "Q?", kind: "nope" as never, options: ["A", "B"] }), /"kind" must be one of/);
});

test("answers written as words, as the CLI and recommended take them", () => {
  const shape = (q: Parameters<typeof askSpec>[0]) => askSpec(q);
  const one = shape({ question: "Q?", options: ["No, Monday", "Yes"] });
  assert.deepEqual(parseAnswer(one, "no, monday"), { choice: 0 });
  assert.deepEqual(parseAnswer(one, "Tuesday"), { text: "Tuesday" });
  assert.deepEqual(parseAnswer(shape({ question: "Q?", kind: "yes_no" }), "y"), { choice: 0 });
  const rows = shape({ question: "Q?", kind: "rows", rows: ["Keynote", "Panel"], options: ["Go", "Skip"] });
  assert.deepEqual(parseAnswer(rows, "Go, Skip"), { rows: [0, 1] });
  assert.deepEqual(parseAnswer(rows, "panel=skip"), { rows: [null, 1] });
  assert.throws(() => parseAnswer(rows, "Go"), /each of the 2 rows/);
  const rank = shape({ question: "Q?", kind: "rank", options: ["A", "B", "C"] });
  assert.deepEqual(parseAnswer(rank, "c,a,b"), { order: [2, 0, 1] });
  assert.throws(() => parseAnswer(rank, "c,a"), /all 3 options/);
  assert.deepEqual(checkValue(shape({ question: "Q?", kind: "many", options: ["A", "B"] }), { choices: [1, 0, 1] }), { choices: [0, 1] });
  assert.equal(answerText(one, { choice: 1 }), "Yes");
});

// ------------------------------------------------------------------ CLI and MCP

const BIN = path.resolve(import.meta.dirname, "../bin/commonink");

function commonink(vault: string, args: string[]) {
  const env: NodeJS.ProcessEnv = { ...process.env, COMMONINK_VAULT: vault };
  delete env.COMMONINK_AGENT;
  const r = spawnSync(BIN, args, { env, encoding: "utf8" });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

let client: Client;
let vault: string;
before(async () => {
  vault = tempVault({ "Spec.md": "# Spec\n" });
  const env = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined && e[0] !== "COMMONINK_AGENT"));
  client = new Client({ name: "test-agent", version: "1.0.0" });
  await client.connect(new StdioClientTransport({ command: BIN, args: ["mcp"], env: { ...env, COMMONINK_VAULT: vault } }));
});
after(() => client?.close());

async function call(name: string, args: Record<string, unknown>) {
  const r = (await client.callTool({ name, arguments: args })) as { content: Array<{ text: string }>; isError?: boolean };
  return { text: r.content.map((c) => c.text).join("\n"), isError: !!r.isError };
}

test("an agent asks over MCP, the person answers with the CLI, and the agent reads the answer", async () => {
  const asked = await call("ask_decision", { question: "Ship on Friday?", options: ["Yes", "No, Monday"], recommended: ["2"], note: "Spec" });
  assert.ok(!asked.isError, asked.text);
  const id = asked.text.match(/^Asked \[([a-z2-9]{8})\]/)![1];
  assert.match(asked.text, /2\. No, Monday \(recommended\)/);
  assert.match((await call("list_decisions", {})).text, new RegExp(`^\\[${id}\\] Ship on Friday\\? \\(pick one\\)\\n  1\\. Yes\\n  2\\. No, Monday \\(recommended\\)\\n  Open, asked by test-agent \\(via you\\)`));

  assert.match(commonink(vault, ["decisions"]).stdout, /Ship on Friday\?/);
  const answered = commonink(vault, ["decision", "answer", id, "no,", "monday", "--comment", "QA needs a day"]);
  assert.equal(answered.status, 0, answered.stderr);
  assert.match(answered.stdout, /^Decided: No, Monday\. Recorded in Journal\/\d{4}-\d\d-\d\d\.md\.\n$/);

  const read = await call("list_decisions", { ids: [id] });
  assert.match(read.text, /Answer: No, Monday \(option 2\)\n  Comment: QA needs a day\n  By you \d{4}-\d\d-\d\d \d\d:\d\d UTC, recorded in Journal\//);
  assert.equal((await call("withdraw_decision", { id })).isError, true, "a settled one can't be withdrawn");
  assert.equal(commonink(vault, ["decision", "answer", id, "1"]).status, 4, "conflict");
  const changed = commonink(vault, ["decision", "answer", id, "1", "--change"]);
  assert.equal(changed.status, 0, changed.stderr);
  assert.match(changed.stdout, /^Changed to: Yes\. Recorded in Journal\//);
  assert.match((await call("list_decisions", { ids: [id] })).text, /Answer: Yes \(option 1\)/);
});

test("an agent reads what's open, what's been decided lately, and the comments", async () => {
  const ask = async (question: string) => (await call("ask_decision", { question, options: ["Yes", "No"] })).text.match(/^Asked \[([a-z2-9]{8})\]/)![1];
  const a = await ask("Rename the folder to Archive?");
  const b = await ask("Turn on weekly recaps?");
  await ask("Move standup to Tuesday?");
  assert.equal(commonink(vault, ["decision", "answer", a, "yes", "--comment", "It reads clearer"]).status, 0);
  assert.equal(commonink(vault, ["decision", "answer", b, "no"]).status, 0);

  const decided = (await call("list_decisions", { status: "answered", since: "today" })).text;
  assert.match(decided, /Rename the folder to Archive\?/);
  assert.match(decided, /Turn on weekly recaps\?/);
  assert.doesNotMatch(decided, /Move standup/);
  const commented = await call("list_decisions", { commented: true, since: "7d" });
  assert.match(commented.text, /^\[\w+\] Rename the folder to Archive\? \(pick one\)\n  Answer: Yes \(option 1\)\n  Comment: It reads clearer\n/);
  assert.doesNotMatch(commented.text, /weekly recaps/);
  assert.match((await call("list_decisions", { query: "standup tuesday" })).text, /Open, asked by/, "words search every status");
  assert.equal((await call("list_decisions", { query: "nothing like this" })).text, "No decisions match.");
  assert.equal((await call("list_decisions", { since: "2999-01-01" })).text, "No decisions match.");
  assert.equal((await call("list_decisions", { since: "soon" })).isError, true);

  const cli = commonink(vault, ["decisions", "--status", "answered", "--since", "1d", "--json"]);
  assert.equal(cli.status, 0, cli.stderr);
  assert.ok((JSON.parse(cli.stdout) as Array<{ id: string }>).some((d) => d.id === b));
  assert.match(commonink(vault, ["decisions", "--commented"]).stdout, /It reads clearer/);
});

test("an agent asks which events to go to, with a choice for each, and the CLI answers row by row", async () => {
  const asked = await call("ask_decision", { question: "Which talks?", kind: "rows", rows: ["Keynote", "Panel"], options: ["Go", "Skip"], images: { Go: "https://example.com/go.png" } });
  assert.ok(!asked.isError, asked.text);
  const id = asked.text.match(/^Asked \[([a-z2-9]{8})\]/)![1];
  assert.match(asked.text, /Which talks\? \(a choice for each row\)\n  Row: Keynote\n  Row: Panel\n  1\. Go\n  2\. Skip/);
  const r = commonink(vault, ["decision", "answer", id, "Go,Skip"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^Decided: Keynote: Go; Panel: Skip\./);
  const bad = await call("ask_decision", { question: "Q?", kind: "scale", min: 1, max: 50 });
  assert.equal(bad.isError, true);
});
