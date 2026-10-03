// The journeys an agent takes with no one at the screen: through the CLI in a shell, and over MCP.
// The vault's files are the shared ground, so "me" here is a person changing them in their own editor.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tempVault } from "../helpers.ts";
import { commonink, journey, mcpAgent } from "./journey.ts";

journey("An agent keeps meeting notes from the shell", ({ given, when, then, and }) => {
  let vault: string;
  let read: string;
  const scribe = (args: string[], input?: string) => commonink(vault, [...args, "--agent", "Scribe"], input);
  const kickoff = "---\nattendees: [sam, priya]\n---\n# Kickoff\n\nWe agreed on a spring launch.\n\n- [ ] Draft the brief @sam due:2026-10-10\n";
  given("a vault whose Index links to [[Kickoff]], a note not written yet", () => {
    vault = tempVault({ "Index.md": "# Index\n\n- [[Kickoff]]\n" });
  });
  when("Scribe creates Kickoff from stdin, attendees in its YAML front matter and a task for sam", () => {
    const r = scribe(["create", "Kickoff", "-"], kickoff);
    assert.equal(r.status, 0, r.stderr);
  });
  then("the file is exactly the markdown it wrote", () => {
    assert.equal(fs.readFileSync(path.join(vault, "Kickoff.md"), "utf8"), kickoff);
  });
  and("Index's link, missing until now, finds it", () => {
    assert.match(scribe(["backlinks", "Kickoff"]).stdout, /^- Index\.md:3 /m);
    assert.doesNotMatch(scribe(["missing-links"]).stdout, /Kickoff/);
  });
  and("sam's tasks list it, saying where it is", () => {
    assert.equal(scribe(["tasks", "--assignee", "sam"]).stdout, "- [ ] Draft the brief @sam due:2026-10-10 — Kickoff.md:8\n");
  });
  and("search finds the note by a word in it", () => {
    assert.match(scribe(["search", "spring"]).stdout, /^- Kickoff\.md — Kickoff\n\s+L6: We agreed on a spring launch\.$/m);
  });
  when("Scribe reads it, and then I change it in my own editor", () => {
    read = JSON.parse(scribe(["read", "Kickoff", "--json"]).stdout).version;
    fs.writeFileSync(path.join(vault, "Kickoff.md"), kickoff.replace("spring launch", "spring launch, in April"));
  });
  then("Scribe's edit against the version it read is refused, and it's told to read again", () => {
    const r = scribe(["edit", "Kickoff", "--old", "spring", "--new", "early spring", "--base", read]);
    assert.equal(r.status, 4);
    assert.match(r.stderr, /Re-read it and retry/);
  });
  when("Scribe reads it again and retries", () => {
    read = JSON.parse(scribe(["read", "Kickoff", "--json"]).stdout).version;
    const r = scribe(["edit", "Kickoff", "--old", "spring", "--new", "early spring", "--base", read]);
    assert.equal(r.status, 0, r.stderr);
  });
  then("its edit lands on top of mine", () => {
    assert.match(fs.readFileSync(path.join(vault, "Kickoff.md"), "utf8"), /^We agreed on an? early spring launch, in April\.$/m);
  });
  when("Scribe ticks the task and files the note under Meetings", () => {
    assert.equal(scribe(["task", "update", "Kickoff", "8", "--done"]).status, 0);
    assert.equal(scribe(["mv", "Kickoff", "Meetings/Kickoff"]).status, 0);
  });
  then("Index's [[Kickoff]] still finds it", () => {
    assert.match(scribe(["backlinks", "Meetings/Kickoff"]).stdout, /^- Index\.md:3 /m);
  });
  and("the task is done, dated today", () => {
    assert.match(scribe(["tasks", "--status", "done"]).stdout, /^- \[x\] Draft the brief @sam due:2026-10-10 done:\d{4}-\d{2}-\d{2} — Meetings\/Kickoff\.md:8$/m);
  });
  and("History credits Scribe with each of its changes", () => {
    const changes: Array<{ op: string; agent: string | null }> = JSON.parse(scribe(["changes", "--json"]).stdout);
    assert.deepEqual(changes.filter((c) => c.agent).map((c) => `${c.op} by ${c.agent}`), ["move by Scribe", "edit by Scribe", "edit by Scribe", "create by Scribe"]);
  });
  and("History shows my edit, made in my own editor, between them", () => {
    const changes: Array<{ op: string; agent: string | null }> = JSON.parse(scribe(["changes", "--json"]).stdout);
    assert.deepEqual(changes.map((c) => `${c.op} by ${c.agent ?? "someone else"}`), ["move by Scribe", "edit by Scribe", "edit by Scribe", "edit by someone else", "create by Scribe"]);
  });
});

journey("An agent over MCP and one in the shell work from the same notes", ({ given, when, then, and }) => {
  let vault: string;
  let planner: Awaited<ReturnType<typeof mcpAgent>>;
  given("Planner connected over MCP, and Scribe in a shell, on one vault", async () => {
    vault = tempVault({ "Launch.md": "# Launch\n\n## Tasks\n\n- [ ] Pick a date\n" });
    planner = await mcpAgent(vault, "Planner");
  });
  when("Planner adds a task to Launch", async () => {
    const r = await planner("add_task", { text: "Write the announcement due:2026-10-20 @priya → [[Launch]]" });
    assert.equal(r.isError, false, r.text);
  });
  then("Scribe lists it from the shell, as Planner wrote it", () => {
    assert.equal(commonink(vault, ["tasks", "--assignee", "priya"]).stdout, "- [ ] Write the announcement due:2026-10-20 @priya — Launch.md:6\n");
  });
  when("Scribe ticks it", () => {
    const r = commonink(vault, ["task", "update", "Launch", "6", "--done", "--agent", "Scribe"]);
    assert.equal(r.status, 0, r.stderr);
  });
  then("Planner sees it done", async () => {
    assert.match((await planner("list_tasks", { status: "done" })).text, /^- \[x\] Write the announcement due:2026-10-20 @priya done:\d{4}-\d{2}-\d{2} — Launch\.md:6$/);
  });
  and("Planner's view of History names both agents", async () => {
    const r = await planner("recent_changes", { path: "Launch" });
    assert.match(r.text, /Scribe for you/);
    assert.match(r.text, /Planner for you/);
  });
});
