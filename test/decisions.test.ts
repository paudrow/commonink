// Decisions: an agent asks (ask_decision), the person answers on the Today page or with the CLI, and
// the answer is written into that day's daily note.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { openTempVault, tempVault } from "./helpers.ts";
import { agentSource } from "../src/core/actor.ts";
import { journalLines, optionOf, type Decision } from "../src/core/decisions.ts";

const AGENT = agentSource("Claude Code", "you");

test("asking, answering and recording a decision in the daily note", () => {
  const { vault, dir } = openTempVault({ "Sync design.md": "# Sync design\n", "Journal/2026-10-02.md": "# 2026-10-02\n\n## Tasks\n\n- [ ] Walk\n\n## Log\n\nMorning.\n" });
  const d = vault.askDecision({ question: "Postgres or SQLite for sync?", options: ["Postgres", "SQLite"], recommended: 1, context: "SQLite is simpler.", note: "Sync design" }, AGENT);
  assert.equal(d.status, "open");
  assert.equal(d.agent, "Claude Code");
  assert.equal(d.note, "Sync design.md");
  assert.deepEqual(vault.decisions().map((x) => x.id), [d.id]);

  const r = vault.answerDecision(d.id, { choice: 1, comment: "Fewer moving parts.\nWe can move later." }, "you", "2026-10-02");
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
  assert.throws(() => vault.answerDecision(d.id, { choice: 0 }, "you", "2026-10-02"), /already answered: SQLite/);

  // A second one goes under the first; a dismissed one says so; a day with no note gets one.
  const e = vault.askDecision({ question: "Name it ink?" }, AGENT);
  vault.answerDecision(e.id, { text: "commonink, keep it" }, "you", "2026-10-02");
  const f = vault.askDecision({ question: "Rewrite the parser?", options: ["Yes", "No"] }, AGENT);
  vault.answerDecision(f.id, { dismiss: true }, "you", "2026-10-03");
  assert.match(fs.readFileSync(path.join(dir, "Journal/2026-10-02.md"), "utf8"), /We can move later\.\n- Name it ink\? \*\*commonink, keep it\*\* \(asked by Claude Code\)\n$/);
  assert.match(fs.readFileSync(path.join(dir, "Journal/2026-10-03.md"), "utf8"), /## Decisions\n\n- Rewrite the parser\? _Not deciding_ \(asked by Claude Code\)\n$/);
});

test("bad questions are refused, and withdrawn ones leave the list", () => {
  const { vault } = openTempVault({});
  assert.throws(() => vault.askDecision({ question: " " }, AGENT), /Say what the question is/);
  assert.throws(() => vault.askDecision({ question: "Q?", options: ["Only"] }, AGENT), /two or more options/);
  assert.throws(() => vault.askDecision({ question: "Q?", options: ["A", "a"] }, AGENT), /say the same thing/);
  assert.throws(() => vault.askDecision({ question: "Q?", options: ["A", "B"], recommended: 2 }, AGENT), /from 1 to 2/);
  assert.throws(() => vault.askDecision({ question: "Q?", note: "Nope" }, AGENT), /Nope/);
  const d = vault.askDecision({ question: "Q?", options: ["A", "B"] }, AGENT);
  assert.throws(() => vault.answerDecision(d.id, { choice: 5 }, "you"), /from 1 to 2/);
  assert.equal(vault.withdrawDecision(d.id).status, "withdrawn");
  assert.deepEqual(vault.decisions(), []);
  assert.throws(() => vault.answerDecision(d.id, { choice: 0 }, "you"), /withdrawn/);
});

test("an answer typed as text picks an option by number or words", () => {
  assert.equal(optionOf(["Postgres", "SQLite"], "2"), 1);
  assert.equal(optionOf(["Postgres", "SQLite"], " sqlite "), 1);
  assert.equal(optionOf(["Postgres", "SQLite"], "3"), null);
  assert.equal(optionOf(["Postgres", "SQLite"], "Neither"), null);
  const base: Decision = { id: "x", question: "Bold *this*?", context: null, options: [], recommended: null, note: null, status: "answered", asked_at: 0, asked_by: "Ann", agent: null, choice: null, comment: null, answered_at: 0, answered_by: "you", journal: null, answer: null };
  assert.deepEqual(journalLines({ ...base, answer: "a*b" }), ["- Bold *this*? **a\\*b** (asked by Ann)"]);
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
  const asked = await call("ask_decision", { question: "Ship on Friday?", options: ["Yes", "No, Monday"], recommended: 2, note: "Spec" });
  assert.ok(!asked.isError, asked.text);
  const id = asked.text.match(/^Asked \[([a-z2-9]{8})\]/)![1];
  assert.match(asked.text, /2\. No, Monday \(recommended\)/);
  assert.match((await call("list_decisions", {})).text, new RegExp(`^\\[${id}\\] Ship on Friday\\?\\n  1\\. Yes\\n  2\\. No, Monday \\(recommended\\)\\n  Open, asked by test-agent \\(via you\\)`));

  assert.match(commonink(vault, ["decisions"]).stdout, /Ship on Friday\?/);
  const answered = commonink(vault, ["decision", "answer", id, "no,", "monday", "--comment", "QA needs a day"]);
  assert.equal(answered.status, 0, answered.stderr);
  assert.match(answered.stdout, /^Decided: No, Monday\. Recorded in Journal\/\d{4}-\d\d-\d\d\.md\.\n$/);

  const read = await call("list_decisions", { ids: [id] });
  assert.match(read.text, /Answer: No, Monday \(option 2\)\n  Comment: QA needs a day\n  By you, recorded in Journal\//);
  assert.equal((await call("withdraw_decision", { id })).isError, true, "a settled one can't be withdrawn");
  assert.equal(commonink(vault, ["decision", "answer", id, "1"]).status, 4, "conflict");
});
