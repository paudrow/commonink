import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { cleanPath } from "../src/core/paths.ts";
import { openVault } from "../src/core/local.ts";
import { openTempVault } from "./helpers.ts";

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
