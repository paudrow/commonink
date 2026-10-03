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

test("the properties table writes one property at a time and leaves the rest as written", async () => {
  const { withValue, withoutValue, yamlText } = await import("../src/core/schema.ts");
  const md = "---\ntitle: Plan # draft\npeople:\n  - \"[[People/Sam]]\"\nmood: good\n---\n# Plan\n";
  // A list written one item per line stays that way; a person is a quoted link.
  assert.equal(withValue(md, "people", ["[[People/Sam]]", "[[People/Ana Ruiz]]"]), '---\ntitle: Plan # draft\npeople:\n  - "[[People/Sam]]"\n  - "[[People/Ana Ruiz]]"\nmood: good\n---\n# Plan\n');
  assert.equal(withValue(md, "tags", ["a", "b, c"]), `---\ntitle: Plan # draft\npeople:\n  - "[[People/Sam]]"\nmood: good\ntags: [a, "b, c"]\n---\n# Plan\n`);
  assert.equal(withValue(md, "mood", "ok: fine"), '---\ntitle: Plan # draft\npeople:\n  - "[[People/Sam]]"\nmood: "ok: fine"\n---\n# Plan\n');
  assert.equal(withoutValue(md, "people"), "---\ntitle: Plan # draft\nmood: good\n---\n# Plan\n");
  // Removing the last one removes the front matter.
  assert.equal(withoutValue("---\nmood: good\n---\n\n# Plan\n", "mood"), "# Plan\n");
  assert.deepEqual(["work", "true", "#x", "a, b", ""].map((s) => yamlText(s)), ["work", '"true"', '"#x"', "a, b", '""']);
});

test("each property gets the control its type calls for", async () => {
  const { propKind, NOTE_SCHEMA, USER_SCHEMA, PERSON_SCHEMA } = await import("../src/core/schema.ts");
  const kinds = (md: string, schema = NOTE_SCHEMA) => scanFrontmatter(md)!.fields.map((f) => `${f.key}=${propKind(f.key, schema.properties[f.key], f.value)}`);
  assert.deepEqual(kinds("---\ntags: [a]\ndate: 2026-10-02\npeople: []\ntitle: x\ndone: true\ndue: 2026-10-03\nlist: [a]\nmeta:\n  k: v\nmood: ok\n---\n"), [
    "tags=tags", "date=date", "people=people", "title=text", "done=boolean", "due=date", "list=list", "meta=raw", "mood=text",
  ]);
  assert.deepEqual(kinds("---\ntheme: dark\nvim: false\nalways_show: [calendar]\n---\n", USER_SCHEMA), ["theme=enum", "vim=boolean", "always_show=choices"]);
  assert.deepEqual(kinds("---\nemail: [a@b.c]\n---\n", PERSON_SCHEMA), ["email=list"]);
});

test("people are links to contacts, and a name that isn't is pointed out", () => {
  assert.deepEqual(messages('---\npeople: ["[[People/Sam Lee]]", Ana]\n---\n'), [
    'warning: Ana isn\'t linked to a contact, so this note won\'t show on theirs. Pick them from the list, or write "[[People/Ana]]".',
  ]);
});

test("property types are declared in the workspace settings, inline or a line each, and written back keeping the rest", async () => {
  const { readPropertyTypes, withPropertyType } = await import("../src/core/schema.ts");
  const inline = "---\ngamified: true\nproperties: { due: date, priority: number, 'big one': list, odd: wat }\n---\n# Settings\n";
  assert.deepEqual(readPropertyTypes(inline), { due: "date", priority: "number", "big one": "list" });
  assert.equal(withPropertyType(inline, "done", "checkbox"), "---\ngamified: true\nproperties: { due: date, priority: number, big one: list, odd: wat, done: checkbox }\n---\n# Settings\n");
  const lines = "---\nproperties:\n  due: date # when it's due\n  people_cc: people\norganizing: para\n---\nbody\n";
  assert.deepEqual(readPropertyTypes(lines), { due: "date", people_cc: "people" });
  assert.equal(withPropertyType(lines, "due", "text"), "---\nproperties:\n  due: text\n  people_cc: people\norganizing: para\n---\nbody\n");
  // The last one gone, so is `properties:`.
  assert.equal(withPropertyType(withPropertyType(lines, "due", null), "people_cc", null), "---\norganizing: para\n---\nbody\n");
  assert.equal(withPropertyType(lines, "nope", null), lines);
  // No settings file yet: a new one, with the type in it.
  assert.deepEqual(readPropertyTypes(withPropertyType("", "due", "date")), { due: "date" });
  // A type that isn't one is pointed out where it is.
  assert.deepEqual(messages(inline, SETTINGS_NOTE), ['error: odd can\'t be "wat": a property is one of text, number, checkbox, date, list, people.']);
  assert.deepEqual(messages("---\nproperties: date\n---\n", SETTINGS_NOTE), ["error: properties is a set of name: type pairs, like { due: date, priority: number, done: checkbox }."]);
});

