// Marked versions (Quire.mark and friends): a name on a version of a note, to compare with or go back to.
import { test } from "node:test";
import assert from "node:assert/strict";
import { openTempVault } from "./helpers.ts";
import { agentSource } from "../src/core/actor.ts";

const CLAUDE = agentSource("Claude", "you");

function setup() {
  const { quire } = openTempVault({ "Plan.md": "# Plan\n\nDraft one.\n", "Other.md": "# Other\n" });
  const edit = (text: string, source = "you") => quire.save("Plan.md", text, { source }).change!;
  return { quire, edit };
}

test("mark the note as it is now, or as it was after an earlier change, with who and when", () => {
  const { quire, edit } = setup();
  const first = edit("# Plan\n\nDraft two.\n");
  edit("# Plan\n\nDraft three, sent.\n", CLAUDE);
  const now = quire.mark("Plan", "Sent to Alex", "you", { description: "The copy in the email" });
  assert.deepEqual([now.name, now.description, now.path, now.current, now.person, now.agent], ["Sent to Alex", "The copy in the email", "Plan.md", true, "you", null]);
  const past = quire.mark("Plan.md", "v1", CLAUDE, { at: first.id });
  assert.deepEqual([past.change_id, past.current, past.person, past.agent], [first.id, false, "you", "Claude"]);
  assert.equal(quire.markText(past.id).text, "# Plan\n\nDraft two.\n");
  assert.equal(quire.markText("V1", "Plan").text, "# Plan\n\nDraft two.\n", "a mark is found by its name on the note, any case");
  assert.deepEqual(quire.marks("Plan").map((m) => m.name), ["v1", "Sent to Alex"], "newest first");
  assert.deepEqual(quire.marks().map((m) => m.name), ["v1", "Sent to Alex"], "every note's, for History");
  assert.deepEqual(quire.marks("Other"), []);
});

test("a mark needs a name of its own on its note, and marks only notes", () => {
  const { quire } = setup();
  quire.mark("Plan", "v1", "you");
  assert.throws(() => quire.mark("Plan", "  V1 ", "you"), /already has a version marked "V1"/);
  assert.throws(() => quire.mark("Plan", "   ", "you"), /needs a name/);
  assert.throws(() => quire.mark("Plan", "x".repeat(81), "you"), /at most 80 characters/);
  assert.equal(quire.mark("Other", "v1", "you").name, "v1", "the same name on another note is fine");
  assert.throws(() => quire.mark("Plan", "old", "you", { at: 999 }), /isn't a change to Plan\.md/);
});

test("rename a mark, or delete it, and the note and its history stay as they are", () => {
  const { quire, edit } = setup();
  const m = quire.mark("Plan", "v1", "you");
  quire.mark("Plan", "v2", "you");
  assert.equal(quire.renameMark(m.id, "Agreed v1", { description: "With Sam" }).name, "Agreed v1");
  assert.throws(() => quire.renameMark(m.id, "v2"), /already has a version marked "v2"/);
  edit("# Plan\n\nChanged.\n");
  const changes = quire.changes({ path: "Plan" }).length;
  assert.equal(quire.deleteMark("Agreed v1", "Plan").id, m.id);
  assert.deepEqual(quire.marks("Plan").map((x) => x.name), ["v2"]);
  assert.equal(quire.changes({ path: "Plan" }).length, changes, "deleting a mark changes no note");
  assert.throws(() => quire.findMark(m.id), /No marked version/);
});

test("compare a mark with now or with another mark, and restore to one as one change that can be undone", () => {
  const { quire, edit } = setup();
  const v1 = quire.mark("Plan", "v1", "you");
  edit("# Plan\n\nDraft two.\n");
  const v2 = quire.mark("Plan", "v2", "you");
  edit("# Plan\n\nRewritten by an agent.\n", CLAUDE);
  assert.deepEqual(quire.compareMarks("v1", "now", "Plan").from.text, "# Plan\n\nDraft one.\n");
  assert.equal(quire.compareMarks(v1.id).to.text, "# Plan\n\nRewritten by an agent.\n");
  const between = quire.compareMarks(v1.id, v2.id);
  assert.deepEqual([between.from.text, between.to.text, between.to.mark?.name], ["# Plan\n\nDraft one.\n", "# Plan\n\nDraft two.\n", "v2"]);
  const r = quire.restoreMark("v2", "you", { target: "Plan" });
  assert.equal(quire.read("Plan").content, "# Plan\n\nDraft two.\n");
  assert.equal(r.change?.source, "you", "the restore is attributed");
  assert.equal(quire.marks("Plan").find((m) => m.name === "v2")?.current, true);
  quire.restore(r.change!.id, "you"); // History's Undo
  assert.equal(quire.read("Plan").content, "# Plan\n\nRewritten by an agent.\n");
  assert.throws(() => quire.restoreMark("v1", "you", { target: "Plan", baseVersion: "stale" }), /changed on disk/);
});

test("a mark follows its note through a rename, and keeps its text when the change log loses it", () => {
  const { quire, edit } = setup();
  const first = edit("# Plan\n\nDraft two.\n");
  const m = quire.mark("Plan", "v1", "you", { at: first.id });
  quire.move("Plan.md", "Projects/Plan 2026.md", "you");
  assert.equal(quire.findMark(m.id).path, "Projects/Plan 2026.md");
  quire.db.run("UPDATE changes SET before = NULL"); // however the log's text goes
  quire.save("Projects/Plan 2026.md", "# Plan\n\nLater.\n", { source: "you" });
  assert.equal(quire.markText(m.id).text, "# Plan\n\nDraft two.\n", "the mark kept it");
  assert.equal(quire.restoreMark(m.id, "you").path, "Projects/Plan 2026.md");
  assert.equal(quire.read("Projects/Plan 2026.md").content, "# Plan\n\nDraft two.\n");
});

test("a note in Trash keeps its marks; deleting it for good deletes them, and Trash says how many", () => {
  const { quire } = setup();
  quire.mark("Plan", "v1", "you");
  quire.mark("Plan", "v2", "you");
  const [gone] = quire.delete(["Plan.md"], "you");
  const [latest] = quire.marks();
  assert.equal(quire.findMark(latest.id).path, null, "in Trash, a mark has no path");
  const item = quire.trash().find((t) => t.path === "Plan.md")!;
  assert.equal(item.marks, 2);
  assert.throws(() => quire.restoreMark(latest.id, "you"), /in Trash: restore it from Trash first/);
  quire.untrash([gone.id], "you");
  assert.equal(quire.marks("Plan").length, 2, "back from Trash, its marks are back");
  const [again] = quire.delete(["Plan.md"], "you");
  quire.purge([again.id], "you");
  assert.deepEqual(quire.marks(), [], "deleted for good, its marks go with it");
});
