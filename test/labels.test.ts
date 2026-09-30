// Labels (Vault.label and friends): a name on a version of a note, to compare with or go back to.
import { test } from "node:test";
import assert from "node:assert/strict";
import { openTempVault } from "./helpers.ts";
import { agentSource } from "../src/core/actor.ts";

const CLAUDE = agentSource("Claude", "you");

function setup() {
  const { vault } = openTempVault({ "Plan.md": "# Plan\n\nDraft one.\n", "Other.md": "# Other\n" });
  const edit = (text: string, source = "you") => vault.save("Plan.md", text, { source }).change!;
  return { vault, edit };
}

test("label the note as it is now, or as it was after an earlier change, with who and when", () => {
  const { vault, edit } = setup();
  const first = edit("# Plan\n\nDraft two.\n");
  edit("# Plan\n\nDraft three, sent.\n", CLAUDE);
  const now = vault.label("Plan", "Sent to Alex", "you", { description: "The copy in the email" });
  assert.deepEqual([now.name, now.description, now.path, now.current, now.person, now.agent], ["Sent to Alex", "The copy in the email", "Plan.md", true, "you", null]);
  const past = vault.label("Plan.md", "v1", CLAUDE, { at: first.id });
  assert.deepEqual([past.change_id, past.current, past.person, past.agent], [first.id, false, "you", "Claude"]);
  assert.equal(vault.labelText(past.id).text, "# Plan\n\nDraft two.\n");
  assert.equal(vault.labelText("V1", "Plan").text, "# Plan\n\nDraft two.\n", "a label is found by its name on the note, any case");
  assert.deepEqual(vault.labels("Plan").map((m) => m.name), ["v1", "Sent to Alex"], "newest first");
  assert.deepEqual(vault.labels().map((m) => m.name), ["v1", "Sent to Alex"], "every note's, for History");
  assert.deepEqual(vault.labels("Other"), []);
});