test("a declared type decides a property's control, type and checks; the app's own properties keep theirs", async () => {
  const { propKind, schemaFor, typeInfo } = await import("../src/core/schema.ts");
  const types = { priority: "number", done: "checkbox", owners: "people", tags: "text" } as const;
  const md = "---\npriority: high\ndone: yes\nowners: [Sam]\nstatus: open\ntags: [a]\nseen: 2026-10-02\n---\n";
  const fields = scanFrontmatter(md)!.fields;
  const schema = schemaFor("Notes/a.md", types);
  assert.deepEqual(fields.map((f) => propKind(f.key, schema.properties[f.key], f.value)), ["number", "boolean", "people", "text", "tags", "date"]);
  assert.deepEqual(
    fields.map((f) => { const t = typeInfo("Notes/a.md", f.key, f.value, types); return `${f.key}=${t.type} (${t.source})`; }),
    ["priority=number (declared)", "done=checkbox (declared)", "owners=people (declared)", "status=text (guessed)", "tags=tags (built in)", "seen=date (guessed)"],
  );
  assert.deepEqual(frontmatterProblems(md, "Notes/a.md", types).map((p) => p.message), [
    'priority is a number, not "high".',
    'done is true or false, not "yes".',
    'Sam isn\'t linked to a contact, so this note won\'t show on theirs. Pick them from the list, or write "[[People/Sam]]".',
  ]);
  assert.deepEqual(messages(md), []);
  // Settings files have no properties of their own to declare.
  assert.equal(schemaFor(SETTINGS_NOTE, types).properties.priority, undefined);
});

test("agents and the CLI list properties with their types and declare one, the same as the table", async () => {
  const { COMMANDS } = await import("../src/core/commands/index.ts");
  const { openTempVault } = await import("./helpers.ts");
  const { vault } = openTempVault({ "A.md": "---\npriority: 2\ndue: 2026-10-02\n---\n# A\n", "B.md": "---\npriority: high\ntags: [x]\n---\n# B\n" });
  vault.sync();
  const run = (cli: string, args: Record<string, unknown>) => COMMANDS.find((c) => c.cli === cli)!.run({ vault, source: "test" } as never, args as never) as { text: string; data: unknown };
  assert.match(run("properties", {}).text, /- due: date \(guessed\), 1 note\n- priority: text \(guessed\), 2 notes\n- tags: tags \(built in\), 1 note/);
  assert.match(run("property type", { name: "priority", type: "number" }).text, /priority is a number in every note now/);
  assert.match(vault.read(SETTINGS_NOTE).content, /^---\n(.*\n)*properties:\n  priority: number\n---/);
  assert.match(run("properties", {}).text, /- priority: number \(declared\), 2 notes/);
  assert.match(run("properties", { note: "B" }).text, /^B\.md:\n- priority: number \(declared\) = high\n- tags: tags \(built in\) = \[x\]$/);
  // An agent writing a value that doesn't fit is told so.
  assert.match(run("edit", { path: "A.md", old_string: "priority: 2", new_string: "priority: soon" }).text, /priority is a number, not "soon"/);
  assert.match(run("property type", { name: "priority", type: "number" }).text, /^Nothing to change/);
  assert.match(run("property type", { name: "priority", type: "auto" }).text, /guessed from its values now/);
  assert.doesNotMatch(vault.read(SETTINGS_NOTE).content, /properties:/);
  assert.throws(() => run("property type", { name: "tags", type: "text" }), /Common Ink's own properties/);
  assert.throws(() => run("property type", { name: "x", type: "colour" }), /one of text, number/);
});
