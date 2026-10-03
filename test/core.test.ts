import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { cleanPath } from "../src/core/paths.ts";
import { openVault } from "../src/core/local.ts";
import { openTempVault } from "./helpers.ts";
import { parseQuery } from "../src/core/query.ts";
import { notes } from "../src/core/commands/notes.ts";
import type { Favorite, NoteMeta } from "../src/core/vault.ts";

const notesOf = (list: Favorite[]) => list.map((n) => (n as NoteMeta).path);

test("cleanPath keeps paths inside the vault", () => {
  assert.equal(cleanPath("./Projects//Roadmap.md"), "Projects/Roadmap.md");
  assert.equal(cleanPath("Projects\\Roadmap.md"), "Projects/Roadmap.md");
  assert.equal(cleanPath("/etc/passwd"), "etc/passwd");
  assert.equal(cleanPath("a/b/../c.md"), "a/c.md");
  assert.throws(() => cleanPath("../outside.md"), /Invalid path/);
  assert.throws(() => cleanPath("a/../../outside.md"), /Invalid path/);
  assert.throws(() => cleanPath(".commonink/index.db"), /Hidden paths/);
  assert.throws(() => cleanPath("Projects/.git/config"), /Hidden paths/);
  assert.throws(() => cleanPath(""), /Invalid path/);
  assert.throws(() => cleanPath("a\0b.md"), /Invalid path/);
  assert.throws(() => cleanPath("a\nb.md"), /Invalid path/);
});

test("search finds notes by body text and reports the matching lines", () => {
  const { vault } = openTempVault();
  const hits = vault.search("importer");
  assert.deepEqual(
    hits.map((h) => ({ path: h.path, title: h.title, lines: h.lines })),
    [{ path: "Projects/Roadmap.md", title: "Roadmap", lines: [{ line: 8, text: "- [ ] Ship the importer" }] }],
  );
  assert.deepEqual(vault.search("reading").map((h) => h.path), ["Dashboards/Stats.html"]);
});

test("resolve accepts paths, extensionless paths and wikilink names", () => {
  const { vault } = openTempVault();
  assert.equal(vault.resolve("Projects/Roadmap.md"), "Projects/Roadmap.md");
  assert.equal(vault.resolve("Projects/Roadmap"), "Projects/Roadmap.md");
  assert.equal(vault.resolve("roadmap"), "Projects/Roadmap.md");
  assert.equal(vault.resolve("[[nothing]]"), null);
  assert.equal(vault.resolve("../../etc/passwd"), null);
});

test("a folder-qualified name matches whole folder names, not the end of another folder's", () => {
  const { vault } = openTempVault({ "MyIdeas/Pricing.md": "# Pricing\n", "Work/Ideas/Plan.md": "# Plan\n", "A.md": "[[Ideas/Pricing]]\n" });
  assert.equal(vault.resolve("Ideas/Pricing"), null);
  assert.equal(vault.resolve("Ideas/Plan"), "Work/Ideas/Plan.md");
  assert.deepEqual(vault.backlinks("MyIdeas/Pricing").map((b) => b.path), []);
});

test("a path typed in another case is the note's own path, not a second note", () => {
  const { vault } = openTempVault();
  assert.equal(vault.resolve("projects/roadmap"), "Projects/Roadmap.md");
  assert.equal(vault.read("projects/roadmap.md").path, "Projects/Roadmap.md");
  vault.edit("projects/roadmap", { oldString: "Ship the importer", newString: "Ship it" }, "t");
  assert.deepEqual(vault.list(undefined, "all").map((n) => n.path), ["assets/chart.svg", "Dashboards/Stats.html", "Projects/Roadmap.md", "Welcome.md"]);
  assert.deepEqual(vault.tasks().map((t) => `${t.path}:${t.text}`), ["Projects/Roadmap.md:Ship it", "Projects/Roadmap.md:Write the parser"]);
  assert.deepEqual(vault.changes().map((c) => c.path), ["Projects/Roadmap.md"]);
});

test("renaming a note to another case never replaces a different file with that name", () => {
  const { dir, vault } = openTempVault({ "Notes.md": "# Mine\nimportant" });
  vault.move("Notes.md", "NOTES.md", "t");
  assert.equal(vault.read("NOTES.md").path, "NOTES.md");
  const sensitive = !fs.existsSync(path.join(dir, "notes.md"));
  if (!sensitive) return; // on a case-insensitive disk the two names are one file
  fs.writeFileSync(path.join(dir, "notes.md"), "# Other\nexternal data");
  assert.throws(() => vault.move("NOTES.md", "notes.md", "t"), /already exists/);
  assert.equal(fs.readFileSync(path.join(dir, "notes.md"), "utf8"), "# Other\nexternal data");
  assert.equal(fs.readFileSync(path.join(dir, "NOTES.md"), "utf8"), "# Mine\nimportant");
});

test("a file named in decomposed Unicode is the note a link or path in composed Unicode means", () => {
  const nfd = "Café".normalize("NFD");
  const { vault } = openTempVault({ [`${nfd}.md`]: "# Café\n\n- [ ] one\n", "A.md": "See [[Café]]\n" });
  assert.equal(vault.resolve("Café"), `${nfd}.md`);
  assert.equal(vault.resolve("Café.md"), `${nfd}.md`);
  vault.edit("Café", { oldString: "one", newString: "two" }, "t");
  assert.deepEqual(vault.list().map((n) => n.path), ["A.md", `${nfd}.md`]);
  assert.deepEqual(vault.tasks().map((t) => `${t.path}:${t.text}`), [`${nfd}.md:two`]);
  assert.deepEqual(vault.backlinks(`${nfd}.md`).map((b) => b.path), ["A.md"]);
});

test("an index from before composed names learns them on open", () => {
  const nfd = "Café".normalize("NFD");
  const { dir, vault } = openTempVault({ [`Places/${nfd}.md`]: "# Café\n" });
  vault.db.run("UPDATE notes SET stem = ?", nfd.toLowerCase());
  assert.equal(openVault(dir).resolve("café"), `Places/${nfd}.md`);
});

test("edit replaces one exact string and refuses ambiguous or stale edits", () => {
  const { dir, vault } = openTempVault();
  const before = vault.read("Roadmap");
  const r = vault.edit("Roadmap", { oldString: "Ship the importer", newString: "Ship the exporter" }, "tester");
  assert.equal(fs.readFileSync(path.join(dir, "Projects/Roadmap.md"), "utf8").includes("- [ ] Ship the exporter\n"), true);
  assert.equal(r.change.source, "tester");
  assert.equal(r.change.summary, "+1 −1");
  assert.throws(() => vault.edit("Roadmap", { oldString: "- [", newString: "* [" }, "t"), /occurs 2 times/);
  assert.throws(() => vault.edit("Roadmap", { oldString: "Ship", newString: "x", baseVersion: before.version }, "t"), /Re-read it and retry/);
});

test("moving a note rewrites the links that point at it", () => {
  const { dir, vault } = openTempVault();
  const r = vault.move("Roadmap", "Projects/Plan.md", "tester");
  assert.deepEqual(r.updated, ["Welcome.md"]);
  assert.equal(fs.readFileSync(path.join(dir, "Welcome.md"), "utf8"), "# Welcome\n\nStart with [[Plan]].\n\n![[chart.svg]]\n");
  assert.deepEqual(vault.backlinks("Plan").map((b) => b.path), ["Welcome.md"]);
});

test("moving a note keeps a markdown link's #heading", () => {
  const { vault } = openTempVault({ "A.md": "# A\n\nSee [plan](B.md#now) and [[B#Now]].\n", "B.md": "# B\n\n## Now\n" });
  vault.move("B", "C.md", "t");
  assert.equal(vault.read("A").content, "# A\n\nSee [plan](C.md#now) and [[C#Now]].\n");
});

test("moving a note leaves alone a link in the same note that points at another note with its name", () => {
  const { vault } = openTempVault({ "Other/A.md": "# A\n\n[[Projects/B]] and [local](B.md)\n", "Other/B.md": "# other B\n", "Projects/B.md": "# proj B\n" });
  vault.move("Projects/B.md", "Projects/C.md", "t");
  assert.equal(vault.read("Other/A.md").content, "# A\n\n[[C]] and [local](B.md)\n");
});

