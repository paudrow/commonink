import { test } from "node:test";
import assert from "node:assert/strict";
import { frontmatterProblems, readSettings, scanFrontmatter, settingsNote, SETTINGS_NOTE, withSetting } from "../src/core/schema.ts";

const messages = (md: string, path = "Notes/a.md") => frontmatterProblems(md, path).map((p) => `${p.severity}: ${p.message}`);

test("front matter is read field by field, with where each key and value is", () => {
  const md = "---\ntitle: Plan # draft\ntags: [a, \"b, c\"]\nlist:\n  - x\n- y\nnested:\n  k: v\nbody: |\n  text\n---\n# Plan\n";
  const s = scanFrontmatter(md)!;
  assert.deepEqual(
    s.fields.map((f) => [f.key, f.value.kind]),
    [["title", "scalar"], ["tags", "list"], ["list", "list"], ["nested", "map"], ["body", "block"]],
  );
  const title = s.fields[0];
  assert.equal(md.slice(title.from, title.to), "title");
  assert.equal(title.value.kind === "scalar" && title.value.text, "Plan");
  const tags = s.fields[1].value;
  assert.deepEqual(tags.kind === "list" && tags.items.map((i) => [i.text, md.slice(i.from, i.to)]), [["a", "a"], ["b, c", '"b, c"']]);
  const list = s.fields[2].value;
  assert.deepEqual(list.kind === "list" && list.items.map((i) => md.slice(i.from, i.to)), ["x", "y"]);
  assert.deepEqual(s.stray, []);
});

test("no closing --- is no front matter, so a note being started doesn't light up", () => {
  assert.equal(scanFrontmatter("---\ntitle: x\n\nSome text"), null);
  assert.deepEqual(messages("---\ntitle: x\n\nSome text: here"), []);
});

test("a note's own properties are fine; known ones are checked", () => {
  assert.deepEqual(messages("---\nmood: good\ntags: [a]\ndate: 2026-10-02\n---\n"), []);
  assert.deepEqual(messages("---\ntitle: [a, b]\n---\n"), ["error: title is one value, not a list."]);
  assert.deepEqual(messages("---\ndate: October 2\n---\n"), ["warning: Dates are read as YYYY-MM-DD, like 2026-10-02, so this note won't sort by its date."]);
  assert.deepEqual(messages("---\ntags:\n  k: v\n---\n"), ["error: tags is a list: write [a, b] or one - item per line."]);
  assert.deepEqual(messages("---\ntags: a\ntags: b\n---\n"), ["error: tags is set twice here. Keep one."]);
  assert.deepEqual(messages("---\ntitle: x\nnot a property\n---\n"), ["error: Properties are written as key: value. This line isn't, so it's skipped."]);
});

test("a template's placeholders aren't dates yet", () => {
  assert.deepEqual(messages("---\ndate: \"{{date}}\"\nfolder: Meetings\n---\n", "Templates/Meeting.md"), []);
});

test("the settings file names unknown settings and wrong values", () => {
  assert.deepEqual(messages("---\ngamifed: false\n---\n", SETTINGS_NOTE), ["warning: There's no setting called gamifed, so it does nothing. Did you mean gamified?"]);
  assert.deepEqual(messages("---\ngamified: yes\n---\n", SETTINGS_NOTE), ['error: gamified is true or false, not "yes".']);
  assert.deepEqual(messages("---\ngamified: \"true\"\n---\n", SETTINGS_NOTE), ['error: gamified is true or false, not "true".']);
  assert.deepEqual(messages(settingsNote(), SETTINGS_NOTE), []);
});

test("settings are read from the file, and written back keeping every other line", () => {
  assert.deepEqual(readSettings(settingsNote({ gamified: false })), { gamified: false });
  assert.deepEqual(readSettings("---\ngamified: maybe\n---\n"), {});
  const md = "---\n# mine\ngamified: true # on\ntitle: Settings\n---\nNotes\n";
  assert.equal(withSetting(md, "gamified", false), "---\n# mine\ngamified: false\ntitle: Settings\n---\nNotes\n");
  assert.equal(withSetting("---\ntitle: S\n---\nNotes\n", "gamified", false), "---\ntitle: S\ngamified: false\n---\nNotes\n");
  assert.equal(withSetting("", "gamified", false), settingsNote({ gamified: false }));
});

