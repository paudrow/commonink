import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { agentSource } from "../src/core/actor.ts";
import { readBefore } from "../src/core/changeTexts.ts";
import { FsContent, NodeDb, openVault } from "../src/core/local.ts";
import { Quire } from "../src/core/quire.ts";
import { migrate, type SqlDb } from "../src/core/store.ts";
import { openTempVault, random, tempVault } from "./helpers.ts";

type Texts = Map<number, { path: string; before: string; after: string }>;

/**
 * Edit Note.md `n` times at random: people's saves, an agent's appends, a History restore and a
 * rename along the way. Each change's text before and after, by change id.
 */
function edit(quire: Quire, seed: number, n: number): Texts {
  const r = random(seed);
  const texts: Texts = new Map();
  let at = "Note.md";
  for (let i = 0; i < n; i++) {
    if (i === n / 2) at = quire.move(at, "Filed/Note", "ana").path;
    const before = quire.read(at).content;
    const change =
      i % 9 === 4 ? quire.append(at, r.text(20), agentSource("Claude", "ana")).change
      : i % 23 === 11 ? quire.restore([...texts.keys()][r.int(texts.size)], "ana").change
      : quire.save(at, r.edit(before), { source: "ana" }).change;
    if (change) texts.set(change.id, { path: at, before, after: quire.read(at).content });
  }
  return texts;
}

/** Every change reads back the text it started from and the one it left, as History and restore see them. */
function assertTexts(quire: Quire, texts: Texts, label: string) {
  for (const [id, t] of texts) assert.deepEqual(quire.diff(id, id), { path: t.path, op: "edit", before: t.before, after: t.after }, `${label}: change #${id}`);
}

const storedBytes = (db: SqlDb) => db.get<{ n: number }>("SELECT sum(length(before)) AS n FROM changes")!.n;
const wholeBytes = (texts: Texts) => [...texts.values()].reduce((n, t) => n + t.before.length, 0);

test("any version of a note comes back exactly from whole texts plus deltas", () => {
  for (const seed of [1, 2, 3]) {
    const r = random(seed);
    const { dir, quire } = openTempVault({ "Note.md": r.text(3000) });
    const texts = edit(quire, seed, 120);
    assertTexts(quire, texts, `seed ${seed}`);
    assertTexts(openVault(dir), texts, `seed ${seed}, reopened`);
    assert.ok(storedBytes(quire.db) < wholeBytes(texts) / 4, `seed ${seed}: ${storedBytes(quire.db)} of ${wholeBytes(texts)} bytes`);
  }
});

test("emptying Trash forgets that note's texts, and other notes' history still reads back", () => {
  const r = random(9);
  const { quire } = openTempVault({ "Note.md": r.text(3000), "Gone.md": r.text(3000) });
  const texts = edit(quire, 9, 60);
  for (let i = 0; i < 40; i++) quire.save("Gone.md", r.edit(quire.read("Gone.md").content), { source: "ana" });
  quire.delete(["Gone.md"], "ana");
  quire.purge(quire.trash().map((t) => t.id), "ana");
  assert.equal(quire.db.get("SELECT count(*) AS n FROM changes WHERE path = 'Gone.md' AND before IS NOT NULL").n, 0);
  assertTexts(quire, texts, "after the purge");
});

/** Turn a change log back into the kind from before deltas: every text whole, no base_id column. */
function asBeforeDeltas(db: SqlDb) {
  const whole = db.all<{ id: number }>("SELECT id FROM changes").map((r) => [r.id, readBefore(db, r.id)] as const);
  for (const [id, text] of whole) db.run("UPDATE changes SET before = ?, base_id = NULL WHERE id = ?", text, id);
  db.exec("DROP INDEX changes_base");
  db.exec("ALTER TABLE changes DROP COLUMN base_id");
  db.exec("DROP TABLE upgrades");
}

test("a change log from before deltas is stored as deltas on the next start, and reads back the same", () => {
  const r = random(4);
  const { dir, quire } = openTempVault({ "Note.md": r.text(3000) });
  const texts = edit(quire, 4, 100);
  asBeforeDeltas(quire.db);
  assert.equal(storedBytes(quire.db), wholeBytes(texts));

  const upgraded = openVault(dir);
  assertTexts(upgraded, texts, "upgraded");
  assert.ok(storedBytes(upgraded.db) < wholeBytes(texts) / 4, `${storedBytes(upgraded.db)} of ${wholeBytes(texts)} bytes`);
});

test("a delta upgrade that fails partway keeps the notes it finished, and the next start does the rest", () => {
  const r = random(5);
  const { dir, quire } = openTempVault({ "A.md": r.text(3000), "B.md": r.text(3000) });
  for (let i = 0; i < 30; i++) for (const p of ["A.md", "B.md"]) quire.save(p, r.edit(quire.read(p).content), { source: "ana" });
  const texts = new Map(quire.changes({ limit: 500 }).map((c) => [c.id, quire.diff(c.id, c.id)]));
  asBeforeDeltas(quire.db);
  const [first, second] = quire.db.all<{ note_id: string }>("SELECT DISTINCT note_id FROM changes ORDER BY note_id");
  quire.db.exec(`CREATE TRIGGER interrupt BEFORE UPDATE ON changes WHEN NEW.note_id = '${second.note_id}' BEGIN SELECT RAISE(ABORT, 'interrupted'); END`);
  assert.throws(() => openVault(dir), /interrupted/);
  const deltas = (noteId: string) => quire.db.get("SELECT count(*) AS n FROM changes WHERE note_id = ? AND base_id IS NOT NULL", noteId).n;
  assert.deepEqual([deltas(first.note_id) > 0, deltas(second.note_id)], [true, 0]);
  quire.db.exec("DROP TRIGGER interrupt");

  const upgraded = openVault(dir);
  assert.ok(deltas(second.note_id) > 0);
  for (const [id, d] of texts) assert.deepEqual(upgraded.diff(id, id), d, `change #${id}`);
});

/** A Durable Object's SQLite as the core sees it: nested transactions are savepoints, and pragmas are refused. */
class DurableObjectLikeDb extends NodeDb {
  private depth = 0;
  constructor(private raw: DatabaseSync) {
    super(raw);
  }
  private checked(sql: string) {
    if (/pragma/i.test(sql)) throw new Error("not authorized");
    return sql;
  }
  exec(sql: string) {
    super.exec(this.checked(sql));
  }
  all<T = any>(sql: string, ...params: unknown[]): T[] {
    return super.all<T>(this.checked(sql), ...params);
  }
  tx<T>(fn: () => T): T {
    const name = `sp${this.depth++}`;
    this.raw.exec(`SAVEPOINT ${name}`);
    try {
      const out = fn();
      this.raw.exec(`RELEASE ${name}`);
      return out;
    } catch (e) {
      this.raw.exec(`ROLLBACK TO ${name}`);
      this.raw.exec(`RELEASE ${name}`);
      throw e;
    } finally {
      this.depth--;
    }
  }
}

test("a workspace's change log online is upgraded the same way", () => {
  const r = random(6);
  const dir = tempVault({ "Note.md": r.text(3000) });
  const open = () => {
    const db = new DurableObjectLikeDb(new DatabaseSync(path.join(dir, "do.sqlite")));
    migrate(db);
    const quire = new Quire(db, new FsContent(dir));
    quire.sync();
    return quire;
  };
  const quire = open();
  const texts = edit(quire, 6, 80);
  asBeforeDeltas(quire.db);

  const upgraded = open();
  assertTexts(upgraded, texts, "online");
  assert.ok(storedBytes(upgraded.db) < wholeBytes(texts) / 4);
});