test("a label needs a name of its own on its note, and labels only notes", () => {
  const { vault } = setup();
  vault.label("Plan", "v1", "you");
  assert.throws(() => vault.label("Plan", "  V1 ", "you"), /already has a version labeled "V1"/);
  assert.throws(() => vault.label("Plan", "   ", "you"), /needs a name/);
  assert.throws(() => vault.label("Plan", "x".repeat(81), "you"), /at most 80 characters/);
  assert.equal(vault.label("Other", "v1", "you").name, "v1", "the same name on another note is fine");
  assert.throws(() => vault.label("Plan", "old", "you", { at: 999 }), /isn't a change to Plan\.md/);
});

test("rename a label, or delete it, and the note and its history stay as they are", () => {
  const { vault, edit } = setup();
  const m = vault.label("Plan", "v1", "you");
  vault.label("Plan", "v2", "you");
  assert.equal(vault.renameLabel(m.id, "Agreed v1", { description: "With Sam" }).name, "Agreed v1");
  assert.throws(() => vault.renameLabel(m.id, "v2"), /already has a version labeled "v2"/);
  edit("# Plan\n\nChanged.\n");
  const changes = vault.changes({ path: "Plan" }).length;
  assert.equal(vault.deleteLabel("Agreed v1", "Plan").id, m.id);
  assert.deepEqual(vault.labels("Plan").map((x) => x.name), ["v2"]);
  assert.equal(vault.changes({ path: "Plan" }).length, changes, "deleting a label changes no note");
  assert.throws(() => vault.findLabel(m.id), /No label/);
});

test("compare a label with now or with another label, and restore to one as one change that can be undone", () => {
  const { vault, edit } = setup();
  const v1 = vault.label("Plan", "v1", "you");
  edit("# Plan\n\nDraft two.\n");
  const v2 = vault.label("Plan", "v2", "you");
  edit("# Plan\n\nRewritten by an agent.\n", CLAUDE);
  assert.deepEqual(vault.compareLabels("v1", "now", "Plan").from.text, "# Plan\n\nDraft one.\n");
  assert.equal(vault.compareLabels(v1.id).to.text, "# Plan\n\nRewritten by an agent.\n");
  const between = vault.compareLabels(v1.id, v2.id);
  assert.deepEqual([between.from.text, between.to.text, between.to.label?.name], ["# Plan\n\nDraft one.\n", "# Plan\n\nDraft two.\n", "v2"]);
  const r = vault.restoreLabel("v2", "you", { target: "Plan" });
  assert.equal(vault.read("Plan").content, "# Plan\n\nDraft two.\n");
  assert.equal(r.change?.source, "you", "the restore is attributed");
  assert.equal(vault.labels("Plan").find((m) => m.name === "v2")?.current, true);
  vault.restore(r.change!.id, "you"); // History's Undo
  assert.equal(vault.read("Plan").content, "# Plan\n\nRewritten by an agent.\n");
  assert.throws(() => vault.restoreLabel("v1", "you", { target: "Plan", baseVersion: "stale" }), /changed on disk/);
});

test("labeling an old change rebuilds its text from the log's deltas, and the label then keeps that text whole", () => {
  const { vault, edit } = setup();
  const versions = Array.from({ length: 80 }, (_, i) => `# Plan\n\n${Array.from({ length: 30 }, (_, l) => `Line ${l}${l === i % 30 ? ` edited ${i}` : ""}`).join("\n")}\n`);
  const changes = versions.map((v) => edit(v));
  const deltas = vault.db.get("SELECT count(*) AS n FROM changes WHERE base_id IS NOT NULL").n as number;
  assert.ok(deltas > 60, `the log keeps most older texts as deltas (${deltas})`);
  const early = vault.label("Plan", "Early", "you", { at: changes[4].id });
  assert.equal(vault.labelText(early.id).text, versions[4], "the version right after that change, rebuilt through the deltas");
  const row = vault.db.get("SELECT text FROM labels WHERE id = ?", early.id).text as string;
  assert.equal(row, versions[4], "stored whole, not as a delta");
  vault.db.run("UPDATE changes SET before = NULL, base_id = NULL"); // however the log's text goes
  assert.equal(vault.compareLabels(early.id).from.text, versions[4]);
});

test("a label follows its note through a rename, and keeps its text when the change log loses it", () => {
  const { vault, edit } = setup();
  const first = edit("# Plan\n\nDraft two.\n");
  const m = vault.label("Plan", "v1", "you", { at: first.id });
  vault.move("Plan.md", "Projects/Plan 2026.md", "you");
  assert.equal(vault.findLabel(m.id).path, "Projects/Plan 2026.md");
  vault.db.run("UPDATE changes SET before = NULL"); // however the log's text goes
  vault.save("Projects/Plan 2026.md", "# Plan\n\nLater.\n", { source: "you" });
  assert.equal(vault.labelText(m.id).text, "# Plan\n\nDraft two.\n", "the label kept it");
  assert.equal(vault.restoreLabel(m.id, "you").path, "Projects/Plan 2026.md");
  assert.equal(vault.read("Projects/Plan 2026.md").content, "# Plan\n\nDraft two.\n");
});

test("a note in Trash keeps its labels; deleting it for good deletes them, and Trash says how many", () => {
  const { vault } = setup();
  vault.label("Plan", "v1", "you");
  vault.label("Plan", "v2", "you");
  const [gone] = vault.delete(["Plan.md"], "you");
  const [latest] = vault.labels();
  assert.equal(vault.findLabel(latest.id).path, null, "in Trash, a label has no path");
  const item = vault.trash().find((t) => t.path === "Plan.md")!;
  assert.equal(item.labels, 2);
  assert.throws(() => vault.restoreLabel(latest.id, "you"), /in Trash: restore it from Trash first/);
  vault.untrash([gone.id], "you");
  assert.equal(vault.labels("Plan").length, 2, "back from Trash, its labels are back");
  const [again] = vault.delete(["Plan.md"], "you");
  vault.purge([again.id], "you");
  assert.deepEqual(vault.labels(), [], "deleted for good, its labels go with it");
});
