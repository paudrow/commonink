import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { cleanPath } from "../src/core/paths.ts";
import { openVault } from "../src/core/local.ts";
import { openTempVault } from "./helpers.ts";
import type { Favorite, NoteMeta } from "../src/core/quire.ts";

const notesOf = (list: Favorite[]) => list.map((n) => (n as NoteMeta).path);

test("cleanPath keeps paths inside the vault", () => {
  assert.equal(cleanPath("./Projects//Roadmap.md"), "Projects/Roadmap.md");
  assert.equal(cleanPath("Projects\\Roadmap.md"), "Projects/Roadmap.md");
  assert.equal(cleanPath("/etc/passwd"), "etc/passwd");
  assert.equal(cleanPath("a/b/../c.md"), "a/c.md");
  assert.throws(() => cleanPath("../outside.md"), /Invalid path/);
  assert.throws(() => cleanPath("a/../../outside.md"), /Invalid path/);
  assert.throws(() => cleanPath(".quire/index.db"), /Hidden paths/);
  assert.throws(() => cleanPath("Projects/.git/config"), /Hidden paths/);
  assert.throws(() => cleanPath(""), /Invalid path/);
  assert.throws(() => cleanPath("a\0b.md"), /Invalid path/);
  assert.throws(() => cleanPath("a\nb.md"), /Invalid path/);
});

test("search finds notes by body text and reports the matching lines", () => {
  const { quire } = openTempVault();
  const hits = quire.search("importer");
  assert.deepEqual(
    hits.map((h) => ({ path: h.path, title: h.title, lines: h.lines })),
    [{ path: "Projects/Roadmap.md", title: "Roadmap", lines: [{ line: 8, text: "- [ ] Ship the importer" }] }],
  );
  assert.deepEqual(quire.search("reading").map((h) => h.path), ["Dashboards/Stats.html"]);
});

test("resolve accepts paths, extensionless paths and wikilink names", () => {
  const { quire } = openTempVault();
  assert.equal(quire.resolve("Projects/Roadmap.md"), "Projects/Roadmap.md");
  assert.equal(quire.resolve("Projects/Roadmap"), "Projects/Roadmap.md");
  assert.equal(quire.resolve("roadmap"), "Projects/Roadmap.md");
  assert.equal(quire.resolve("[[nothing]]"), null);
  assert.equal(quire.resolve("../../etc/passwd"), null);
});

test("edit replaces one exact string and refuses ambiguous or stale edits", () => {
  const { dir, quire } = openTempVault();
  const before = quire.read("Roadmap");
  const r = quire.edit("Roadmap", { oldString: "Ship the importer", newString: "Ship the exporter" }, "tester");
  assert.equal(fs.readFileSync(path.join(dir, "Projects/Roadmap.md"), "utf8").includes("- [ ] Ship the exporter\n"), true);
  assert.equal(r.change.source, "tester");
  assert.equal(r.change.summary, "+1 −1");
  assert.throws(() => quire.edit("Roadmap", { oldString: "- [", newString: "* [" }, "t"), /occurs 2 times/);
  assert.throws(() => quire.edit("Roadmap", { oldString: "Ship", newString: "x", baseVersion: before.version }, "t"), /Re-read it and retry/);
});

test("moving a note rewrites the links that point at it", () => {
  const { dir, quire } = openTempVault();
  const r = quire.move("Roadmap", "Projects/Plan.md", "tester");
  assert.deepEqual(r.updated, ["Welcome.md"]);
  assert.equal(fs.readFileSync(path.join(dir, "Welcome.md"), "utf8"), "# Welcome\n\nStart with [[Plan]].\n\n![[chart.svg]]\n");
  assert.deepEqual(quire.backlinks("Plan").map((b) => b.path), ["Welcome.md"]);
});

test("a path typed in another case is the note's own path, not a second note", () => {
  const { quire } = openTempVault();
  assert.equal(quire.resolve("projects/roadmap"), "Projects/Roadmap.md");
  assert.equal(quire.read("projects/roadmap.md").path, "Projects/Roadmap.md");
  quire.edit("projects/roadmap", { oldString: "Ship the importer", newString: "Ship it" }, "t");
  assert.deepEqual(quire.list(undefined, "all").map((n) => n.path), ["assets/chart.svg", "Dashboards/Stats.html", "Projects/Roadmap.md", "Welcome.md"]);
  assert.deepEqual(quire.tasks().map((t) => `${t.path}:${t.text}`), ["Projects/Roadmap.md:Ship it", "Projects/Roadmap.md:Write the parser"]);
  assert.deepEqual(quire.changes().map((c) => c.path), ["Projects/Roadmap.md"]);
});

test("creating a second top-level note with the same title leaves the first as it was", () => {
  const { dir, quire } = openTempVault({});
  quire.create("Idea", "# Idea\n\nThe first one.\n", "t");
  assert.throws(() => quire.create("Idea", "# Idea\n\nThe second one.\n", "t"), /Idea\.md already exists; use edit_note instead/);
  assert.equal(fs.readFileSync(path.join(dir, "Idea.md"), "utf8"), "# Idea\n\nThe first one.\n");
  assert.deepEqual(quire.list().map((n) => n.path), ["Idea.md"]);
});