test("moving a note rewrites a markdown link that reaches it through ../", () => {
  const { vault } = openTempVault({ "Team/Standup.md": "# Standup\n\n[the plan](../Plan.md)\n", "Plan.md": "# Plan\n" });
  vault.move("Plan.md", "Plan 2027.md", "t");
  assert.equal(vault.read("Team/Standup").content, "# Standup\n\n[the plan](Plan%202027.md)\n");
  assert.deepEqual(vault.backlinks("Plan 2027").map((b) => b.path), ["Team/Standup.md"]);
});

test("backlinks include markdown links relative to the linking note's folder, in an older index too", () => {
  const files = { "Team/Standup.md": "[up](../Plan.md)\n\n[down](Sub/Plan.md)\n", "Plan.md": "# Plan\n", "Team/Sub/Plan.md": "# Sub plan\n" };
  const { dir, vault } = openTempVault(files);
  assert.deepEqual(vault.backlinks("Plan.md").map((b) => b.text), ["[up](../Plan.md)"]);
  assert.deepEqual(vault.backlinks("Team/Sub/Plan.md").map((b) => b.text), ["[down](Sub/Plan.md)"]);
  vault.db.run("UPDATE links SET key = CASE line WHEN 1 THEN '../plan' ELSE 'sub/plan' END");
  const reopened = openVault(dir);
  assert.deepEqual(reopened.backlinks("Plan.md").map((b) => b.text), ["[up](../Plan.md)"]);
  assert.deepEqual(reopened.backlinks("Team/Sub/Plan.md").map((b) => b.text), ["[down](Sub/Plan.md)"]);
});

test("moving a note rewrites a link that would otherwise fall through to another note with its old name", () => {
  const { vault } = openTempVault({ "A.md": "# A\n\n[[B]]\n", "Projects/B.md": "# proj B\n", "Old/Deeper/B.md": "# old B\n" });
  vault.move("Projects/B.md", "Projects/C.md", "t");
  assert.equal(vault.read("A").content, "# A\n\n[[C]]\n");
  assert.equal(vault.resolve("C", "A.md"), "Projects/C.md");
});

test("renaming a note rewrites its own links to itself", () => {
  const { vault } = openTempVault({ "Guide.md": "# Guide\n\nJump to [[Guide#Setup]] or [setup](Guide.md#setup).\n\n## Setup\n", "Other.md": "[[Guide]]\n" });
  const r = vault.move("Guide.md", "Handbook.md", "t");
  assert.equal(vault.read("Handbook").content, "# Guide\n\nJump to [[Handbook#Setup]] or [setup](Handbook.md#setup).\n\n## Setup\n");
  assert.deepEqual(r.updated, ["Other.md"]);
  assert.equal(r.version, vault.read("Handbook").version);
});

test("moving a note leaves links in code as written", () => {
  const { vault } = openTempVault({ "A.md": "# A\n\n[[B]]\n\n```\nwrite [[B]] to link\n```\n\nInline `[[B]]` too\n", "B.md": "# B\n" });
  vault.move("B", "C.md", "t");
  assert.equal(vault.read("A").content, "# A\n\n[[C]]\n\n```\nwrite [[B]] to link\n```\n\nInline `[[B]]` too\n");
});

test("moving a note to a name with parentheses keeps its markdown links working", () => {
  const { vault } = openTempVault({ "A.md": "# A\n\n[b](B.md)\n", "B.md": "# B\n" });
  vault.move("B", "B (old).md", "t");
  assert.equal(vault.read("A").content, "# A\n\n[b](B%20%28old%29.md)\n");
  assert.deepEqual(vault.backlinks("B (old).md").map((b) => b.path), ["A.md"]);
});

test("renaming a note can change just the case of its name", () => {
  const { dir, vault } = openTempVault({ "meeting notes.md": "# m\n", "A.md": "[[meeting notes]]\n" });
  const r = vault.move("meeting notes.md", "Meeting Notes.md", "t");
  assert.equal(r.path, "Meeting Notes.md");
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort(), ["A.md", "Meeting Notes.md"]);
  assert.deepEqual(vault.list().map((n) => n.path), ["A.md", "Meeting Notes.md"]);
  assert.deepEqual(vault.backlinks("Meeting Notes").map((b) => b.path), ["A.md"]);
});

test("creating a second top-level note with the same title leaves the first as it was", () => {
  const { dir, vault } = openTempVault({});
  vault.create("Idea", "# Idea\n\nThe first one.\n", "t");
  assert.throws(() => vault.create("Idea", "# Idea\n\nThe second one.\n", "t"), /Idea\.md already exists\. To replace it, create it again with overwrite/);
  assert.equal(fs.readFileSync(path.join(dir, "Idea.md"), "utf8"), "# Idea\n\nThe first one.\n");
  assert.deepEqual(vault.list().map((n) => n.path), ["Idea.md"]);
});

