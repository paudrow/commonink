import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fillDates, orderSections, readSections, sectionsMarkdown } from "../scripts/preview-sections.ts";

test("demo dates are filled in as of the day the Preview is seeded", () => {
  assert.equal(
    fillDates("due:{{date}} start:{{date:-2d}} due:{{date:+3d}} due:{{date:+1w}} # {{!date}}", "2026-09-28"),
    "due:2026-09-28 start:2026-09-26 due:2026-10-01 due:2026-10-05 # {{date}}",
  );
  assert.equal(fillDates("{{date:+5d}}", "2026-12-29"), "2027-01-03");
});

test("a PR's own section comes first, the stacked PRs' after it, and demo files go under Try/<title>/", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "preview-"));
  fs.writeFileSync(path.join(dir, "tags.md"), "---\npr: 41\ntitle: Nested tags\n---\n1. Open [[Clients]].\n");
  fs.writeFileSync(path.join(dir, "recurrence.md"), "---\npr: 52\ntitle: Recurring tasks\n---\n\n1. Tick [[Bills]].\n");
  fs.mkdirSync(path.join(dir, "recurrence/_root/Templates"), { recursive: true });
  fs.writeFileSync(path.join(dir, "recurrence/Bills.md"), "# Bills\n");
  fs.writeFileSync(path.join(dir, "recurrence/_root/Templates/Daily note.md"), "# {{!date}}\n");
  const sections = readSections(dir);
  assert.deepEqual(sections.map((s) => [s.slug, s.pr, s.title, s.body]), [["recurrence", 52, "Recurring tasks", "1. Tick [[Bills]]."], ["tags", 41, "Nested tags", "1. Open [[Clients]]."]]);
  assert.deepEqual(sections[0].files.map((f) => f.to).sort(), ["Templates/Daily note.md", "Try/Recurring tasks/Bills.md"]);
  assert.deepEqual(orderSections(sections, 41).mine.map((s) => s.slug), ["tags"]);
  assert.deepEqual(sectionsMarkdown(sections, 41), [
    "## Nested tags (#41)", "", "1. Open [[Clients]].", "",
    "## Also in this branch", "", "### Recurring tasks (#52)", "", "1. Tick [[Bills]].", "",
  ]);
  assert.deepEqual(readSections(path.join(dir, "nowhere")), []);
});

test("a demo note's .versions folder gives its marked versions, oldest first, and isn't a note of its own", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "preview-"));
  fs.writeFileSync(path.join(dir, "marks.md"), "---\npr: 9\ntitle: Marked versions\n---\n1. Open [[Proposal]].\n");
  fs.mkdirSync(path.join(dir, "marks/Proposal.versions"), { recursive: true });
  fs.writeFileSync(path.join(dir, "marks/Proposal.md"), "# Proposal\n\nNow.\n");
  fs.writeFileSync(path.join(dir, "marks/Proposal.versions/2 Sent to Alex.md"), "# Proposal\n\nSent.\n");
  fs.writeFileSync(path.join(dir, "marks/Proposal.versions/1 v1.md"), "# Proposal\n\nFirst.\n");
  const [section] = readSections(dir);
  assert.deepEqual(section.files.map((f) => [f.to, f.versions?.map((v) => v.name)]), [["Try/Marked versions/Proposal.md", ["v1", "Sent to Alex"]]]);
});
