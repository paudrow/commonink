// Templates: notes in Templates/ whose {{placeholders}} are filled in when a note is made from one
// (or a template is inserted into a note). Daily notes use the same engine.
import { test } from "node:test";
import assert from "node:assert/strict";
import { asksIn, fillTemplate, formatDate, templateInfo } from "../src/core/templates.ts";
import { openTempVault } from "./helpers.ts";

const AT = "2026-09-29T14:05"; // a Tuesday, the creator's own clock

test("dates and times, with Moment-style formats and day or week offsets", () => {
  const fill = (s: string) => fillTemplate(s, { at: AT }).text;
  assert.equal(fill("{{date}} {{time}}"), "2026-09-29 14:05");
  assert.equal(fill("{{date:dddd, MMMM D}} · {{date:ddd D MMM YY}} · {{date:DD/MM/YYYY}}"), "Tuesday, September 29 · Tue 29 Sep 26 · 29/09/2026");
  assert.equal(fill("{{time:h:mm A}} {{time:HH:mm:ss}}"), "2:05 PM 14:05:00");
  assert.equal(fill("{{date+1d}} {{date-1w:dddd}} {{date+2w:MMM D}}"), "2026-09-30 Tuesday Oct 13");
  assert.equal(formatDate(new Date(2026, 0, 5, 9, 7), "YYYY-M-D H:m [at] hh:mm a"), "2026-1-5 9:7 at 09:07 am");
});

test("title, clipboard, cursor, and escaped or unknown braces", () => {
  const r = fillTemplate("# {{title}}\n\n{{clipboard}}\n\n- {{cursor}}\n\n\\{{date}} stays, {{mood}} too", { at: AT, title: "Acme sync", clipboard: "pasted" });
  assert.equal(r.text, "# Acme sync\n\npasted\n\n- \n\n{{date}} stays, {{mood}} too");
  assert.equal(r.cursor, "# Acme sync\n\npasted\n\n- ".length);
  assert.deepEqual(r.unfilled, ["mood"]);
  assert.equal(fillTemplate("no cursor", { at: AT }).cursor, null);
  // Without a clipboard (an agent, a daily note), {{clipboard}} is left for later.
  assert.deepEqual(fillTemplate("{{clipboard}}", { at: AT }).unfilled, ["clipboard"]);
});

test("{{ask:…}} is asked once per label, with an optional default; answers fill every copy", () => {
  const t = "Attendees: {{ask:Attendees}}\nClient: {{ask:Client|Acme}}\nAgain: {{ask:Attendees}}\n\\{{ask:Not this}}";
  assert.deepEqual(asksIn(t), [{ label: "Attendees", fallback: "" }, { label: "Client", fallback: "Acme" }]);
  assert.equal(fillTemplate(t, { at: AT, answers: { Attendees: "Sam, Lee" } }).text, "Attendees: Sam, Lee\nClient: Acme\nAgain: Sam, Lee\n{{ask:Not this}}");
  // Nothing answered and no default: the placeholder stays, and is reported.
  const r = fillTemplate("Who: {{ask:Attendees}}", { at: AT });
  assert.equal(r.text, "Who: {{ask:Attendees}}");
  assert.deepEqual(r.unfilled, ["ask:Attendees"]);
});

test("a template's own frontmatter says how notes are made from it, and isn't copied into them", () => {
  const md = "---\ntitle: \"{{date}} {{ask:Client}} meeting\"\nfolder: Meetings\napplies_to: [Meetings/, Clients/]\ntags: [meeting]\n---\n# {{title}}\n";
  const info = templateInfo("Templates/Meeting.md", md);
  assert.deepEqual(info, { path: "Templates/Meeting.md", name: "Meeting", title: "{{date}} {{ask:Client}} meeting", folder: "Meetings", appliesTo: ["Meetings", "Clients"], asks: [{ label: "Client", fallback: "" }] });
  // The body keeps the frontmatter that isn't the template's (tags).
  assert.equal(fillTemplate(md, { at: AT, title: "X" }).text, "---\ntags: [meeting]\n---\n# X\n");
});