test("moving a note to a folder puts it in the folder under its own name, as mv does", () => {
  for (const to of ["Projects/", "./Projects/", "Ideas/"]) {
    const { vault } = openTempVault();
    const r = vault.move("Welcome.md", to, "t");
    const folder = to.replace(/^\.\//, "").replace(/\/$/, "");
    assert.equal(r.path, `${folder}/Welcome.md`, to);
    assert.equal(vault.read(`${folder}/Welcome`).content, "# Welcome\n\nStart with [[Roadmap]].\n\n![[chart.svg]]\n");
  }
});

test("a note can't be moved to a different file type", () => {
  const { dir, vault } = openTempVault();
  assert.throws(() => vault.move("Welcome", "Welcome.png", "t"), /can't change .* from \.md to \.png/);
  assert.throws(() => vault.move("Welcome", "Welcome.html", "t"), /can't change/);
  assert.equal(fs.existsSync(path.join(dir, "Welcome.md")), true);
});

test("archive and unarchive round-trip a note and keep it out of listings", () => {
  const { vault } = openTempVault();
  assert.equal(vault.archive("Roadmap", "t").path, "Archive/Projects/Roadmap.md");
  assert.deepEqual(vault.list(undefined, "active").map((n) => n.path), ["assets/chart.svg", "Dashboards/Stats.html", "Welcome.md"]);
  assert.deepEqual(vault.search("importer"), []);
  assert.equal(vault.resolve("Roadmap"), "Archive/Projects/Roadmap.md");
  assert.equal(vault.unarchive("Roadmap", "t").path, "Projects/Roadmap.md");
});

test("a workspace's own archive folder is the archive: archiving goes there and what's in it is archived", () => {
  const { vault } = openTempVault({
    "4. Archive/Old plan.md": "# Old plan\n\nSee [[Plan]]\n\n- [ ] Old task\n",
    "Projects/Plan.md": "# Plan\n\nThe plan\n",
    "Notes/Live.md": "# Live\n\nSee [[Plan]]\n",
  });
  assert.deepEqual(vault.list().map((n) => n.path), ["Notes/Live.md", "Projects/Plan.md"]);
  assert.deepEqual(vault.list(undefined, "archived").map((n) => n.path), ["4. Archive/Old plan.md"]);
  assert.deepEqual(vault.search("old").map((h) => h.path), []);
  assert.deepEqual(vault.search("old", 10, "archived").map((h) => h.path), ["4. Archive/Old plan.md"]);
  assert.deepEqual(vault.tasks(), []);
  assert.equal(vault.archiveFolder(), "4. Archive/");
  assert.equal(vault.archive("Live", "t").path, "4. Archive/Notes/Live.md");
  assert.equal(vault.unarchive("Live", "t").path, "Notes/Live.md");
  // Archive/ made by the app before doesn't win over the workspace's own folder.
  vault.archive("Plan", "t");
  vault.move("4. Archive/Projects/Plan.md", "Archive/Projects/Plan.md", "t");
  assert.equal(vault.archiveFolder(), "4. Archive/");
  assert.equal(vault.unarchive("Plan", "t").path, "Projects/Plan.md");
});

test("backlinks leave out archived notes when asked, unless the note itself is archived", () => {
  const { vault } = openTempVault({
    "Archive/Plan copy.md": "# Plan copy\n\n[[Plan]] and [[Old]]\n",
    "Archives/Old.md": "# Old\n\nGone\n",
    "Projects/Plan.md": "# Plan\n\n[[Old]]\n",
    "Notes/Live.md": "# Live\n\n[[Plan]]\n",
  });
  const from = (target: string, scope?: "active" | "all") => vault.backlinks(target, scope).map((b) => b.path).sort();
  assert.deepEqual(from("Plan"), ["Archive/Plan copy.md", "Notes/Live.md"]);
  assert.deepEqual(from("Plan", "active"), ["Notes/Live.md"]);
  assert.deepEqual(from("Old", "active"), ["Archive/Plan copy.md", "Projects/Plan.md"]);
  // An agent asking over MCP hears that some were left out, and how to see them.
  const run = (args: Record<string, unknown>) => notes.find((c) => c.mcp === "backlinks")!.run({ vault, source: "t" } as never, args as never) as { text: string };
  assert.equal(run({ path: "Plan" }).text, "- Notes/Live.md:3 (wikilink) [[Plan]]\n1 more from archived note (include_archived to see them).");
  // Newest first, so which comes first depends on when each note was last saved.
  const all = run({ path: "Plan", include_archived: true }).text.split("\n").sort();
  assert.deepEqual(all, ["- Archive/Plan copy.md:3 (wikilink) [[Plan]] and [[Old]]", "- Notes/Live.md:3 (wikilink) [[Plan]]"]);
});

test("restore puts a note back the way it was before a change", () => {
  const { vault } = openTempVault();
  const original = vault.read("Welcome").content;
  const { change } = vault.append("Welcome", "An extra line", "t");
  assert.equal(vault.read("Welcome").content, `${original}\nAn extra line\n`);
  vault.restore(change.id, "t");
  assert.equal(vault.read("Welcome").content, original);
});

test("tasks come from checkbox lines with the heading above them", () => {
  const { vault } = openTempVault();
  assert.deepEqual(
    vault.tasks().map(({ path, line, text, done, heading }) => ({ path, line, text, done, heading })),
    [
      { path: "Projects/Roadmap.md", line: 8, text: "Ship the importer", done: false, heading: "Now" },
      { path: "Projects/Roadmap.md", line: 9, text: "Write the parser", done: true, heading: "Now" },
    ],
  );
  vault.setTask("Roadmap", 8, "Ship the importer", true, "t");
  assert.equal(vault.tasks()[0].done, true);
});

test("tasks and headings in code don't count, whichever fence the code uses", () => {
  const note = "# Code\n\n~~~md\n## Not a heading\n```js\n- [ ] not a task\n~~~\n\n    - [ ] indented code, not a task\n\n## Real\n- [ ] a real task\n";
  const { vault } = openTempVault({ "Code.md": note });
  assert.deepEqual(vault.tasks().map((t) => [t.line, t.text, t.heading]), [[12, "a real task", "Real"]]);
});

test("save writes only notes: never over an asset, never a file type the vault doesn't hold", () => {
  const { dir, vault } = openTempVault();
  const svg = fs.readFileSync(path.join(dir, "assets/chart.svg"), "utf8");
  assert.throws(() => vault.save("assets/chart.svg", "clobbered", { source: "t" }), /isn't a note/);
  assert.equal(fs.readFileSync(path.join(dir, "assets/chart.svg"), "utf8"), svg);
  assert.throws(() => vault.save("run.sh", "echo hi", { source: "t" }), /isn't a note/);
  assert.equal(fs.existsSync(path.join(dir, "run.sh")), false);
  assert.equal(vault.save("New.md", "# New\n", { source: "t" }).change?.op, "create");
});

test("uploadPath picks a free name and refuses file types the vault doesn't store", () => {
  const { vault } = openTempVault();
  assert.equal(vault.uploadPath("chart.svg"), "assets/chart 2.svg");
  assert.equal(vault.uploadPath("C:\\Users\\me\\photo.PNG"), "assets/photo.PNG");
  assert.equal(vault.uploadPath("../../escape.png"), "assets/escape.png");
  assert.throws(() => vault.uploadPath("notes.md"), /Can't upload notes\.md/);
  assert.throws(() => vault.uploadPath(""), /Invalid path|Can't upload/);
  assert.throws(() => vault.uploadPath("x.png", "../.."), /Invalid path/);
});

test("the clock lever decides change timestamps and the attribution window", () => {
  let now = Date.UTC(2026, 0, 1);
  const { vault } = openTempVault(undefined, { now: () => now });
  const { change, version } = vault.append("Welcome", "Hi", "agent-a");
  assert.equal(change.ts, Date.UTC(2026, 0, 1));
  assert.equal(vault.attribution("Welcome.md", version)?.source, "agent-a");
  now += 121_000;
  assert.equal(vault.attribution("Welcome.md", version), null);
  assert.deepEqual(vault.changes({ since: "2025-12-31T23:59:59Z" }).map((c) => c.id), [change.id]);
  assert.deepEqual(vault.changes({ since: "2026-01-01T00:00:00Z" }), []);
});

test("a failed disk write leaves the note, the index and the change log as they were", () => {
  const { vault } = openTempVault();
  const before = vault.read("Welcome");
  const lastChange = vault.changes({ limit: 1 })[0]?.id ?? 0;
  vault.files.write = () => {
    throw Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" });
  };
  assert.throws(() => vault.append("Welcome", "lost", "t"), /ENOSPC/);
  assert.equal(vault.read("Welcome").content, before.content);
  assert.equal(vault.meta("Welcome.md")?.version, before.version);
  assert.deepEqual(vault.changes({ since: lastChange }), []);
});

test("a note renamed on disk keeps its ID within the rename window, and not after", () => {
  let now = Date.UTC(2026, 0, 1);
  const { dir, vault } = openTempVault(undefined, { now: () => now });
  const id = vault.meta("Projects/Roadmap.md")!.id;
  /** Delete `from`, let `gapMs` pass, then write the same text at `to`, syncing after each step as the watcher would. */
  const rename = (from: string, to: string, gapMs: number) => {
    const text = fs.readFileSync(path.join(dir, from), "utf8");
    fs.rmSync(path.join(dir, from));
    vault.sync();
    now += gapMs;
    fs.writeFileSync(path.join(dir, to), text);
    vault.sync();
    return vault.meta(to)!.id;
  };
  assert.equal(rename("Projects/Roadmap.md", "Projects/Plan.md", 30_000), id);
  assert.notEqual(rename("Projects/Plan.md", "Projects/Later.md", 61_000), id);
});

test("a star follows its note through moves, archiving and renames, and is each person's own", () => {
  const { dir, vault } = openTempVault();
  vault.star("ana", "Roadmap");
  vault.star("ana", "Welcome");
  vault.star("ana", "Roadmap"); // again: no change
  vault.star("bo", "Welcome");
  vault.move("Roadmap", "Plans/Roadmap", "t");
  vault.archive("Welcome", "t");
  fs.renameSync(path.join(dir, "Plans/Roadmap.md"), path.join(dir, "Plans/Q3.md"));
  vault.sync();
  assert.deepEqual(notesOf(vault.favorites("ana")), ["Plans/Q3.md", "Archive/Welcome.md"]);
  vault.unarchive("Archive/Welcome.md", "t");
  assert.deepEqual(notesOf(vault.orderFavorites("ana", ["Welcome"])), ["Welcome.md", "Plans/Q3.md"]);
  assert.deepEqual(notesOf(vault.unstar("ana", "Welcome")), ["Plans/Q3.md"]);
  assert.deepEqual(notesOf(vault.favorites("bo")), ["Welcome.md"]);
});

test("a starred note deleted and restored under a new ID keeps its star", () => {
  let now = Date.UTC(2026, 0, 1);
  const { dir, vault } = openTempVault(undefined, { now: () => now });
  vault.star("ana", "Welcome");
  const text = fs.readFileSync(path.join(dir, "Welcome.md"), "utf8");
  fs.rmSync(path.join(dir, "Welcome.md"));
  vault.sync();
  assert.deepEqual(vault.favorites("ana"), []);
  now += 3600_000; // long after the rename window: the note comes back with a new ID
  fs.writeFileSync(path.join(dir, "Welcome.md"), text);
  vault.sync();
  const back = vault.meta("Welcome.md")!;
  assert.deepEqual(vault.favorites("ana").map((n) => (n as NoteMeta).id), [back.id]);
  assert.deepEqual(vault.unstar("ana", back.id), []);
});

test("reordering favorites while a starred note is gone leaves it last when it comes back", () => {
  let now = Date.UTC(2026, 0, 1);
  const { dir, vault } = openTempVault(undefined, { now: () => now });
  vault.star("ana", "Welcome");
  vault.star("ana", "Roadmap");
  vault.star("ana", "Dashboards/Stats.html");
  const text = fs.readFileSync(path.join(dir, "Welcome.md"), "utf8");
  fs.rmSync(path.join(dir, "Welcome.md"));
  vault.sync();
  assert.deepEqual(notesOf(vault.orderFavorites("ana", ["Dashboards/Stats.html", "Roadmap"])), ["Dashboards/Stats.html", "Projects/Roadmap.md"]);
  now += 3600_000;
  fs.writeFileSync(path.join(dir, "Welcome.md"), text);
  vault.sync();
  assert.deepEqual(notesOf(vault.favorites("ana")), ["Dashboards/Stats.html", "Projects/Roadmap.md", "Welcome.md"]);
});

test("a tag can be a favorite: in the same order as notes, following renames, dropping out when unused", () => {
  const { vault } = openTempVault({ "A.md": "# A\n\n#work/clients #home\n", "B.md": "# B\n\n#work/clients/acme\n" });
  const shown = (user = "ana") => vault.favorites(user).map((f) => ("tag" in f ? `#${f.display} ${f.notes}` : "path" in f ? f.path : f.name));
  vault.star("ana", "A");
  vault.starTag("ana", "#Work/Clients");
  vault.starTag("ana", "work/clients"); // again: no change
  vault.starTag("ana", "home");
  assert.deepEqual(shown(), ["A.md", "#work/clients 2", "#home 1"]);
  assert.deepEqual(vault.orderFavorites("ana", ["#home", "A.md"]).map((f) => ("tag" in f ? f.tag : "path" in f ? f.path : f.name)), ["home", "A.md", "work/clients"]);
  assert.throws(() => vault.starTag("ana", "nowhere"), /No note has #nowhere/);
  assert.deepEqual(shown("bo"), []);

  vault.renameTag("work", "Job", "t"); // the favorite follows, children and all
  assert.deepEqual(shown(), ["#home 1", "A.md", "#Job/clients 2"]);
  vault.renameTag("home", "Job/clients", "t"); // a merge onto one they have keeps one
  assert.deepEqual(shown(), ["A.md", "#Job/clients 2"]);

  vault.edit("A", { oldString: "#Job/clients #Job/clients", newString: "" }, "t");
  vault.edit("B", { oldString: "#Job/clients/acme", newString: "" }, "t");
  assert.deepEqual(shown(), ["A.md"]); // unused: out of sight, but kept
  vault.append("B", "#job/clients again", "t");
  assert.deepEqual(shown(), ["A.md", "#Job/clients 1"]);
  assert.deepEqual(vault.unstarTag("ana", "job/clients").map((f) => ("tag" in f ? f.tag : "path" in f ? f.path : f.name)), ["A.md"]);
});

test("favorites from before tag favorites keep their notes, and a tag can be starred after the upgrade", () => {
  const { dir, vault } = openTempVault({ "A.md": "# A\n\n#work\n" });
  vault.star("ana", "A");
  const reopened = openVault(dir);
  assert.deepEqual(reopened.favorites("ana").map((f) => ("tag" in f ? f.tag : "path" in f ? f.path : f.name)), ["A.md"]);
  reopened.starTag("ana", "work");
  assert.deepEqual(reopened.favorites("ana").map((f) => ("tag" in f ? f.tag : "path" in f ? f.path : f.name)), ["A.md", "work"]);
});

test("only notes can be starred, not assets", () => {
  const { vault } = openTempVault();
  assert.throws(() => vault.star("ana", "assets/chart.svg"), /assets\/chart\.svg is a binary asset, not a note/);
  assert.deepEqual(vault.favorites("ana"), []);
});

test("a note's history follows it through moves, archiving and renames outside the app", () => {
  const { dir, vault } = openTempVault();
  const mine = [vault.create("Draft", "# Draft\n", "t").change.id];
  mine.push(vault.append("Draft", "first", "t").change.id);
  mine.push(vault.move("Draft", "Projects/Plan", "t").change!.id);
  mine.push(vault.archive("Projects/Plan", "t").change!.id);
  mine.push(vault.unarchive("Archive/Projects/Plan.md", "t").change!.id);
  vault.append("Welcome", "not this one", "t");
  fs.renameSync(path.join(dir, "Projects/Plan.md"), path.join(dir, "Projects/Final.md"));
  vault.sync();
  mine.push(vault.append("Projects/Final", "second", "t").change.id);
  const reborn = vault.create("Draft", "# Draft, again\n", "t").change.id;

  const id = vault.meta("Projects/Final.md")!.id;
  const newestFirst = [...mine].reverse();
  for (const target of ["Projects/Final.md", id, `/notes/draft-${id}`]) {
    assert.deepEqual(vault.changes({ path: target }).map((c) => c.id), newestFirst, target);
  }
  assert.deepEqual(vault.changes({ path: "Draft.md" }).map((c) => c.id), [reborn]);
  assert.deepEqual(vault.changes({ path: id, before: mine[3] }).map((c) => c.id), [mine[2], mine[1], mine[0]]);
  const next = vault.reassignId(id);
  assert.deepEqual(vault.changes({ path: next }).map((c) => c.id), newestFirst);
});

test("an older change log gets note IDs from the moves it recorded", () => {
  const { dir, vault } = openTempVault();
  const a = [vault.create("A", "# A\n", "t").change.id, vault.append("A", "more", "t").change.id, vault.move("A", "B", "t").change!.id];
  const a2 = vault.create("A", "# Another A\n", "t").change.id;
  vault.create("C", "# C\n", "t");
  const toD = vault.move("C", "D", "t").change!.id;
  fs.rmSync(path.join(dir, "D.md"));
  fs.writeFileSync(path.join(dir, "C.md"), "# A new C, made outside the app\n");
  vault.sync();
  vault.db.exec("DROP INDEX changes_note");
  vault.db.exec("ALTER TABLE changes DROP COLUMN note_id");

  const reopened = openVault(dir);
  assert.deepEqual(reopened.changes({ path: "B.md" }).map((c) => c.id), [...a].reverse());
  assert.deepEqual(reopened.changes({ path: "A.md" }).map((c) => c.id), [a2]);
  assert.equal(reopened.changes({ path: "B.md" })[0].note_id, reopened.meta("B.md")!.id);
  assert.deepEqual(reopened.changes({ path: "C.md" }).map((c) => c.id), []);
  assert.deepEqual(reopened.changes({ path: "D.md" }).map((c) => c.id), [toD]);
});

test("a change-log upgrade that fails partway runs again on the next start", () => {
  const { dir, vault } = openTempVault();
  const a = [vault.create("A", "# A\n", "t").change.id, vault.move("A", "B", "t").change!.id];
  vault.db.exec("DROP INDEX changes_note");
  vault.db.exec("ALTER TABLE changes DROP COLUMN note_id");
  vault.db.exec("CREATE TRIGGER interrupt BEFORE UPDATE ON changes BEGIN SELECT RAISE(ABORT, 'interrupted'); END");
  assert.throws(() => openVault(dir), /interrupted/);
  vault.db.exec("DROP TRIGGER interrupt");

  assert.deepEqual(openVault(dir).changes({ path: "B.md" }).map((c) => c.id), [...a].reverse());
});

const TAGGED: Record<string, string> = {
  "Projects/Acme.md": "---\ntags: [Work/Clients/Acme]\n---\n# Acme\n\n- [ ] Send the invoice #billing\n- [x] Kickoff #Work/meetings\n",
  "Ideas/Workshop.md": "# Workshop\n\nA #workshop idea, not #work. `#code` doesn't count.\n",
  "Journal/2026-09-27.md": "# 2026-09-27\n\nFixed #27 and met #work/clients/beta.\n",
  "assets/logo.svg": "<svg/>",
};

test("one index answers everything under a tag across notes, tasks and assets", () => {
  const { vault } = openTempVault(TAGGED);
  vault.setAssetTags("assets/logo.svg", ["work/brand", "Design"]);
  assert.deepEqual(
    vault.tagged("#WORK").map((r) => `${r.kind} ${r.path}:${r.line}`),
    ["note Ideas/Workshop.md:3", "note Journal/2026-09-27.md:3", "note Projects/Acme.md:2", "task Projects/Acme.md:7", "asset assets/logo.svg:0"],
  );
  const counts = Object.fromEntries(vault.tags().map((t) => [t.tag, [t.notes, t.tasks, t.assets]]));
  assert.deepEqual(counts, {
    billing: [0, 1, 0], // only on a task: the task carries it, not its note
    design: [0, 0, 1],
    work: [3, 1, 1],
    "work/brand": [0, 0, 1],
    "work/clients": [2, 0, 0],
    "work/clients/acme": [1, 0, 0],
    "work/clients/beta": [1, 0, 0],
    "work/meetings": [0, 1, 0],
    workshop: [1, 0, 0],
  });
});

test("tag counts leave out exactly the archive folders, and tags outside the Basic Multilingual Plane match their children", () => {
  const { vault } = openTempVault({ "archive/n.md": "# N\n\n#t\n", "Old/Archive/o.md": "# O\n\n#t\n", "Work/m.md": "# M\n\n#t #𝐀lpha/beta\n" });
  assert.deepEqual(vault.tags().map((t) => `${t.tag} ${t.notes}`), ["t 2", "𝐀lpha 1", "𝐀lpha/beta 1"]);
  assert.deepEqual(vault.tagged("𝐀lpha").map((r) => r.path), ["Work/m.md"]);
  assert.deepEqual(vault.search("m", 10, "active", "𝐀lpha").map((h) => h.path), ["Work/m.md"]);
});

test("a tag on a task tags the task, not its note: tag filters on notes leave the note out", () => {
  const { vault } = openTempVault({
    "Open tasks.md": "# Open tasks\n\n- [ ] Book the studio #areas/podcast\n- [ ] Renew the lease #areas/home\n",
    "Areas/Podcast.md": "# Podcast\n\n#areas/podcast\n\n- [ ] Edit EP26 #areas/podcast\n",
  });
  const notes = (tag: string) => vault.feed({ tag }).items.map((i) => i.path);
  assert.deepEqual(notes("areas/podcast"), ["Areas/Podcast.md"]);
  assert.deepEqual(notes("areas/home"), []);
  assert.deepEqual(vault.search("podcast", 10, "active", "areas").map((h) => h.path), ["Areas/Podcast.md"]);
  assert.deepEqual(vault.list(undefined, "active", "areas").map((n) => n.path), ["Areas/Podcast.md"]);
  assert.deepEqual(vault.feed({}).items.find((i) => i.path === "Open tasks.md")?.tags, []);
  // The tasks keep their tags, and the tag list counts them as tasks.
  assert.deepEqual(vault.tasks({ tag: "areas" }).map((t) => t.path).sort(), ["Areas/Podcast.md", "Open tasks.md", "Open tasks.md"]);
  assert.deepEqual(vault.tags().filter((t) => t.tag.startsWith("areas")).map((t) => `${t.tag} ${t.notes}/${t.tasks}`), ["areas 1/3", "areas/home 0/1", "areas/podcast 1/2"]);
});

test("a tag is shown the way it was first written, whatever case later notes use", () => {
  const { vault } = openTempVault({});
  vault.create("A", "# A\n\n#Work/Acme\n", "t");
  vault.create("B", "# B\n\n#work #WORK/acme #work/new\n", "t");
  assert.deepEqual(vault.tags().map((t) => t.display), ["Work", "Work/Acme", "Work/new"]);
});

test("the index follows edits, and the Notes feed, search, lists and tasks filter by a tag and its children", () => {
  const { vault } = openTempVault(TAGGED);
  const feed = (tag: string) => vault.feed({ tag }).items.map((i) => i.path).sort();
  assert.deepEqual(feed("work/clients"), ["Journal/2026-09-27.md", "Projects/Acme.md"]);
  assert.deepEqual(vault.feed({ tag: "work/clients/acme" }).items.map((i) => [i.path, i.tags.map((t) => t.toLowerCase())]), [
    ["Projects/Acme.md", ["work/clients/acme"]],
  ]);
  vault.edit("Ideas/Workshop", { oldString: "not #work", newString: "not work" }, "t");
  assert.deepEqual(feed("work"), ["Journal/2026-09-27.md", "Projects/Acme.md"]);
  assert.deepEqual(vault.search("idea", 10, "active", "workshop").map((h) => h.path), ["Ideas/Workshop.md"]);
  assert.deepEqual(vault.search("idea", 10, "active", "work").map((h) => h.path), []);
  assert.deepEqual(vault.list(undefined, "active", "work/clients").map((n) => n.path), ["Journal/2026-09-27.md", "Projects/Acme.md"]);
  assert.deepEqual(vault.tasks({ tag: "work" }).map((t) => t.text), ["Kickoff #Work/meetings"]);
  vault.archive("Projects/Acme", "t");
  assert.equal(vault.tags().some((t) => t.tag === "billing"), false);
});

test("a tag added by name is listed, parents included, until something carries it", () => {
  const { dir, vault } = openTempVault({ "A.md": "# A\n\n#home\n" });
  const listed = () => vault.tags().map((t) => `${t.display} ${t.notes}/${t.tasks}/${t.assets}`);
  vault.addTag("#Work/Clients");
  vault.addTag("work/clients"); // again, any case: nothing changes
  vault.addTag("Home"); // already in use: an ordinary tag
  assert.deepEqual(listed(), ["home 1/0/0", "Work 0/0/0", "Work/Clients 0/0/0"]);
  assert.throws(() => vault.addTag("two words"), /isn't a tag/);

  vault.create("B", "# B\n\n#work/clients/acme\n", "t");
  assert.deepEqual(listed(), ["home 1/0/0", "Work 1/0/0", "Work/Clients 1/0/0", "Work/Clients/acme 1/0/0"]);
  vault.delete(["B"], "t");
  assert.deepEqual(listed(), ["home 1/0/0"], "once used, it's an ordinary tag: it goes when its last note does");

  vault.addTag("later");
  assert.deepEqual(openVault(dir).tags().map((t) => t.tag), ["home", "later"], "kept beside the index");
});

test("a tag added by name can be renamed or taken away, but a tag in use can't be taken away", () => {
  const { vault } = openTempVault({ "A.md": "# A\n\n#home #work/old\n" });
  vault.addTag("Work/Clients/Acme");
  vault.addTag("work/new");
  const r = vault.renameTag("work", "Job", "t");
  assert.deepEqual(r.edits.map((e) => e.path), ["A.md"]);
  assert.deepEqual(vault.tags().map((t) => t.display), ["home", "Job", "Job/Clients", "Job/Clients/Acme", "Job/new", "Job/old"]);

  assert.throws(() => vault.removeTag("job"), /#Job is in use/);
  assert.deepEqual(vault.removeTag("#job/clients").map((t) => t.tag), ["home", "job", "job/new", "job/old"]);
  assert.deepEqual(vault.removeTag("job/clients").map((t) => t.tag), ["home", "job", "job/new", "job/old"], "taking it away again changes nothing");
});

test("renaming a tag rewrites it in every note and asset, and each note's change can be undone", () => {
  const { vault } = openTempVault(TAGGED);
  vault.setAssetTags("assets/logo.svg", ["work/brand"]);
  const r = vault.renameTag("work/clients", "Customers", "t");
  assert.deepEqual(r.edits.map((e) => e.path).sort(), ["Journal/2026-09-27.md", "Projects/Acme.md"]);
  assert.equal(vault.read("Projects/Acme").content.startsWith("---\ntags: [Customers/Acme]\n---\n"), true);
  assert.equal(vault.read("Journal/2026-09-27").content, "# 2026-09-27\n\nFixed #27 and met #Customers/beta.\n");
  assert.deepEqual(vault.tagged("work/clients"), []);
  assert.equal(vault.tags().find((t) => t.tag === "customers")?.display, "Customers");

  const merged = vault.renameTag("work", "design", "t");
  assert.deepEqual(merged.assets, { "assets/logo.svg": ["work/brand"] });
  assert.deepEqual(vault.assetTags(), { "assets/logo.svg": ["design/brand"] });
  for (const e of [...r.edits].reverse()) vault.restore(e.change.id, "t");
  assert.equal(vault.read("Journal/2026-09-27").content, TAGGED["Journal/2026-09-27.md"]);
  assert.throws(() => vault.renameTag("work", "not a tag", "t"), /isn't a tag/);
});

test("asset tags live in one vault file, follow the asset when it moves, and reload when the file changes", () => {
  const { dir, vault } = openTempVault(TAGGED);
  assert.deepEqual(vault.setAssetTags("logo.svg", ["#Brand", "brand", "Work/Brand"]), ["Brand", "Work/Brand"]);
  assert.throws(() => vault.setAssetTags("logo.svg", ["two words"]), /isn't a tag/);
  vault.move("assets/logo.svg", "assets/brand/logo.svg", "t");
  assert.equal(
    fs.readFileSync(path.join(dir, "assets/.tags.json"), "utf8"),
    '{\n  "assets/brand/logo.svg": [\n    "Brand",\n    "Work/Brand"\n  ]\n}\n',
  );
  fs.writeFileSync(path.join(dir, "assets/.tags.json"), JSON.stringify({ "assets/brand/logo.svg": ["photo"] }));
  vault.sync();
  assert.deepEqual(vault.tagged("photo").map((r) => r.path), ["assets/brand/logo.svg"]);
  assert.deepEqual(vault.setAssetTags("assets/brand/logo.svg", []), []);
  assert.equal(fs.readFileSync(path.join(dir, "assets/.tags.json"), "utf8"), "{}\n");
});

test("a hand-edited asset tags file that doesn't parse is left alone rather than overwritten", () => {
  const { dir, vault } = openTempVault(TAGGED);
  const file = path.join(dir, "assets/.tags.json");
  vault.setAssetTags("assets/logo.svg", ["brand"]);
  const broken = fs.readFileSync(file, "utf8").replace(/\]\n\}/, "],\n}");
  fs.writeFileSync(file, broken);
  assert.deepEqual(vault.assetTags(), {});
  assert.throws(() => vault.setAssetTags("assets/logo.svg", ["photo"]), /assets\/\.tags\.json isn't a valid tags file/);
  assert.throws(() => vault.renameTag("brand", "logo", "t"), /isn't a valid tags file/);
  assert.throws(() => vault.move("assets/logo.svg", "assets/brand/logo.svg", "t"), /isn't a valid tags file/);
  assert.throws(() => vault.delete(["assets/logo.svg"], "t"), /isn't a valid tags file/);
  assert.ok(fs.existsSync(path.join(dir, "assets/logo.svg")));
  assert.equal(fs.readFileSync(file, "utf8"), broken);
  fs.writeFileSync(file, '{"__proto__": ["odd"], "assets/logo.svg": ["brand"]}');
  vault.setAssetTags("assets/logo.svg", ["brand", "photo"]);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), JSON.parse('{"__proto__": ["odd"], "assets/logo.svg": ["brand", "photo"]}'));
});

test("tasks carry their tokens, filter by due date and person, and ticking one stamps the day it was done", () => {
  let now = Date.UTC(2026, 9, 1, 12);
  const { dir, vault } = openTempVault(
    {
      "Plan.md": "# Plan\n\n- [ ] Send invoice due:2026-09-30 @jane !high #billing\n- [ ] Draft the deck due:2026-10-03 @sam\n- [ ] Someday\n",
    },
    { now: () => now },
  );
  const [invoice] = vault.tasks();
  assert.deepEqual([invoice.summary, invoice.meta], [
    "Send invoice",
    { due: "2026-09-30", start: null, done: null, rec: null, until: null, times: null, priority: "high", assignees: ["jane"], tags: ["billing"] },
  ]);
  assert.deepEqual(vault.tasks({ due: "<=today" }).map((t) => t.summary), ["Send invoice"]);
  assert.deepEqual(vault.tasks({ due: "<=today", today: "2026-10-03" }).map((t) => t.summary), ["Send invoice", "Draft the deck"]);
  assert.deepEqual(vault.tasks({ assignee: "@Sam" }).map((t) => t.summary), ["Draft the deck"]);
  assert.throws(() => vault.tasks({ due: "soon" }), /due filter/);
  // Ranges, spans from today, priority, and the other dates.
  assert.deepEqual(vault.tasks({ due: ">=today <=+7d" }).map((t) => t.summary), ["Draft the deck"]);
  assert.deepEqual(vault.tasks({ priority: "high" }).map((t) => t.summary), ["Send invoice"]);
  assert.deepEqual(vault.tasks({ priority: "none" }).map((t) => t.summary), ["Draft the deck", "Someday"]);
  assert.deepEqual(vault.tasks({ start: "<=today" }), []);
  assert.throws(() => vault.tasks({ priority: "urgent" }), /priority filter/);
  assert.throws(() => vault.tasks({ done: ">=last week" }), /Bad done filter/);

  vault.setTask("Plan", 3, invoice.text, true, "t");
  assert.equal(fs.readFileSync(path.join(dir, "Plan.md"), "utf8").split("\n")[2], "- [x] Send invoice due:2026-09-30 @jane !high #billing done:2026-10-01");
  // What was done in the last week: a weekly review.
  assert.deepEqual(vault.tasks({ done: ">=-7d" }).map((t) => t.summary), ["Send invoice"]);
  assert.deepEqual(vault.tasks({ done: ">=-7d", today: "2026-10-09" }), []);
  now += 86_400_000;
  vault.setTask("Plan", 3, vault.tasks()[0].text, false, "t");
  assert.equal(fs.readFileSync(path.join(dir, "Plan.md"), "utf8").split("\n")[2], "- [ ] Send invoice due:2026-09-30 @jane !high #billing");
});

test("a quick-added task goes to today's daily note under Tasks, or to the note it names", () => {
  const { dir, vault } = openTempVault({ "Launch.md": "# Launch\n\n## Tasks\n\n- [ ] Book the venue\n\n## Notes\n\nText.\n" });
  const read = (p: string) => fs.readFileSync(path.join(dir, p), "utf8");
  const a = vault.addTask("Call mom tomorrow", "t", { today: "2026-09-28" });
  assert.deepEqual([a.path, a.line, a.text], ["Journal/2026-09-28.md", 5, "Call mom due:2026-09-29"]);
  assert.equal(read("Journal/2026-09-28.md"), "# 2026-09-28\n\n## Tasks\n\n- [ ] Call mom due:2026-09-29\n\n## Log\n");
  vault.addTask("Pay rent every month on the 1st #home", "t", { today: "2026-09-28" });
  assert.equal(read("Journal/2026-09-28.md"), "# 2026-09-28\n\n## Tasks\n\n- [ ] Call mom due:2026-09-29\n- [ ] Pay rent due:2026-10-01 rec:1st #home\n\n## Log\n");
  // A daily note without a Tasks section gets one at its end.
  fs.writeFileSync(path.join(dir, "Journal/2026-09-29.md"), "# 2026-09-29\n\n## Log\n\n- 09:00 hi\n");
  vault.sync();
  vault.addTask("Stretch", "t", { today: "2026-09-29" });
  assert.equal(read("Journal/2026-09-29.md"), "# 2026-09-29\n\n## Log\n\n- 09:00 hi\n\n## Tasks\n\n- [ ] Stretch\n");
  // → [[Note]] targets that note's Tasks section.
  const b = vault.addTask("Print the badges → [[Launch]] next fri", "t", { today: "2026-09-28" });
  assert.deepEqual([b.path, b.line], ["Launch.md", 6]);
  assert.equal(read("Launch.md"), "# Launch\n\n## Tasks\n\n- [ ] Book the venue\n- [ ] Print the badges due:2026-10-02\n\n## Notes\n\nText.\n");
  // A phrase clicked away stays words.
  assert.equal(vault.addTask("Watch Next Week's show", "t", { today: "2026-09-28", ignore: ["next week"] }).text, "Watch Next Week's show");
  assert.throws(() => vault.addTask("tomorrow", "t", { today: "2026-09-28" }), /Say what the task is/);
  assert.throws(() => vault.addTask("x → [[Nowhere]]", "t"), /No note matches "Nowhere"/);
  assert.throws(() => vault.addTask("x", "t", { today: "someday" }), /"today" must be a date/);
});

test("today is overdue, due today and starting today, in sections, with today's journal note", () => {
  const { vault } = openTempVault({
    "Work.md": [
      "# Work",
      "",
      "- [ ] Late report due:2026-09-20",
      "- [ ] Later report due:2026-09-25",
      "- [ ] Standup due:2026-09-28 rec:weekdays",
      "- [ ] Pay rent due:2026-09-28 rec:1st",
      "- [ ] Draft the talk start:2026-09-28 due:2026-10-09",
      "- [ ] Overdue and started start:2026-09-28 due:2026-09-27",
      "- [x] Done already due:2026-09-28 done:2026-09-27",
      "- [ ] Next week due:2026-10-05",
      "- [ ] Just a thought",
      "",
    ].join("\n"),
  });
  const t = vault.today("2026-09-28");
  const titles = (id: string) => t.sections.find((s) => s.id === id)!.tasks.map((x) => x.summary);
  assert.deepEqual(t.sections.map((s) => [s.id, s.title]), [["overdue", "Overdue"], ["due", "Due today"], ["starting", "Starting today"]]);
  assert.deepEqual(titles("overdue"), ["Late report", "Later report", "Overdue and started"]);
  assert.deepEqual(titles("due"), ["Standup due:2026-09-28 rec:weekdays", "Pay rent"]); // rec:weekdays isn't a rule, so it's words
  assert.deepEqual(titles("starting"), ["Draft the talk"]);
  assert.deepEqual(t.journal, { path: "Journal/2026-09-28.md", exists: false });
  assert.throws(() => vault.today("Monday"), /"today" must be a date/);
});

test("today's journal note is made from Templates/Journal.md, else its old name Daily note.md, else a plain one", () => {
  const { dir, vault } = openTempVault({ "Welcome.md": "# Welcome\n" });
  const read = (p: string) => fs.readFileSync(path.join(dir, p), "utf8");
  const plain = vault.dailyNote("2026-09-28", "t");
  assert.deepEqual([plain.path, plain.created], ["Journal/2026-09-28.md", true]);
  assert.equal(read("Journal/2026-09-28.md"), "# 2026-09-28\n\n## Tasks\n\n## Log\n");
  assert.equal(vault.dailyNote("2026-09-28", "t").created, false);
  assert.equal(vault.today("2026-09-28").journal.exists, true);
  fs.mkdirSync(path.join(dir, "Templates"));
  fs.writeFileSync(path.join(dir, "Templates/Daily note.md"), "# {{date}}\n\n## Plan\n\n## Tasks\n\n## Notes\n");
  vault.sync();
  vault.dailyNote("2026-09-29", "t");
  assert.equal(read("Journal/2026-09-29.md"), "# 2026-09-29\n\n## Plan\n\n## Tasks\n\n## Notes\n");
  // Quick-add into a day with no note yet uses the same template.
  vault.addTask("Stretch", "t", { today: "2026-09-30" });
  assert.equal(read("Journal/2026-09-30.md"), "# 2026-09-30\n\n## Plan\n\n## Tasks\n\n- [ ] Stretch\n\n## Notes\n");
  // Templates/Journal.md wins over the old name when both are there.
  fs.writeFileSync(path.join(dir, "Templates/Journal.md"), "# {{date}}\n\n## Journal\n");
  vault.sync();
  vault.dailyNote("2026-10-01", "t");
  assert.equal(read("Journal/2026-10-01.md"), "# 2026-10-01\n\n## Journal\n");
});

test("quick-add can go to a note it's given, and removing a task takes it (and what's nested) back out", () => {
  const { dir, vault } = openTempVault({ "Launch.md": "# Launch\n\nNotes.\n", "Other.md": "# Other\n" });
  const read = (p: string) => fs.readFileSync(path.join(dir, p), "utf8");
  const r = vault.addTask("Print badges tomorrow", "t", { today: "2026-09-28", to: "Launch" });
  assert.deepEqual([r.path, r.line, r.text], ["Launch.md", 5, "Print badges due:2026-09-29"]);
  assert.equal(read("Launch.md"), "# Launch\n\nNotes.\n\n- [ ] Print badges due:2026-09-29\n");
  // → [[Note]] in the words wins over the note it was given.
  assert.equal(vault.addTask("Tidy → [[Other]]", "t", { today: "2026-09-28", to: "Launch" }).path, "Other.md");
  vault.removeTask("Launch", 5, "Print badges due:2026-09-29", "t");
  assert.equal(read("Launch.md"), "# Launch\n\nNotes.\n");
  assert.throws(() => vault.removeTask("Launch", 5, "Print badges due:2026-09-29", "t"), /isn't in Launch\.md any more/);
  assert.throws(() => vault.addTask("x", "t", { to: "Nowhere" }), /No note matches "Nowhere"/);
});

test("moving a task takes its line and the lines nested under it to another note's Tasks", () => {
  const { dir, vault } = openTempVault({
    "Inbox.md": "# Inbox\n\n- [ ] Plan the offsite @jane\n  - [ ] Pick a venue\n  Notes about it.\n- [ ] Other\n",
    "Offsite.md": "# Offsite\n\n## Tasks\n\n- [ ] Budget\n",
  });
  const read = (p: string) => fs.readFileSync(path.join(dir, p), "utf8");
  const r = vault.moveTask("Inbox", 3, "Plan the offsite @jane", "Offsite", "t");
  assert.deepEqual([r.path, r.line, r.text], ["Offsite.md", 6, "Plan the offsite @jane"]);
  assert.equal(read("Inbox.md"), "# Inbox\n\n- [ ] Other\n");
  assert.equal(read("Offsite.md"), "# Offsite\n\n## Tasks\n\n- [ ] Budget\n- [ ] Plan the offsite @jane\n  - [ ] Pick a venue\n  Notes about it.\n");
  assert.equal(vault.tasks({ note: "Offsite" }).length, 3);
  assert.throws(() => vault.moveTask("Offsite", 6, "Plan the offsite @jane", "Offsite", "t"), /already in Offsite\.md/);
  assert.throws(() => vault.moveTask("Inbox", 3, "stale", "Offsite", "t"), /isn't in Inbox\.md any more/);
});

test("a task that can't go into the other note stays where it was", () => {
  const big = `# Offsite\n\n${"x".repeat(960)}\n`;
  const { dir, vault } = openTempVault({ "Inbox.md": "# Inbox\n\n- [ ] Plan the offsite with everyone on the team\n", "Offsite.md": big }, { maxNoteBytes: 1000 });
  const read = (p: string) => fs.readFileSync(path.join(dir, p), "utf8");
  assert.throws(() => vault.moveTask("Inbox", 3, "Plan the offsite with everyone on the team", "Offsite", "t"), /Offsite\.md would be over/);
  assert.equal(read("Inbox.md"), "# Inbox\n\n- [ ] Plan the offsite with everyone on the team\n");
  assert.equal(read("Offsite.md"), big);
});

test("ticking a repeating task in its note adds the next one below, from any surface that ticks", () => {
  const { dir, vault } = openTempVault({ "Bills.md": "# Bills\n\n- [ ] Pay rent due:2026-10-06 rec:6th\n" });
  const r = vault.updateTask("Bills", 3, "Pay rent due:2026-10-06 rec:6th", { checked: true }, "t", "2026-10-04");
  assert.deepEqual([r.line, r.text], [3, "Pay rent due:2026-10-06 rec:6th done:2026-10-04"]);
  assert.equal(fs.readFileSync(path.join(dir, "Bills.md"), "utf8"), "# Bills\n\n- [x] Pay rent due:2026-10-06 rec:6th done:2026-10-04\n- [ ] Pay rent due:2026-11-06 rec:6th\n");
  vault.setTask("Bills", 3, r.text, false, "t");
  assert.equal(fs.readFileSync(path.join(dir, "Bills.md"), "utf8"), "# Bills\n\n- [ ] Pay rent due:2026-10-06 rec:6th\n");
  assert.throws(() => vault.updateTask("Bills", 3, "Pay rent due:2026-10-06 rec:6th", { rec: "after-1st-tue" }, "t"), /not a calendar rule/);
  const skipped = vault.skipTask("Bills", 3, "Pay rent due:2026-10-06 rec:6th", "t", "2026-10-04");
  assert.equal(skipped.text, "Pay rent due:2026-11-06 rec:6th");
  vault.updateTask("Bills", 3, skipped.text, { rec: null }, "t"); // "Stop repeating"
  assert.throws(() => vault.skipTask("Bills", 3, "Pay rent due:2026-11-06", "t"), /nothing to skip/);
});

test("updateTask rewrites a task's tokens in its note, and refuses values that can't be written back", () => {
  const { dir, vault } = openTempVault({ "Plan.md": "# Plan\n\n- [ ] Send invoice due:2026-09-30 @jane\n" });
  const r = vault.updateTask("Plan", 3, "Send invoice due:2026-09-30 @jane", { due: "2026-10-07", assignees: [], priority: "low", tags: ["Work/Billing"] }, "t");
  assert.equal(r.change?.summary, "+1 −1");
  assert.equal(fs.readFileSync(path.join(dir, "Plan.md"), "utf8"), "# Plan\n\n- [ ] Send invoice !low due:2026-10-07 #Work/Billing\n");
  assert.deepEqual(vault.tagged("work").map((t) => `${t.kind}:${t.line}`), ["task:3"]);
  const text = vault.tasks()[0].text;
  assert.throws(() => vault.updateTask("Plan", 3, text, { due: "next week" }, "t"), /"due" must be a date/);
  assert.throws(() => vault.updateTask("Plan", 3, text, { assignees: ["two words"] }, "t"), /isn't a person/);
  assert.throws(() => vault.updateTask("Plan", 3, "Gone", { due: null }, "t"), /isn't in Plan\.md any more/);
});

test("smart folders are saved queries, shared with the workspace or one person's own, each with a live count", () => {
  const { vault } = openTempVault(TAGGED);
  const clients = vault.saveSmartFolder("ana", { name: "Client work", query: "tag=work/clients  sort=title", shared: true }, true);
  assert.deepEqual(clients, { id: clients.id, name: "Client work", query: "tag=work/clients sort=title", shared: true, count: 2 });
  vault.saveSmartFolder("bo", { name: "Ideas", query: 'q="idea"', shared: false }, true);
  assert.deepEqual(vault.smartFolders("ana").map((f) => f.name), ["Client work"]);
  assert.deepEqual(vault.smartFolders("bo").map((f) => `${f.name} ${f.count}`), ["Client work 2", "Ideas 1"]);
  vault.create("Projects/Beta", "# Beta\n\n#work/clients/beta\n", "t");
  assert.equal(vault.smartFolders("ana")[0].count, 3);
  assert.equal(vault.findSmartFolder("bo", "ideas").query, 'q=idea');

  // Someone who can't edit shared things (a viewer online) keeps their own, and can't touch the workspace's.
  assert.throws(() => vault.saveSmartFolder("vi", { name: "Mine", query: "", shared: true }, false), /Only editors/);
  assert.throws(() => vault.saveSmartFolder("vi", { id: clients.id, name: "Renamed", query: "", shared: false }, false), /Only editors/);
  assert.throws(() => vault.deleteSmartFolder("vi", clients.id, false), /Only editors/);
  const own = vault.saveSmartFolder("vi", { name: "Mine", query: "folder=Ideas", shared: false }, false);
  assert.equal(own.count, 1);
  assert.throws(() => vault.saveSmartFolder("ana", { id: own.id, name: "Taken", query: "", shared: false }, true), /No smart folder/);
  assert.throws(() => vault.saveSmartFolder("ana", { name: "Bad", query: "colour=red", shared: true }, true), /Unknown query key "colour"/);
  assert.throws(() => vault.saveSmartFolder("ana", { name: " ", query: "", shared: true }, true), /name/);
  assert.deepEqual(vault.deleteSmartFolder("ana", "client work", true), []);
});

test("a smart folder can need several tags, a folder with spaces, and sort by each note's own date", () => {
  const { vault } = openTempVault({});
  vault.create("Health and Fitness/Run log", "---\ndate: 2024-03-01\n---\n# Run log\n\n#health #journal\n", "t");
  vault.create("Health and Fitness/2025-06-10 Swim", "# Swim\n\n#health #journal\n", "t");
  vault.create("Health and Fitness/Gym plan", "---\ncreated: 2023-01-05\n---\n# Gym plan\n\n#health\n", "t");
  vault.create("Journal/2024-12-24", "#journal/daily\n", "t");
  const both = vault.saveSmartFolder("ana", { name: "Health journal", query: "tag=health tag=journal sort=date", shared: true }, true);
  assert.equal(both.query, 'tag="health,journal" sort=date');
  assert.equal(both.count, 2);
  const titles = (query: string) => vault.feed({ ...parseQuery(query), limit: 50 }).items.map((i) => i.title);
  assert.deepEqual(titles(both.query), ["Swim", "Run log"]);
  assert.deepEqual(titles("folder=Health and Fitness sort=oldest"), ["Gym plan", "Run log", "Swim"]);
  // A nested tag counts toward its parent, as it does for one tag.
  assert.deepEqual(titles("tag=journal sort=date"), ["Swim", "2024-12-24", "Run log"]);
  assert.equal(vault.saveSmartFolder("ana", { name: "Health", query: 'folder="Health and Fitness"', shared: true }, true).count, 3);
  assert.deepEqual(titles('folder="Health and Fitness|Journal" sort=title'), ["2024-12-24", "Gym plan", "Run log", "Swim"]);
  assert.deepEqual(vault.list(undefined, "active", "health,journal").map((n) => n.title), ["Swim", "Run log"]);
  assert.deepEqual(titles("tag=health,journal match=any sort=title"), ["2024-12-24", "Gym plan", "Run log", "Swim"]);
});

test("starring and unstarring a tag only touches Favorites, never a smart folder with that tag's query", () => {
  const { vault } = openTempVault(TAGGED);
  const folder = vault.saveSmartFolder("ana", { name: "Workshop", query: "tag=workshop", shared: false }, true);
  vault.starTag("ana", "workshop");
  assert.deepEqual(vault.unstarTag("ana", "workshop"), []);
  assert.deepEqual(vault.smartFolders("ana").map((f) => [f.id, f.query]), [[folder.id, "tag=workshop"]]);
});

test("a smart folder can be a favorite, beside notes and tags, and leaves Favorites when it's deleted or out of sight", () => {
  const { vault } = openTempVault(TAGGED);
  const f = vault.saveSmartFolder("ana", { name: "Clients", query: "tag=work/clients", shared: true }, true);
  const mine = vault.saveSmartFolder("bo", { name: "Mine", query: "folder=Ideas", shared: false }, true);
  vault.starTag("ana", "work");
  const shown = (user: string) => vault.favorites(user).map((x) => ("smartFolder" in x ? `~${x.name} ${x.count}` : "tag" in x ? `#${x.tag}` : x.path));
  assert.deepEqual(vault.starSmartFolder("ana", "clients").flatMap((x) => ("smartFolder" in x ? [x.id] : [])), [f.id]);
  assert.deepEqual(shown("ana"), ["#work", "~Clients 2"]);
  vault.orderFavorites("ana", ["~Clients"]);
  assert.deepEqual(shown("ana"), ["~Clients 2", "#work"]);
  assert.throws(() => vault.starSmartFolder("ana", "Mine"), /No smart folder/); // bo's own
  vault.starSmartFolder("bo", mine.id);
  vault.starSmartFolder("bo", f.id);
  vault.saveSmartFolder("ana", { id: f.id, name: "Clients", query: "tag=work/clients", shared: false }, true); // now ana's alone
  assert.deepEqual(shown("bo"), ["~Mine 1"]);
  assert.deepEqual(vault.unstarSmartFolder("bo", "Mine"), []);
  vault.deleteSmartFolder("ana", f.id, true);
  assert.deepEqual(shown("ana"), ["#work"]);
});

test("a smart folder name means your own before a shared one, a saved query keeps no limit, and there's a cap", () => {
  const { vault } = openTempVault(TAGGED);
  const shared = vault.saveSmartFolder("ana", { name: "Work", query: "tag=work limit=5", shared: true }, true);
  assert.equal(shared.query, "tag=work");
  vault.saveSmartFolder("bo", { name: "work", query: "folder=Ideas", shared: false }, true);
  assert.deepEqual(vault.deleteSmartFolder("bo", "WORK", true).map((f) => f.name), ["Work"]);
  assert.throws(() => vault.saveSmartFolder("bo", { name: "x".repeat(81), query: "", shared: false }, true), /80 characters/);
  for (let i = 0; i < 50; i++) vault.saveSmartFolder("cy", { name: `f${i}`, query: "", shared: false }, true);
  assert.throws(() => vault.saveSmartFolder("cy", { name: "one more", query: "", shared: false }, true), /50 smart folders/);
});

test("an index from before note dates learns each note's date on the next start", () => {
  const { dir, vault } = openTempVault({ "Old.md": "---\ndate: 2020-02-02\n---\n# Old\n", "New.md": "---\ndate: 2025-05-05\n---\n# New\n" });
  vault.db.exec("ALTER TABLE notes DROP COLUMN date");
  assert.deepEqual(openVault(dir).feed({ sort: "oldest" }).items.map((i) => i.title), ["Old", "New"]);
});

test("an index from before tags learns every note's tags on the next start", () => {
  const { dir, vault } = openTempVault(TAGGED);
  vault.db.exec("DROP TABLE tags");
  vault.db.exec("DROP TABLE tag_names");
  assert.deepEqual(openVault(dir).tagged("billing").map((r) => `${r.kind} ${r.path}:${r.line}`), ["task Projects/Acme.md:6"]);
});
