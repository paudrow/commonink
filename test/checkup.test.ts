import { test } from "node:test";
import assert from "node:assert/strict";
import { checkup, fmtCheckup, isEmptyNote } from "../src/core/checkup.ts";
import { handleApi, type ApiHost } from "../src/core/api.ts";
import { notes } from "../src/core/commands/notes.ts";
import { openTempVault } from "./helpers.ts";

test("a note is empty with nothing but a heading", () => {
  assert.equal(isEmptyNote(""), true);
  assert.equal(isEmptyNote("# Untitled\n\n"), true);
  assert.equal(isEmptyNote("---\ntags:\n---\n# Title\n"), true);
  assert.equal(isEmptyNote("---\nemail: ann@example.com\n---\n# Ann\n"), false);
  assert.equal(isEmptyNote("# Title\n\nA line\n"), false);
  assert.equal(isEmptyNote("Just words"), false);
});

test("the check-up finds dead links, duplicate contacts, empty and unlinked notes, and long-overdue tasks", () => {
  const { vault } = openTempVault({
    "Hub.md": "# Hub\n\n[[Linked]] and [[Nowhere]]\n",
    "Linked.md": "# Linked\n\nSee [[Hub]].\n",
    "Loose.md": "# Loose\n\nNothing points here.\n",
    "Tagged.md": "# Tagged\n\n#keep\n",
    "Starred.md": "# Starred\n\nWords\n",
    "Blank.md": "# Blank\n",
    "Projects/Deep.md": "# Deep\n\nIn a folder, so it's filed.\n",
    "Archive/Old.md": "# Old\n\n[[Gone]]\n",
    "AGENTS.md": "# Agents\n\nRules\n",
    "People/Ann Lee.md": "---\nemail: ann@example.com\n---\n# Ann Lee\n",
    "People/Annie Lee.md": "---\nemail: ann@example.com\n---\n# Annie Lee\n",
    "Tasks.md":
      "# Tasks\n\n[[Hub]]\n\n- [ ] Old one due:2026-08-01\n- [ ] Repeats due:2026-08-01 rec:weekly\n- [x] Done due:2026-08-01\n- [ ] Recent due:2026-09-20\n",
  });
  vault.star("me", "Starred.md");
  const c = checkup(vault, "me", "2026-10-02");
  assert.deepEqual(c.deadLinks.map((m) => [m.target, m.from.map((f) => f.path)]), [["Nowhere", ["Hub.md"]]]);
  assert.deepEqual(c.duplicateContacts.map((g) => g.paths.sort()), [["People/Ann Lee.md", "People/Annie Lee.md"]]);
  assert.deepEqual(c.emptyNotes.map((n) => n.path), ["Blank.md"]);
  assert.deepEqual(c.unlinkedNotes.map((n) => n.path), ["Loose.md", "Tasks.md"]);
  assert.deepEqual(c.staleTasks.map((t) => [t.summary, t.due, t.line]), [["Old one", "2026-08-01", 5]]);
  assert.match(fmtCheckup(c), /Dead links \(1\):\n- \[\[Nowhere\]\] from Hub.md:3/);
  assert.match(fmtCheckup(c), /Tasks overdue by more than 30 days \(1\):\n- Tasks.md:5 Old one \(due 2026-08-01\)/);
});

test("an all-clear check-up says so, over the API and the CLI command", async () => {
  const { vault } = openTempVault({ "Home.md": "# Home\n\n[[Next]]\n", "Next.md": "# Next\n\n[[Home]]\n" });
  const host: ApiHost = { vault, actor: "you", user: "you", canEditShared: true, info: () => ({}), written() {}, moved() {}, removed() {}, tree() {} };
  const res = await handleApi(host, new Request("http://localhost/api/checkup"), "/checkup");
  assert.deepEqual(await res!.json(), { deadLinks: [], duplicateContacts: [], emptyNotes: [], unlinkedNotes: [], staleTasks: [] });
  const out = (await notes.find((c) => c.cli === "checkup")!.run({ vault, user: "you", source: "you" } as never, {} as never)) as { text: string };
  assert.match(out.text, /^All clear/);
});