const vault = () =>
  openTempVault({
    "Templates/Meeting.md": "---\ntitle: \"{{date}} {{ask:Client}}\"\nfolder: Meetings\napplies_to: Meetings/\n---\n# {{title}}\n\n**Attendees:** {{ask:Attendees}}\n\n## Notes\n\n- {{cursor}}\n\n## Action items\n\n- [ ] Send the recap\n",
    "Templates/Daily note.md": "# {{date:dddd, MMMM D}}\n\n## Tasks\n\n## Log\n",
    "Templates/Decision.md": "## Decision: {{ask:What}}\n\n- **Why:** {{cursor}}\n",
  });

test("the vault lists its templates, and makes a note from one", () => {
  const { quire } = vault();
  assert.deepEqual(quire.templates().map((t) => [t.name, t.appliesTo, t.asks.map((a) => a.label)]), [
    ["Daily note", [], []],
    ["Decision", [], ["What"]],
    ["Meeting", ["Meetings"], ["Client", "Attendees"]],
  ]);
  const r = quire.createFromTemplate("Meeting", { at: AT, answers: { Client: "Acme", Attendees: "Sam, Lee" } }, "you");
  assert.equal(r.path, "Meetings/2026-09-29 Acme.md");
  const text = quire.read(r.path).content;
  assert.equal(text, "# 2026-09-29 Acme\n\n**Attendees:** Sam, Lee\n\n## Notes\n\n- \n\n## Action items\n\n- [ ] Send the recap\n");
  assert.equal(r.cursor, text.indexOf("- \n") + 2);
  assert.deepEqual(r.unfilled, []);
  // The same title again gets a free name; a given title and folder win over the template's.
  assert.equal(quire.createFromTemplate("Meeting", { at: AT, answers: { Client: "Acme" } }, "you").path, "Meetings/2026-09-29 Acme 2.md");
  const mine = quire.createFromTemplate("Templates/Meeting.md", { at: AT, title: "Kickoff", folder: "Projects/Launch" }, "you");
  assert.equal(mine.path, "Projects/Launch/Kickoff.md");
  assert.deepEqual(mine.unfilled, ["ask:Attendees"]);
  assert.throws(() => quire.createFromTemplate("Projects/Launch/Kickoff", { at: AT }, "you"), /isn't a template/);
  // A template with no title pattern is named after the template.
  assert.equal(quire.createFromTemplate("Decision", { at: AT }, "you").path, "Decision.md");
});

test("a folder's default template: the one whose applies_to names it", () => {
  const { quire } = vault();
  assert.equal(quire.defaultTemplate("Meetings")?.name, "Meeting");
  assert.equal(quire.defaultTemplate("Meetings/2026")?.name, "Meeting", "and folders under it");
  assert.equal(quire.defaultTemplate("Projects"), null);
});

test("inserting a template gives its body, filled, without its frontmatter", () => {
  const { quire } = vault();
  const r = quire.renderTemplate("Decision", { at: AT, answers: { What: "Ship Friday" }, title: "Launch plan" });
  assert.equal(r.text, "## Decision: Ship Friday\n\n- **Why:** \n");
  assert.equal(r.cursor, "## Decision: Ship Friday\n\n- **Why:** ".length);
});

test("daily notes (Today's journal, quick-add's) are made with the same engine", () => {
  const { quire } = vault();
  quire.dailyNote("2026-09-29", "you");
  assert.equal(quire.read("Journal/2026-09-29").content, "# Tuesday, September 29\n\n## Tasks\n\n## Log\n");
  quire.addTask("Call the bank tomorrow", "you", { today: "2026-10-01" });
  assert.match(quire.read("Journal/2026-10-01").content, /^# Thursday, October 1\n\n## Tasks\n\n- \[ \] Call the bank due:2026-10-02\n/);
});

test("a template's tasks aren't tasks: Tasks and Today leave Templates/ out", () => {
  const { quire } = vault();
  assert.deepEqual(quire.tasks().map((t) => t.path), []);
  assert.equal(quire.openTaskCount(), 0);
});