test("an agent that writes bad properties is told what's wrong, line by line", async () => {
  const { COMMANDS } = await import("../src/core/commands/index.ts");
  const { openTempVault } = await import("./helpers.ts");
  const { vault } = openTempVault();
  const run = (cli: string, args: Record<string, unknown>) => (COMMANDS.find((c) => c.cli === cli)!.run({ vault, source: "test" } as never, args as never) as { text: string }).text;
  const created = run("create", { path: SETTINGS_NOTE, content: "---\ngamified: no\ntheme: dark\n---\n" });
  assert.match(created, /^Created Config\/Settings\.md/);
  assert.match(created, /line 2: gamified is true or false, not "no"\.\n- line 3: There's no setting called theme/);
  assert.doesNotMatch(run("edit", { path: SETTINGS_NOTE, old_string: "gamified: no\ntheme: dark", new_string: "gamified: false" }), /problems/);
  assert.doesNotMatch(run("create", { path: "Ideas.md", content: "---\nmood: fine\n---\n# Ideas\n" }), /problems/);
});

test("an organizing style writes its own section of AGENTS.md, and changing it replaces only that section", async () => {
  const { withOrganizing } = await import("../src/core/presets.ts");
  const mine = "# Workspace conventions\n\n- Be brief.\n";
  const para = withOrganizing(mine, "para");
  assert.match(para, /^# Workspace conventions\n\n- Be brief\.\n\n<!-- organizing:[^\n]*-->\n## Organizing: PARA\n/);
  const zk = withOrganizing(para, "zettelkasten");
  assert.equal(zk.match(/## Organizing/g)!.length, 1);
  assert.match(zk, /## Organizing: Zettelkasten/);
  assert.equal(withOrganizing(zk, "none"), mine);
  assert.match(withOrganizing("", "simple"), /^# Workspace conventions\n\n<!-- organizing/);
  assert.deepEqual(readSettings("---\norganizing: para\n---\n"), { organizing: "para" });
  assert.deepEqual(messages("---\norganizing: gtd\n---\n", SETTINGS_NOTE), ['error: organizing is one of para, zettelkasten, journal, simple, none, not "gtd".']);
});

test("agents read Config/AGENTS.md, or the root AGENTS.md of a vault from before Config/", async () => {
  const { agentsText, isAgentsNote } = await import("../src/core/noteRoles.ts");
  const files: Record<string, string> = { "AGENTS.md": "old" };
  assert.equal(agentsText((p) => files[p]), "old");
  files["Config/AGENTS.md"] = "new";
  assert.equal(agentsText((p) => files[p]), "new");
  assert.deepEqual(["AGENTS.md", "Config/AGENTS.md", "Notes/AGENTS.md"].map(isAgentsNote), [true, true, false]);
});

test("your own settings file lists every setting, reads back what it wrote, and checks each value", async () => {
  const { readValues, withValue, userSettingsNote, userSettingsPath, USER_SCHEMA } = await import("../src/core/schema.ts");
  const path = userSettingsPath("Ada/L");
  assert.equal(path, "Config/Users/AdaL.md");
  assert.equal(userSettingsPath(""), "Config/Users/Me.md");
  const md = userSettingsNote({ theme: "dark", always_show: ["contacts"] });
  for (const key of Object.keys(USER_SCHEMA.properties).filter((k) => k !== "title" && k !== "tags")) assert.match(md, new RegExp(`^${key}: `, "m"), `${key} is listed`);
  assert.deepEqual(messages(md, path), []);
  const values = readValues(md, USER_SCHEMA);
  assert.equal(values.theme, "dark");
  assert.deepEqual(values.always_show, ["contacts"]);
  assert.equal(values.wrap_code, true, "an unset setting is written with its default");
  assert.equal(readValues(withValue(md, "vim", true), USER_SCHEMA).vim, true);
  assert.deepEqual(messages("---\nalways_show: [contacts, mail]\n---\n", path).length, 1);
  assert.deepEqual(messages("---\ntheme: blue\n---\n", path), ['error: theme is one of system, light, dark, not "blue".']);
});
