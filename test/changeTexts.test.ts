import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { agentSource } from "../src/core/actor.ts";
import { readBefore } from "../src/core/changeTexts.ts";
import { FsContent, NodeDb, openVault } from "../src/core/local.ts";
import { Vault } from "../src/core/vault.ts";
import { migrate, type SqlDb } from "../src/core/store.ts";
import { openTempVault, random, tempVault } from "./helpers.ts";

type Texts = Map<number, { path: string; before: string; after: string }>;

/**
 * Edit Note.md `n` times at random: people's saves, an agent's appends, a History restore and a
 * rename along the way. Each change's text before and after, by change id.
 */
function edit(vault: Vault, seed: number, n: number): Texts {
  const r = random(seed);
  const texts: Texts = new Map();
  let at = "Note.md";
  for (let i = 0; i < n; i++) {
    if (i === n / 2) at = vault.move(at, "Filed/Note", "ana").path;
    const before = vault.read(at).content;
    const change =
      i % 9 === 4 ? vault.append(at, r.text(20), agentSource("Claude", "ana")).change
      : i % 23 === 11 ? vault.restore([...texts.keys()][r.int(texts.size)], "ana").change
      : vault.save(at, r.edit(before), { source: "ana" }).change;
    if (change) texts.set(change.id, { path: at, before, after: vault.read(at).content });
  }
  return texts;
}

/** Every change reads back the text it started from and the one it left, as History and restore see them. */
function assertTexts(vault: Vault, texts: Texts, label: string) {
  for (const [id, t] of texts) assert.deepEqual(vault.diff(id, id), { path: t.path, op: "edit", before: t.before, after: t.after }, `${label}: change #${id}`);
}

const storedBytes = (db: SqlDb) => db.all<{ before: string }>("SELECT before FROM changes WHERE before IS NOT NULL").reduce((n, r) => n + r.before.length, 0);
const wholeBytes = (texts: Texts) => [...texts.values()].reduce((n, t) => n + t.before.length, 0);

test("any version of a note comes back exactly from whole texts plus deltas", () => {
  for (const seed of [1, 2, 3]) {
    const r = random(seed);
    const { dir, vault } = openTempVault({ "Note.md": r.text(3000) });
    const texts = edit(vault, seed, 120);
    assertTexts(vault, texts, `seed ${seed}`);
    assertTexts(openVault(dir), texts, `seed ${seed}, reopened`);
    assert.ok(storedBytes(vault.db) < wholeBytes(texts) / 4, `seed ${seed}: ${storedBytes(vault.db)} of ${wholeBytes(texts)} bytes`);
  }
});

test("emptying Trash forgets that note's texts, and other notes' history still reads back", () => {
  const r = random(9);
  const { vault } = openTempVault({ "Note.md": r.text(3000), "Gone.md": r.text(3000) });
  const texts = edit(vault, 9, 60);
  for (let i = 0; i < 40; i++) vault.save("Gone.md", r.edit(vault.read("Gone.md").content), { source: "ana" });
  vault.delete(["Gone.md"], "ana");
  vault.purge(vault.trash().map((t) => t.id), "ana");
  assert.equal(vault.db.get("SELECT count(*) AS n FROM changes WHERE path = 'Gone.md' AND before IS NOT NULL").n, 0);
  assertTexts(vault, texts, "after the purge");
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
  const { dir, vault } = openTempVault({ "Note.md": r.text(3000) });
  const texts = edit(vault, 4, 100);
  asBeforeDeltas(vault.db);
  assert.equal(storedBytes(vault.db), wholeBytes(texts));

  const upgraded = openVault(dir);
  assertTexts(upgraded, texts, "upgraded");
  assert.ok(storedBytes(upgraded.db) < wholeBytes(texts) / 4, `${storedBytes(upgraded.db)} of ${wholeBytes(texts)} bytes`);
});