test("a note can't be moved to a different file type", () => {
  const { dir, quire } = openTempVault();
  assert.throws(() => quire.move("Welcome", "Welcome.png", "t"), /can't change .* from \.md to \.png/);
  assert.throws(() => quire.move("Welcome", "Welcome.html", "t"), /can't change/);
  assert.equal(fs.existsSync(path.join(dir, "Welcome.md")), true);
});

test("archive and unarchive round-trip a note and keep it out of listings", () => {
  const { quire } = openTempVault();
  assert.equal(quire.archive("Roadmap", "t").path, "Archive/Projects/Roadmap.md");
  assert.deepEqual(quire.list(undefined, "active").map((n) => n.path), ["assets/chart.svg", "Dashboards/Stats.html", "Welcome.md"]);
  assert.deepEqual(quire.search("importer"), []);
  assert.equal(quire.resolve("Roadmap"), "Archive/Projects/Roadmap.md");
  assert.equal(quire.unarchive("Roadmap", "t").path, "Projects/Roadmap.md");
});

test("restore puts a note back the way it was before a change", () => {
  const { quire } = openTempVault();
  const original = quire.read("Welcome").content;
  const { change } = quire.append("Welcome", "An extra line", "t");
  assert.equal(quire.read("Welcome").content, `${original}\nAn extra line\n`);
  quire.restore(change.id, "t");
  assert.equal(quire.read("Welcome").content, original);
});

test("tasks come from checkbox lines with the heading above them", () => {
  const { quire } = openTempVault();
  assert.deepEqual(
    quire.tasks().map(({ path, line, text, done, heading }) => ({ path, line, text, done, heading })),
    [
      { path: "Projects/Roadmap.md", line: 8, text: "Ship the importer", done: false, heading: "Now" },
      { path: "Projects/Roadmap.md", line: 9, text: "Write the parser", done: true, heading: "Now" },
    ],
  );
  quire.setTask("Roadmap", 8, "Ship the importer", true, "t");
  assert.equal(quire.tasks()[0].done, true);
});

test("tasks and headings in code don't count, whichever fence the code uses", () => {
  const note = "# Code\n\n~~~md\n## Not a heading\n```js\n- [ ] not a task\n~~~\n\n    - [ ] indented code, not a task\n\n## Real\n- [ ] a real task\n";
  const { quire } = openTempVault({ "Code.md": note });
  assert.deepEqual(quire.tasks().map((t) => [t.line, t.text, t.heading]), [[12, "a real task", "Real"]]);
});

test("save writes only notes: never over an asset, never a file type the vault doesn't hold", () => {
  const { dir, quire } = openTempVault();
  const svg = fs.readFileSync(path.join(dir, "assets/chart.svg"), "utf8");
  assert.throws(() => quire.save("assets/chart.svg", "clobbered", { source: "t" }), /isn't a note/);
  assert.equal(fs.readFileSync(path.join(dir, "assets/chart.svg"), "utf8"), svg);
  assert.throws(() => quire.save("run.sh", "echo hi", { source: "t" }), /isn't a note/);
  assert.equal(fs.existsSync(path.join(dir, "run.sh")), false);
  assert.equal(quire.save("New.md", "# New\n", { source: "t" }).change?.op, "create");
});

test("uploadPath picks a free name and refuses file types the vault doesn't store", () => {
  const { quire } = openTempVault();
  assert.equal(quire.uploadPath("chart.svg"), "assets/chart 2.svg");
  assert.equal(quire.uploadPath("C:\\Users\\me\\photo.PNG"), "assets/photo.PNG");
  assert.equal(quire.uploadPath("../../escape.png"), "assets/escape.png");
  assert.throws(() => quire.uploadPath("notes.md"), /Can't upload notes\.md/);
  assert.throws(() => quire.uploadPath(""), /Invalid path|Can't upload/);
  assert.throws(() => quire.uploadPath("x.png", "../.."), /Invalid path/);
});

test("the clock lever decides change timestamps and the attribution window", () => {
  let now = Date.UTC(2026, 0, 1);
  const { quire } = openTempVault(undefined, { now: () => now });
  const { change, version } = quire.append("Welcome", "Hi", "agent-a");
  assert.equal(change.ts, Date.UTC(2026, 0, 1));
  assert.equal(quire.attribution("Welcome.md", version)?.source, "agent-a");
  now += 121_000;
  assert.equal(quire.attribution("Welcome.md", version), null);
  assert.deepEqual(quire.changes({ since: "2025-12-31T23:59:59Z" }).map((c) => c.id), [change.id]);
  assert.deepEqual(quire.changes({ since: "2026-01-01T00:00:00Z" }), []);
});

test("a failed disk write leaves the note, the index and the change log as they were", () => {
  const { quire } = openTempVault();
  const before = quire.read("Welcome");
  const lastChange = quire.changes({ limit: 1 })[0]?.id ?? 0;
  quire.files.write = () => {
    throw Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" });
  };
  assert.throws(() => quire.append("Welcome", "lost", "t"), /ENOSPC/);
  assert.equal(quire.read("Welcome").content, before.content);
  assert.equal(quire.meta("Welcome.md")?.version, before.version);
  assert.deepEqual(quire.changes({ since: lastChange }), []);
});

test("a note renamed on disk keeps its ID within the rename window, and not after", () => {
  let now = Date.UTC(2026, 0, 1);
  const { dir, quire } = openTempVault(undefined, { now: () => now });
  const id = quire.meta("Projects/Roadmap.md")!.id;
  /** Delete `from`, let `gapMs` pass, then write the same text at `to`, syncing after each step as the watcher would. */
  const rename = (from: string, to: string, gapMs: number) => {
    const text = fs.readFileSync(path.join(dir, from), "utf8");
    fs.rmSync(path.join(dir, from));
    quire.sync();
    now += gapMs;
    fs.writeFileSync(path.join(dir, to), text);
    quire.sync();
    return quire.meta(to)!.id;
  };
  assert.equal(rename("Projects/Roadmap.md", "Projects/Plan.md", 30_000), id);
  assert.notEqual(rename("Projects/Plan.md", "Projects/Later.md", 61_000), id);
});

test("a star follows its note through moves, archiving and renames, and is each person's own", () => {
  const { dir, quire } = openTempVault();
  quire.star("ana", "Roadmap");
  quire.star("ana", "Welcome");
  quire.star("ana", "Roadmap"); // again: no change
  quire.star("bo", "Welcome");
  quire.move("Roadmap", "Plans/Roadmap", "t");
  quire.archive("Welcome", "t");
  fs.renameSync(path.join(dir, "Plans/Roadmap.md"), path.join(dir, "Plans/Q3.md"));
  quire.sync();
  assert.deepEqual(notesOf(quire.favorites("ana")), ["Plans/Q3.md", "Archive/Welcome.md"]);
  quire.unarchive("Archive/Welcome.md", "t");
  assert.deepEqual(notesOf(quire.orderFavorites("ana", ["Welcome"])), ["Welcome.md", "Plans/Q3.md"]);
  assert.deepEqual(notesOf(quire.unstar("ana", "Welcome")), ["Plans/Q3.md"]);
  assert.deepEqual(notesOf(quire.favorites("bo")), ["Welcome.md"]);
});

test("a starred note deleted and restored under a new ID keeps its star", () => {
  let now = Date.UTC(2026, 0, 1);
  const { dir, quire } = openTempVault(undefined, { now: () => now });
  quire.star("ana", "Welcome");
  const text = fs.readFileSync(path.join(dir, "Welcome.md"), "utf8");
  fs.rmSync(path.join(dir, "Welcome.md"));
  quire.sync();
  assert.deepEqual(quire.favorites("ana"), []);
  now += 3600_000; // long after the rename window: the note comes back with a new ID
  fs.writeFileSync(path.join(dir, "Welcome.md"), text);
  quire.sync();
  const back = quire.meta("Welcome.md")!;
  assert.deepEqual(quire.favorites("ana").map((n) => (n as NoteMeta).id), [back.id]);
  assert.deepEqual(quire.unstar("ana", back.id), []);
});

test("reordering favorites while a starred note is gone leaves it last when it comes back", () => {
  let now = Date.UTC(2026, 0, 1);
  const { dir, quire } = openTempVault(undefined, { now: () => now });
  quire.star("ana", "Welcome");
  quire.star("ana", "Roadmap");
  quire.star("ana", "Dashboards/Stats.html");
  const text = fs.readFileSync(path.join(dir, "Welcome.md"), "utf8");
  fs.rmSync(path.join(dir, "Welcome.md"));
  quire.sync();
  assert.deepEqual(notesOf(quire.orderFavorites("ana", ["Dashboards/Stats.html", "Roadmap"])), ["Dashboards/Stats.html", "Projects/Roadmap.md"]);
  now += 3600_000;
  fs.writeFileSync(path.join(dir, "Welcome.md"), text);
  quire.sync();
  assert.deepEqual(notesOf(quire.favorites("ana")), ["Dashboards/Stats.html", "Projects/Roadmap.md", "Welcome.md"]);
});

test("a tag can be a favorite: in the same order as notes, following renames, dropping out when unused", () => {
  const { quire } = openTempVault({ "A.md": "# A\n\n#work/clients #home\n", "B.md": "# B\n\n#work/clients/acme\n" });
  const shown = (user = "ana") => quire.favorites(user).map((f) => ("tag" in f ? `#${f.display} ${f.notes}` : f.path));
  quire.star("ana", "A");
  quire.starTag("ana", "#Work/Clients");
  quire.starTag("ana", "work/clients"); // again: no change
  quire.starTag("ana", "home");
  assert.deepEqual(shown(), ["A.md", "#work/clients 2", "#home 1"]);
  assert.deepEqual(quire.orderFavorites("ana", ["#home", "A.md"]).map((f) => ("tag" in f ? f.tag : f.path)), ["home", "A.md", "work/clients"]);
  assert.throws(() => quire.starTag("ana", "nowhere"), /No note has #nowhere/);
  assert.deepEqual(shown("bo"), []);

  quire.renameTag("work", "Job", "t"); // the favorite follows, children and all
  assert.deepEqual(shown(), ["#home 1", "A.md", "#Job/clients 2"]);
  quire.renameTag("home", "Job/clients", "t"); // a merge onto one they have keeps one
  assert.deepEqual(shown(), ["A.md", "#Job/clients 2"]);

  quire.edit("A", { oldString: "#Job/clients #Job/clients", newString: "" }, "t");
  quire.edit("B", { oldString: "#Job/clients/acme", newString: "" }, "t");
  assert.deepEqual(shown(), ["A.md"]); // unused: out of sight, but kept
  quire.append("B", "#job/clients again", "t");
  assert.deepEqual(shown(), ["A.md", "#Job/clients 1"]);
  assert.deepEqual(quire.unstarTag("ana", "job/clients").map((f) => ("tag" in f ? f.tag : f.path)), ["A.md"]);
});

test("favorites from before tag favorites keep their notes, and a tag can be starred after the upgrade", () => {
  const { dir, quire } = openTempVault({ "A.md": "# A\n\n#work\n" });
  quire.star("ana", "A");
  const reopened = openVault(dir);
  assert.deepEqual(reopened.favorites("ana").map((f) => ("tag" in f ? f.tag : f.path)), ["A.md"]);
  reopened.starTag("ana", "work");
  assert.deepEqual(reopened.favorites("ana").map((f) => ("tag" in f ? f.tag : f.path)), ["A.md", "work"]);
});

test("only notes can be starred, not assets", () => {
  const { quire } = openTempVault();
  assert.throws(() => quire.star("ana", "assets/chart.svg"), /assets\/chart\.svg is a binary asset, not a note/);
  assert.deepEqual(quire.favorites("ana"), []);
});

test("a note's history follows it through moves, archiving and renames outside the app", () => {
  const { dir, quire } = openTempVault();
  const mine = [quire.create("Draft", "# Draft\n", "t").change.id];
  mine.push(quire.append("Draft", "first", "t").change.id);
  mine.push(quire.move("Draft", "Projects/Plan", "t").change!.id);
  mine.push(quire.archive("Projects/Plan", "t").change!.id);
  mine.push(quire.unarchive("Archive/Projects/Plan.md", "t").change!.id);
  quire.append("Welcome", "not this one", "t");
  fs.renameSync(path.join(dir, "Projects/Plan.md"), path.join(dir, "Projects/Final.md"));
  quire.sync();
  mine.push(quire.append("Projects/Final", "second", "t").change.id);
  const reborn = quire.create("Draft", "# Draft, again\n", "t").change.id;

  const id = quire.meta("Projects/Final.md")!.id;
  const newestFirst = [...mine].reverse();
  for (const target of ["Projects/Final.md", id, `/notes/draft-${id}`]) {
    assert.deepEqual(quire.changes({ path: target }).map((c) => c.id), newestFirst, target);
  }
  assert.deepEqual(quire.changes({ path: "Draft.md" }).map((c) => c.id), [reborn]);
  assert.deepEqual(quire.changes({ path: id, before: mine[3] }).map((c) => c.id), [mine[2], mine[1], mine[0]]);
  const next = quire.reassignId(id);
  assert.deepEqual(quire.changes({ path: next }).map((c) => c.id), newestFirst);
});

test("an older change log gets note IDs from the moves it recorded", () => {
  const { dir, quire } = openTempVault();
  const a = [quire.create("A", "# A\n", "t").change.id, quire.append("A", "more", "t").change.id, quire.move("A", "B", "t").change!.id];
  const a2 = quire.create("A", "# Another A\n", "t").change.id;
  quire.create("C", "# C\n", "t");
  const toD = quire.move("C", "D", "t").change!.id;
  fs.rmSync(path.join(dir, "D.md"));
  fs.writeFileSync(path.join(dir, "C.md"), "# A new C, made outside the app\n");
  quire.sync();
  quire.db.exec("DROP INDEX changes_note");
  quire.db.exec("ALTER TABLE changes DROP COLUMN note_id");

  const reopened = openVault(dir);
  assert.deepEqual(reopened.changes({ path: "B.md" }).map((c) => c.id), [...a].reverse());
  assert.deepEqual(reopened.changes({ path: "A.md" }).map((c) => c.id), [a2]);
  assert.equal(reopened.changes({ path: "B.md" })[0].note_id, reopened.meta("B.md")!.id);
  assert.deepEqual(reopened.changes({ path: "C.md" }).map((c) => c.id), []);
  assert.deepEqual(reopened.changes({ path: "D.md" }).map((c) => c.id), [toD]);
});

test("a change-log upgrade that fails partway runs again on the next start", () => {
  const { dir, quire } = openTempVault();
  const a = [quire.create("A", "# A\n", "t").change.id, quire.move("A", "B", "t").change!.id];
  quire.db.exec("DROP INDEX changes_note");
  quire.db.exec("ALTER TABLE changes DROP COLUMN note_id");
  quire.db.exec("CREATE TRIGGER interrupt BEFORE UPDATE ON changes BEGIN SELECT RAISE(ABORT, 'interrupted'); END");
  assert.throws(() => openVault(dir), /interrupted/);
  quire.db.exec("DROP TRIGGER interrupt");

  assert.deepEqual(openVault(dir).changes({ path: "B.md" }).map((c) => c.id), [...a].reverse());
});

const TAGGED: Record<string, string> = {
  "Projects/Acme.md": "---\ntags: [Work/Clients/Acme]\n---\n# Acme\n\n- [ ] Send the invoice #billing\n- [x] Kickoff #Work/meetings\n",
  "Ideas/Workshop.md": "# Workshop\n\nA #workshop idea, not #work. `#code` doesn't count.\n",
  "Journal/2026-09-27.md": "# 2026-09-27\n\nFixed #27 and met #work/clients/beta.\n",
  "assets/logo.svg": "<svg/>",
};

test("one index answers everything under a tag across notes, tasks and assets", () => {
  const { quire } = openTempVault(TAGGED);
  quire.setAssetTags("assets/logo.svg", ["work/brand", "Design"]);
  assert.deepEqual(
    quire.tagged("#WORK").map((r) => `${r.kind} ${r.path}:${r.line}`),
    ["note Ideas/Workshop.md:3", "note Journal/2026-09-27.md:3", "note Projects/Acme.md:2", "task Projects/Acme.md:7", "asset assets/logo.svg:0"],
  );
  const counts = Object.fromEntries(quire.tags().map((t) => [t.tag, [t.notes, t.tasks, t.assets]]));
  assert.deepEqual(counts, {
    billing: [1, 1, 0],
    design: [0, 0, 1],
    work: [3, 1, 1],
    "work/brand": [0, 0, 1],
    "work/clients": [2, 0, 0],
    "work/clients/acme": [1, 0, 0],
    "work/clients/beta": [1, 0, 0],
    "work/meetings": [1, 1, 0],
    workshop: [1, 0, 0],
  });
});

test("tag counts leave out only Archive/, and tags outside the Basic Multilingual Plane match their children", () => {
  const { quire } = openTempVault({ "archive/n.md": "# N\n\n#t\n", "Work/m.md": "# M\n\n#t #𝐀lpha/beta\n" });
  assert.deepEqual(quire.tags().map((t) => `${t.tag} ${t.notes}`), ["t 2", "𝐀lpha 1", "𝐀lpha/beta 1"]);
  assert.deepEqual(quire.tagged("𝐀lpha").map((r) => r.path), ["Work/m.md"]);
  assert.deepEqual(quire.search("m", 10, "active", "𝐀lpha").map((h) => h.path), ["Work/m.md"]);
});

test("a tag is shown the way it was first written, whatever case later notes use", () => {
  const { quire } = openTempVault({});
  quire.create("A", "# A\n\n#Work/Acme\n", "t");
  quire.create("B", "# B\n\n#work #WORK/acme #work/new\n", "t");
  assert.deepEqual(quire.tags().map((t) => t.display), ["Work", "Work/Acme", "Work/new"]);
});

test("the index follows edits, and the Notes feed, search, lists and tasks filter by a tag and its children", () => {
  const { quire } = openTempVault(TAGGED);
  const feed = (tag: string) => quire.feed({ tag }).items.map((i) => i.path).sort();
  assert.deepEqual(feed("work/clients"), ["Journal/2026-09-27.md", "Projects/Acme.md"]);
  assert.deepEqual(quire.feed({ tag: "work/clients/acme" }).items.map((i) => [i.path, i.tags.map((t) => t.toLowerCase())]), [
    ["Projects/Acme.md", ["work/clients/acme", "billing", "work/meetings"]],
  ]);
  quire.edit("Ideas/Workshop", { oldString: "not #work", newString: "not work" }, "t");
  assert.deepEqual(feed("work"), ["Journal/2026-09-27.md", "Projects/Acme.md"]);
  assert.deepEqual(quire.search("idea", 10, "active", "workshop").map((h) => h.path), ["Ideas/Workshop.md"]);
  assert.deepEqual(quire.search("idea", 10, "active", "work").map((h) => h.path), []);
  assert.deepEqual(quire.list(undefined, "active", "billing").map((n) => n.path), ["Projects/Acme.md"]);
  assert.deepEqual(quire.tasks({ tag: "work" }).map((t) => t.text), ["Kickoff #Work/meetings"]);
  quire.archive("Projects/Acme", "t");
  assert.equal(quire.tags().some((t) => t.tag === "billing"), false);
});

test("renaming a tag rewrites it in every note and asset, and each note's change can be undone", () => {
  const { quire } = openTempVault(TAGGED);
  quire.setAssetTags("assets/logo.svg", ["work/brand"]);
  const r = quire.renameTag("work/clients", "Customers", "t");
  assert.deepEqual(r.edits.map((e) => e.path).sort(), ["Journal/2026-09-27.md", "Projects/Acme.md"]);
  assert.equal(quire.read("Projects/Acme").content.startsWith("---\ntags: [Customers/Acme]\n---\n"), true);
  assert.equal(quire.read("Journal/2026-09-27").content, "# 2026-09-27\n\nFixed #27 and met #Customers/beta.\n");
  assert.deepEqual(quire.tagged("work/clients"), []);
  assert.equal(quire.tags().find((t) => t.tag === "customers")?.display, "Customers");

  const merged = quire.renameTag("work", "design", "t");
  assert.deepEqual(merged.assets, { "assets/logo.svg": ["work/brand"] });
  assert.deepEqual(quire.assetTags(), { "assets/logo.svg": ["design/brand"] });
  for (const e of [...r.edits].reverse()) quire.restore(e.change.id, "t");
  assert.equal(quire.read("Journal/2026-09-27").content, TAGGED["Journal/2026-09-27.md"]);
  assert.throws(() => quire.renameTag("work", "not a tag", "t"), /isn't a tag/);
});

test("asset tags live in one vault file, follow the asset when it moves, and reload when the file changes", () => {
  const { dir, quire } = openTempVault(TAGGED);
  assert.deepEqual(quire.setAssetTags("logo.svg", ["#Brand", "brand", "Work/Brand"]), ["Brand", "Work/Brand"]);
  assert.throws(() => quire.setAssetTags("logo.svg", ["two words"]), /isn't a tag/);
  quire.move("assets/logo.svg", "assets/brand/logo.svg", "t");
  assert.equal(
    fs.readFileSync(path.join(dir, "assets/.tags.json"), "utf8"),
    '{\n  "assets/brand/logo.svg": [\n    "Brand",\n    "Work/Brand"\n  ]\n}\n',
  );
  fs.writeFileSync(path.join(dir, "assets/.tags.json"), JSON.stringify({ "assets/brand/logo.svg": ["photo"] }));
  quire.sync();
  assert.deepEqual(quire.tagged("photo").map((r) => r.path), ["assets/brand/logo.svg"]);
  assert.deepEqual(quire.setAssetTags("assets/brand/logo.svg", []), []);
  assert.equal(fs.readFileSync(path.join(dir, "assets/.tags.json"), "utf8"), "{}\n");
});

test("tasks carry their tokens, filter by due date and person, and ticking one stamps the day it was done", () => {
  let now = Date.UTC(2026, 9, 1, 12);
  const { dir, quire } = openTempVault(
    {
      "Plan.md": "# Plan\n\n- [ ] Send invoice due:2026-09-30 @jane !high #billing\n- [ ] Draft the deck due:2026-10-03 @sam\n- [ ] Someday\n",
    },
    { now: () => now },
  );
  const [invoice] = quire.tasks();
  assert.deepEqual([invoice.summary, invoice.meta], [
    "Send invoice",
    { due: "2026-09-30", start: null, done: null, rec: null, until: null, times: null, priority: "high", assignees: ["jane"], tags: ["billing"] },
  ]);
  assert.deepEqual(quire.tasks({ due: "<=today" }).map((t) => t.summary), ["Send invoice"]);
  assert.deepEqual(quire.tasks({ due: "<=today", today: "2026-10-03" }).map((t) => t.summary), ["Send invoice", "Draft the deck"]);
  assert.deepEqual(quire.tasks({ assignee: "@Sam" }).map((t) => t.summary), ["Draft the deck"]);
  assert.throws(() => quire.tasks({ due: "soon" }), /due filter/);

  quire.setTask("Plan", 3, invoice.text, true, "t");
  assert.equal(fs.readFileSync(path.join(dir, "Plan.md"), "utf8").split("\n")[2], "- [x] Send invoice due:2026-09-30 @jane !high #billing done:2026-10-01");
  now += 86_400_000;
  quire.setTask("Plan", 3, quire.tasks()[0].text, false, "t");
  assert.equal(fs.readFileSync(path.join(dir, "Plan.md"), "utf8").split("\n")[2], "- [ ] Send invoice due:2026-09-30 @jane !high #billing");
});

test("a quick-added task goes to today's daily note under Tasks, or to the note it names", () => {
  const { dir, quire } = openTempVault({ "Launch.md": "# Launch\n\n## Tasks\n\n- [ ] Book the venue\n\n## Notes\n\nText.\n" });
  const read = (p: string) => fs.readFileSync(path.join(dir, p), "utf8");
  const a = quire.addTask("Call mom tomorrow", "t", { today: "2026-09-28" });
  assert.deepEqual([a.path, a.line, a.text], ["Journal/2026-09-28.md", 5, "Call mom due:2026-09-29"]);
  assert.equal(read("Journal/2026-09-28.md"), "# 2026-09-28\n\n## Tasks\n\n- [ ] Call mom due:2026-09-29\n\n## Log\n");
  quire.addTask("Pay rent every month on the 1st #home", "t", { today: "2026-09-28" });
  assert.equal(read("Journal/2026-09-28.md"), "# 2026-09-28\n\n## Tasks\n\n- [ ] Call mom due:2026-09-29\n- [ ] Pay rent due:2026-10-01 rec:1st #home\n\n## Log\n");
  // A daily note without a Tasks section gets one at its end.
  fs.writeFileSync(path.join(dir, "Journal/2026-09-29.md"), "# 2026-09-29\n\n## Log\n\n- 09:00 hi\n");
  quire.sync();
  quire.addTask("Stretch", "t", { today: "2026-09-29" });
  assert.equal(read("Journal/2026-09-29.md"), "# 2026-09-29\n\n## Log\n\n- 09:00 hi\n\n## Tasks\n\n- [ ] Stretch\n");
  // → [[Note]] targets that note's Tasks section.
  const b = quire.addTask("Print the badges → [[Launch]] next fri", "t", { today: "2026-09-28" });
  assert.deepEqual([b.path, b.line], ["Launch.md", 6]);
  assert.equal(read("Launch.md"), "# Launch\n\n## Tasks\n\n- [ ] Book the venue\n- [ ] Print the badges due:2026-10-02\n\n## Notes\n\nText.\n");
  // A phrase clicked away stays words.
  assert.equal(quire.addTask("Watch Next Week's show", "t", { today: "2026-09-28", ignore: ["next week"] }).text, "Watch Next Week's show");
  assert.throws(() => quire.addTask("tomorrow", "t", { today: "2026-09-28" }), /Say what the task is/);
  assert.throws(() => quire.addTask("x → [[Nowhere]]", "t"), /No note matches "Nowhere"/);
  assert.throws(() => quire.addTask("x", "t", { today: "someday" }), /"today" must be a date/);
});

test("today is overdue, due today and starting today, in sections, with today's journal note", () => {
  const { quire } = openTempVault({
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
  const t = quire.today("2026-09-28");
  const titles = (id: string) => t.sections.find((s) => s.id === id)!.tasks.map((x) => x.summary);
  assert.deepEqual(t.sections.map((s) => [s.id, s.title]), [["overdue", "Overdue"], ["due", "Due today"], ["starting", "Starting today"]]);
  assert.deepEqual(titles("overdue"), ["Late report", "Later report", "Overdue and started"]);
  assert.deepEqual(titles("due"), ["Standup due:2026-09-28 rec:weekdays", "Pay rent"]); // rec:weekdays isn't a rule, so it's words
  assert.deepEqual(titles("starting"), ["Draft the talk"]);
  assert.deepEqual(t.journal, { path: "Journal/2026-09-28.md", exists: false });
  assert.throws(() => quire.today("Monday"), /"today" must be a date/);
});

test("today's journal note is made from Templates/Daily note.md, or a plain one without it", () => {
  const { dir, quire } = openTempVault({ "Welcome.md": "# Welcome\n" });
  const read = (p: string) => fs.readFileSync(path.join(dir, p), "utf8");
  const plain = quire.dailyNote("2026-09-28", "t");
  assert.deepEqual([plain.path, plain.created], ["Journal/2026-09-28.md", true]);
  assert.equal(read("Journal/2026-09-28.md"), "# 2026-09-28\n\n## Tasks\n\n## Log\n");
  assert.equal(quire.dailyNote("2026-09-28", "t").created, false);
  assert.equal(quire.today("2026-09-28").journal.exists, true);
  fs.mkdirSync(path.join(dir, "Templates"));
  fs.writeFileSync(path.join(dir, "Templates/Daily note.md"), "# {{date}}\n\n## Plan\n\n## Tasks\n\n## Notes\n");
  quire.sync();
  quire.dailyNote("2026-09-29", "t");
  assert.equal(read("Journal/2026-09-29.md"), "# 2026-09-29\n\n## Plan\n\n## Tasks\n\n## Notes\n");
  // Quick-add into a day with no note yet uses the same template.
  quire.addTask("Stretch", "t", { today: "2026-09-30" });
  assert.equal(read("Journal/2026-09-30.md"), "# 2026-09-30\n\n## Plan\n\n## Tasks\n\n- [ ] Stretch\n\n## Notes\n");
});

test("quick-add can go to a note it's given, and removing a task takes it (and what's nested) back out", () => {
  const { dir, quire } = openTempVault({ "Launch.md": "# Launch\n\nNotes.\n", "Other.md": "# Other\n" });
  const read = (p: string) => fs.readFileSync(path.join(dir, p), "utf8");
  const r = quire.addTask("Print badges tomorrow", "t", { today: "2026-09-28", to: "Launch" });
  assert.deepEqual([r.path, r.line, r.text], ["Launch.md", 5, "Print badges due:2026-09-29"]);
  assert.equal(read("Launch.md"), "# Launch\n\nNotes.\n\n- [ ] Print badges due:2026-09-29\n");
  // → [[Note]] in the words wins over the note it was given.
  assert.equal(quire.addTask("Tidy → [[Other]]", "t", { today: "2026-09-28", to: "Launch" }).path, "Other.md");
  quire.removeTask("Launch", 5, "Print badges due:2026-09-29", "t");
  assert.equal(read("Launch.md"), "# Launch\n\nNotes.\n");
  assert.throws(() => quire.removeTask("Launch", 5, "Print badges due:2026-09-29", "t"), /isn't in Launch\.md any more/);
  assert.throws(() => quire.addTask("x", "t", { to: "Nowhere" }), /No note matches "Nowhere"/);
});

test("moving a task takes its line and the lines nested under it to another note's Tasks", () => {
  const { dir, quire } = openTempVault({
    "Inbox.md": "# Inbox\n\n- [ ] Plan the offsite @jane\n  - [ ] Pick a venue\n  Notes about it.\n- [ ] Other\n",
    "Offsite.md": "# Offsite\n\n## Tasks\n\n- [ ] Budget\n",
  });
  const read = (p: string) => fs.readFileSync(path.join(dir, p), "utf8");
  const r = quire.moveTask("Inbox", 3, "Plan the offsite @jane", "Offsite", "t");
  assert.deepEqual([r.path, r.line, r.text], ["Offsite.md", 6, "Plan the offsite @jane"]);
  assert.equal(read("Inbox.md"), "# Inbox\n\n- [ ] Other\n");
  assert.equal(read("Offsite.md"), "# Offsite\n\n## Tasks\n\n- [ ] Budget\n- [ ] Plan the offsite @jane\n  - [ ] Pick a venue\n  Notes about it.\n");
  assert.equal(quire.tasks({ note: "Offsite" }).length, 3);
  assert.throws(() => quire.moveTask("Offsite", 6, "Plan the offsite @jane", "Offsite", "t"), /already in Offsite\.md/);
  assert.throws(() => quire.moveTask("Inbox", 3, "stale", "Offsite", "t"), /isn't in Inbox\.md any more/);
});

test("ticking a repeating task in its note adds the next one below, from any surface that ticks", () => {
  const { dir, quire } = openTempVault({ "Bills.md": "# Bills\n\n- [ ] Pay rent due:2026-10-06 rec:6th\n" });
  const r = quire.updateTask("Bills", 3, "Pay rent due:2026-10-06 rec:6th", { checked: true }, "t", "2026-10-04");
  assert.deepEqual([r.line, r.text], [3, "Pay rent due:2026-10-06 rec:6th done:2026-10-04"]);
  assert.equal(fs.readFileSync(path.join(dir, "Bills.md"), "utf8"), "# Bills\n\n- [x] Pay rent due:2026-10-06 rec:6th done:2026-10-04\n- [ ] Pay rent due:2026-11-06 rec:6th\n");
  quire.setTask("Bills", 3, r.text, false, "t");
  assert.equal(fs.readFileSync(path.join(dir, "Bills.md"), "utf8"), "# Bills\n\n- [ ] Pay rent due:2026-10-06 rec:6th\n");
  assert.throws(() => quire.updateTask("Bills", 3, "Pay rent due:2026-10-06 rec:6th", { rec: "after-1st-tue" }, "t"), /not a calendar rule/);
  const skipped = quire.skipTask("Bills", 3, "Pay rent due:2026-10-06 rec:6th", "t", "2026-10-04");
  assert.equal(skipped.text, "Pay rent due:2026-11-06 rec:6th");
  quire.updateTask("Bills", 3, skipped.text, { rec: null }, "t"); // "Stop repeating"
  assert.throws(() => quire.skipTask("Bills", 3, "Pay rent due:2026-11-06", "t"), /nothing to skip/);
});

test("updateTask rewrites a task's tokens in its note, and refuses values that can't be written back", () => {
  const { dir, quire } = openTempVault({ "Plan.md": "# Plan\n\n- [ ] Send invoice due:2026-09-30 @jane\n" });
  const r = quire.updateTask("Plan", 3, "Send invoice due:2026-09-30 @jane", { due: "2026-10-07", assignees: [], priority: "low", tags: ["Work/Billing"] }, "t");
  assert.equal(r.change?.summary, "+1 −1");
  assert.equal(fs.readFileSync(path.join(dir, "Plan.md"), "utf8"), "# Plan\n\n- [ ] Send invoice !low due:2026-10-07 #Work/Billing\n");
  assert.deepEqual(quire.tagged("work").map((t) => `${t.kind}:${t.line}`), ["task:3"]);
  const text = quire.tasks()[0].text;
  assert.throws(() => quire.updateTask("Plan", 3, text, { due: "next week" }, "t"), /"due" must be a date/);
  assert.throws(() => quire.updateTask("Plan", 3, text, { assignees: ["two words"] }, "t"), /isn't a person/);
  assert.throws(() => quire.updateTask("Plan", 3, "Gone", { due: null }, "t"), /isn't in Plan\.md any more/);
});

test("smart folders are saved queries, shared with the workspace or one person's own, each with a live count", () => {
  const { quire } = openTempVault(TAGGED);
  const clients = quire.saveSmartFolder("ana", { name: "Client work", query: "tag=work/clients  sort=title", shared: true }, true);
  assert.deepEqual(clients, { id: clients.id, name: "Client work", query: "tag=work/clients sort=title", shared: true, count: 2 });
  quire.saveSmartFolder("bo", { name: "Ideas", query: 'q="idea"', shared: false }, true);
  assert.deepEqual(quire.smartFolders("ana").map((f) => f.name), ["Client work"]);
  assert.deepEqual(quire.smartFolders("bo").map((f) => `${f.name} ${f.count}`), ["Client work 2", "Ideas 1"]);
  quire.create("Projects/Beta", "# Beta\n\n#work/clients/beta\n", "t");
  assert.equal(quire.smartFolders("ana")[0].count, 3);
  assert.equal(quire.findSmartFolder("bo", "ideas").query, 'q=idea');

  // Someone who can't edit shared things (a viewer online) keeps their own, and can't touch the workspace's.
  assert.throws(() => quire.saveSmartFolder("vi", { name: "Mine", query: "", shared: true }, false), /Only editors/);
  assert.throws(() => quire.saveSmartFolder("vi", { id: clients.id, name: "Renamed", query: "", shared: false }, false), /Only editors/);
  assert.throws(() => quire.deleteSmartFolder("vi", clients.id, false), /Only editors/);
  const own = quire.saveSmartFolder("vi", { name: "Mine", query: "folder=Ideas", shared: false }, false);
  assert.equal(own.count, 1);
  assert.throws(() => quire.saveSmartFolder("ana", { id: own.id, name: "Taken", query: "", shared: false }, true), /No smart folder/);
  assert.throws(() => quire.saveSmartFolder("ana", { name: "Bad", query: "colour=red", shared: true }, true), /Unknown query key "colour"/);
  assert.throws(() => quire.saveSmartFolder("ana", { name: " ", query: "", shared: true }, true), /name/);
  assert.deepEqual(quire.deleteSmartFolder("ana", "client work", true), []);
});

test("starring and unstarring a tag only touches Favorites, never a smart folder with that tag's query", () => {
  const { quire } = openTempVault(TAGGED);
  const folder = quire.saveSmartFolder("ana", { name: "Billing", query: "tag=billing", shared: false }, true);
  quire.starTag("ana", "billing");
  assert.deepEqual(quire.unstarTag("ana", "billing"), []);
  assert.deepEqual(quire.smartFolders("ana").map((f) => [f.id, f.query]), [[folder.id, "tag=billing"]]);
});

test("a smart folder name means your own before a shared one, a saved query keeps no limit, and there's a cap", () => {
  const { quire } = openTempVault(TAGGED);
  const shared = quire.saveSmartFolder("ana", { name: "Work", query: "tag=work limit=5", shared: true }, true);
  assert.equal(shared.query, "tag=work");
  quire.saveSmartFolder("bo", { name: "work", query: "folder=Ideas", shared: false }, true);
  assert.deepEqual(quire.deleteSmartFolder("bo", "WORK", true).map((f) => f.name), ["Work"]);
  assert.throws(() => quire.saveSmartFolder("bo", { name: "x".repeat(81), query: "", shared: false }, true), /80 characters/);
  for (let i = 0; i < 50; i++) quire.saveSmartFolder("cy", { name: `f${i}`, query: "", shared: false }, true);
  assert.throws(() => quire.saveSmartFolder("cy", { name: "one more", query: "", shared: false }, true), /50 smart folders/);
});

test("an index from before tags learns every note's tags on the next start", () => {
  const { dir, quire } = openTempVault(TAGGED);
  quire.db.exec("DROP TABLE tags");
  quire.db.exec("DROP TABLE tag_names");
  assert.deepEqual(openVault(dir).tagged("billing").map((r) => `${r.kind} ${r.path}:${r.line}`), ["task Projects/Acme.md:6"]);
});
