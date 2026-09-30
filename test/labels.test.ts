// Labels (Quire.label and friends): a name on a version of a note, to compare with or go back to.
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

test("label the note as it is now, or as it was after an earlier change, with who and when", () => {
  const { quire, edit } = setup();
  const first = edit("# Plan\n\nDraft two.\n");
  edit("# Plan\n\nDraft three, sent.\n", CLAUDE);
  const now = quire.label("Plan", "Sent to Alex", "you", { description: "The copy in the email" });
  assert.deepEqual([now.name, now.description, now.path, now.current, now.person, now.agent], ["Sent to Alex", "The copy in the email", "Plan.md", true, "you", null]);
  const past = quire.label("Plan.md", "v1", CLAUDE, { at: first.id });
  assert.deepEqual([past.change_id, past.current, past.person, past.agent], [first.id, false, "you", "Claude"]);
  assert.equal(quire.labelText(past.id).text, "# Plan\n\nDraft two.\n");
  assert.equal(quire.labelText("V1", "Plan").text, "# Plan\n\nDraft two.\n", "a label is found by its name on the note, any case");
  assert.deepEqual(quire.labels("Plan").map((m) => m.name), ["v1", "Sent to Alex"], "newest first");
  assert.deepEqual(quire.labels().map((m) => m.name), ["v1", "Sent to Alex"], "every note's, for History");
  assert.deepEqual(quire.labels("Other"), []);
});

test("a label needs a name of its own on its note, and labels only notes", () => {
  const { quire } = setup();
  quire.label("Plan", "v1", "you");
  assert.throws(() => quire.label("Plan", "  V1 ", "you"), /already has a version labeled "V1"/);
  assert.throws(() => quire.label("Plan", "   ", "you"), /needs a name/);
  assert.throws(() => quire.label("Plan", "x".repeat(81), "you"), /at most 80 characters/);
  assert.equal(quire.label("Other", "v1", "you").name, "v1", "the same name on another note is fine");
  assert.throws(() => quire.label("Plan", "old", "you", { at: 999 }), /isn't a change to Plan\.md/);
});

test("rename a label, or delete it, and the note and its history stay as they are", () => {
  const { quire, edit } = setup();
  const m = quire.label("Plan", "v1", "you");
  quire.label("Plan", "v2", "you");
  assert.equal(quire.renameLabel(m.id, "Agreed v1", { description: "With Sam" }).name, "Agreed v1");
  assert.throws(() => quire.renameLabel(m.id, "v2"), /already has a version labeled "v2"/);
  edit("# Plan\n\nChanged.\n");
  const changes = quire.changes({ path: "Plan" }).length;
  assert.equal(quire.deleteLabel("Agreed v1", "Plan").id, m.id);
  assert.deepEqual(quire.labels("Plan").map((x) => x.name), ["v2"]);
  assert.equal(quire.changes({ path: "Plan" }).length, changes, "deleting a label changes no note");
  assert.throws(() => quire.findLabel(m.id), /No label/);
});

test("compare a label with now or with another label, and restore to one as one change that can be undone", () => {
  const { quire, edit } = setup();
  const v1 = quire.label("Plan", "v1", "you");
  edit("# Plan\n\nDraft two.\n");
  const v2 = quire.label("Plan", "v2", "you");
  edit("# Plan\n\nRewritten by an agent.\n", CLAUDE);
  assert.deepEqual(quire.compareLabels("v1", "now", "Plan").from.text, "# Plan\n\nDraft one.\n");
  assert.equal(quire.compareLabels(v1.id).to.text, "# Plan\n\nRewritten by an agent.\n");
  const between = quire.compareLabels(v1.id, v2.id);
  assert.deepEqual([between.from.text, between.to.text, between.to.label?.name], ["# Plan\n\nDraft one.\n", "# Plan\n\nDraft two.\n", "v2"]);
  const r = quire.restoreLabel("v2", "you", { target: "Plan" });
  assert.equal(quire.read("Plan").content, "# Plan\n\nDraft two.\n");
  assert.equal(r.change?.source, "you", "the restore is attributed");
  assert.equal(quire.labels("Plan").find((m) => m.name === "v2")?.current, true);
  quire.restore(r.change!.id, "you"); // History's Undo
  assert.equal(quire.read("Plan").content, "# Plan\n\nRewritten by an agent.\n");
  assert.throws(() => quire.restoreLabel("v1", "you", { target: "Plan", baseVersion: "stale" }), /changed on disk/);
});

test("labeling an old change rebuilds its text from the log's deltas, and the label then keeps that text whole", () => {
  const { quire, edit } = setup();
  const versions = Array.from({ length: 80 }, (_, i) => `# Plan\n\n${Array.from({ length: 30 }, (_, l) => `Line ${l}${l === i % 30 ? ` edited ${i}` : ""}`).join("\n")}\n`);
  const changes = versions.map((v) => edit(v));
  const deltas = quire.db.get("SELECT count(*) AS n FROM changes WHERE base_id IS NOT NULL").n as number;
  assert.ok(deltas > 60, `the log keeps most older texts as deltas (${deltas})`);
  const early = quire.label("Plan", "Early", "you", { at: changes[4].id });
  assert.equal(quire.labelText(early.id).text, versions[4], "the version right after that change, rebuilt through the deltas");
  const row = quire.db.get("SELECT text FROM labels WHERE id = ?", early.id).text as string;
  assert.equal(row, versions[4], "stored whole, not as a delta");
  quire.db.run("UPDATE changes SET before = NULL, base_id = NULL"); // however the log's text goes
  assert.equal(quire.compareLabels(early.id).from.text, versions[4]);
});

test("a label follows its note through a rename, and keeps its text when the change log loses it", () => {
  const { quire, edit } = setup();
  const first = edit("# Plan\n\nDraft two.\n");
  const m = quire.label("Plan", "v1", "you", { at: first.id });
  quire.move("Plan.md", "Projects/Plan 2026.md", "you");
  assert.equal(quire.findLabel(m.id).path, "Projects/Plan 2026.md");
  quire.db.run("UPDATE changes SET before = NULL"); // however the log's text goes
  quire.save("Projects/Plan 2026.md", "# Plan\n\nLater.\n", { source: "you" });
  assert.equal(quire.labelText(m.id).text, "# Plan\n\nDraft two.\n", "the label kept it");
  assert.equal(quire.restoreLabel(m.id, "you").path, "Projects/Plan 2026.md");
  assert.equal(quire.read("Projects/Plan 2026.md").content, "# Plan\n\nDraft two.\n");
});

test("a note in Trash keeps its labels; deleting it for good deletes them, and Trash says how many", () => {
  const { quire } = setup();
  quire.label("Plan", "v1", "you");
  quire.label("Plan", "v2", "you");
  const [gone] = quire.delete(["Plan.md"], "you");
  const [latest] = quire.labels();
  assert.equal(quire.findLabel(latest.id).path, null, "in Trash, a label has no path");
  const item = quire.trash().find((t) => t.path === "Plan.md")!;
  assert.equal(item.labels, 2);
  assert.throws(() => quire.restoreLabel(latest.id, "you"), /in Trash: restore it from Trash first/);
  quire.untrash([gone.id], "you");
  assert.equal(quire.labels("Plan").length, 2, "back from Trash, its labels are back");
  const [again] = quire.delete(["Plan.md"], "you");
  quire.purge([again.id], "you");
  assert.deepEqual(quire.labels(), [], "deleted for good, its labels go with it");
});