test("a vault on disk gives back the space the delta upgrade freed, once, and says how much", (t) => {
  const r = random(7);
  const { dir, vault } = openTempVault({ "Note.md": r.text(3000) });
  edit(vault, 7, 100);
  asBeforeDeltas(vault.db);
  vault.db.exec("VACUUM");
  const said = t.mock.method(console, "error", () => {});
  const pages = (db: SqlDb) => db.get<{ n: number }>("SELECT page_count AS n FROM pragma_page_count()")!.n;
  const was = pages(vault.db);

  const upgraded = openVault(dir);
  assert.ok(pages(upgraded.db) < was / 2, `${pages(upgraded.db)} of ${was} pages`);
  openVault(dir);
  assert.equal(said.mock.callCount(), 1);
  assert.match(said.mock.calls[0].arguments[0], /^Stored History's older versions as edits: the index went from \d+\.\d MB to \d+\.\d MB\.$/);
  assert.deepEqual(upgraded.db.all("SELECT name FROM upgrades ORDER BY name").map((u) => u.name), ["change deltas", "vacuum after deltas", "views as notes"]);
});

test("a vault with nothing to store as deltas isn't vacuumed", (t) => {
  const said = t.mock.method(console, "error", () => {});
  const { dir } = openTempVault();
  openVault(dir);
  assert.equal(said.mock.callCount(), 0);
});

test("a delta upgrade that fails partway keeps the notes it finished, and the next start does the rest", () => {
  const r = random(5);
  const { dir, vault } = openTempVault({ "A.md": r.text(3000), "B.md": r.text(3000) });
  for (let i = 0; i < 30; i++) for (const p of ["A.md", "B.md"]) vault.save(p, r.edit(vault.read(p).content), { source: "ana" });
  const texts = new Map(vault.changes({ limit: 500 }).map((c) => [c.id, vault.diff(c.id, c.id)]));
  asBeforeDeltas(vault.db);
  const [first, second] = vault.db.all<{ note_id: string }>("SELECT DISTINCT note_id FROM changes ORDER BY note_id");
  vault.db.exec(`CREATE TRIGGER interrupt BEFORE UPDATE ON changes WHEN NEW.note_id = '${second.note_id}' BEGIN SELECT RAISE(ABORT, 'interrupted'); END`);
  assert.throws(() => openVault(dir), /interrupted/);
  const deltas = (noteId: string) => vault.db.get("SELECT count(*) AS n FROM changes WHERE note_id = ? AND base_id IS NOT NULL", noteId).n;
  assert.deepEqual([deltas(first.note_id) > 0, deltas(second.note_id)], [true, 0]);
  vault.db.exec("DROP TRIGGER interrupt");

  const upgraded = openVault(dir);
  assert.ok(deltas(second.note_id) > 0);
  for (const [id, d] of texts) assert.deepEqual(upgraded.diff(id, id), d, `change #${id}`);
});

test("an index from before change texts opens, and new changes keep theirs", () => {
  const { dir, vault } = openTempVault({ "Note.md": "# Note\n" });
  const old = vault.save("Note.md", "# Note\n\nold\n", { source: "ana" }).change!.id;
  vault.db.exec("DROP INDEX changes_base");
  vault.db.exec("ALTER TABLE changes DROP COLUMN base_id");
  vault.db.exec("ALTER TABLE changes DROP COLUMN before");
  vault.db.exec("DROP TABLE upgrades");

  const reopened = openVault(dir);
  const next = reopened.save("Note.md", "# Note\n\nold\nnew\n", { source: "ana" }).change!.id;
  assert.deepEqual([reopened.diff(old, old).before, reopened.diff(next, next).before], [null, "# Note\n\nold\n"]);
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
  get<T = any>(sql: string, ...params: unknown[]): T | undefined {
    return super.get<T>(this.checked(sql), ...params);
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

test("a workspace's change log online is upgraded the same way, without a VACUUM", () => {
  const r = random(6);
  const dir = tempVault({ "Note.md": r.text(3000) });
  const open = () => {
    const db = new DurableObjectLikeDb(new DatabaseSync(path.join(dir, "do.sqlite")));
    migrate(db);
    const vault = new Vault(db, new FsContent(dir));
    vault.sync();
    return vault;
  };
  const vault = open();
  const texts = edit(vault, 6, 80);
  asBeforeDeltas(vault.db);

  const upgraded = open();
  assertTexts(upgraded, texts, "online");
  assert.ok(storedBytes(upgraded.db) < wholeBytes(texts) / 4);
  assert.deepEqual(upgraded.db.all("SELECT name FROM upgrades").map((u) => u.name), ["change deltas"]);
});
