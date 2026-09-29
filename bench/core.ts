// npm run bench: time the core on made-up vaults of 1k and 10k notes, locally (files on disk) and
// the way a workspace Durable Object runs it (notes in a table; see do-shim.ts).
//
//   npm run bench                              every size and backend
//   npm run bench -- --sizes 1000 --backends do
//   npm run bench -- --ops "tasks|feed"        only the operations whose names match
//   npm run bench -- --explain                 also print each query's plan (on the largest vault)
//   npm run bench -- --json out.json           also write the numbers as JSON
//
// For each operation it prints the median and 95th percentile time, and how many SQL statements and
// file reads one call makes (a count that grows with the vault is an N+1).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openVault } from "../src/core/local.ts";
import { Quire } from "../src/core/quire.ts";
import { migrate, type Content, type SqlDb } from "../src/core/store.ts";
import { DoDb, SqlContent } from "../cloud/src/do-store.ts";
import { doStorage } from "./do-shim.ts";
import { generateVault, TODAY, type GeneratedVault } from "./vault.ts";

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? undefined : args[i + 1];
};
const SIZES = (opt("sizes") ?? "1000,10000").split(",").map(Number);
const BACKENDS = (opt("backends") ?? "local,do").split(",") as Array<"local" | "do">;
const EXPLAIN = args.includes("--explain");
const OPS = new RegExp(opt("ops") ?? "");
const JSON_OUT = opt("json");
const USER = "you";

interface Row {
  size: number;
  backend: string;
  op: string;
  runs: number;
  p50: number;
  p95: number;
  /** SQL statements and file reads in one call. */
  queries: number;
  reads: number;
}
const rows: Row[] = [];

function pct(samples: number[], p: number) {
  const s = [...samples].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
}

/** Counts statements and file reads, and remembers each distinct statement for EXPLAIN. */
class Counter {
  queries = 0;
  reads = 0;
  seen = new Map<string, number>();
  db(inner: SqlDb): SqlDb {
    const hit = (sql: string) => {
      this.queries++;
      this.seen.set(sql, (this.seen.get(sql) ?? 0) + 1);
    };
    return {
      exec: (sql) => (hit(sql), inner.exec(sql)),
      all: (sql, ...p) => (hit(sql), inner.all(sql, ...p)),
      get: (sql, ...p) => (hit(sql), inner.get(sql, ...p)),
      run: (sql, ...p) => (hit(sql), inner.run(sql, ...p)),
      tx: (fn) => inner.tx(fn),
    };
  }
  files(inner: Content): Content {
    return {
      read: (rel) => (this.reads++, inner.read(rel)),
      write: (rel, text) => inner.write(rel, text),
      remove: (rel) => inner.remove(rel),
      rename: (a, b) => inner.rename(a, b),
      stat: (rel) => inner.stat(rel),
      list: () => inner.list(),
    };
  }
}

interface Backend {
  quire: Quire;
  counted: Quire;
  counter: Counter;
  raw: SqlDb;
  /** Open the vault again from what's stored (a server restart, a Durable Object waking up). */
  reopen(): void;
  close(): void;
}

function writeTree(dir: string, v: GeneratedVault) {
  for (const [rel, text] of Object.entries(v.files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  for (const [rel, bytes] of Object.entries(v.assets)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), bytes);
  }
}

function time(fn: () => void): number {
  const t = performance.now();
  fn();
  return performance.now() - t;
}

function record(size: number, backend: string, op: string, samples: number[], count: { queries: number; reads: number }) {
  const row = { size, backend, op, runs: samples.length, p50: pct(samples, 50), p95: pct(samples, 95), ...count };
  rows.push(row);
  console.log(
    `${String(size).padStart(6)}  ${backend.padEnd(5)}  ${op.padEnd(34)} ${String(row.runs).padStart(4)}  ${row.p50.toFixed(2).padStart(10)}  ${row.p95.toFixed(2).padStart(10)}  ${String(row.queries).padStart(7)}  ${String(row.reads).padStart(6)}`,
  );
}

/** Cold index build: an empty index over every file. Returns the samples and an open backend. */
function openLocal(v: GeneratedVault, reps: number): { build: number[]; backend: Backend } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quire-bench-"));
  writeTree(dir, v);
  const build: number[] = [];
  let quire!: ReturnType<typeof openVault>;
  for (let i = 0; i < reps; i++) {
    fs.rmSync(path.join(dir, ".quire"), { recursive: true, force: true });
    build.push(time(() => (quire = openVault(dir))));
  }
  const counter = new Counter();
  const backend: Backend = {
    quire,
    counter,
    raw: quire.db,
    counted: new Quire(counter.db(quire.db), counter.files(quire.files)),
    reopen: () => void openVault(dir),
    close: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
  return { build, backend };
}

function openDo(v: GeneratedVault, reps: number): { build: number[]; backend: Backend } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quire-bench-do-"));
  const file = path.join(dir, "do.sqlite");
  // The notes are already stored; the index is what gets built (as after an upgrade that reindexes).
  {
    const db = new DoDb(doStorage(file));
    const files = new SqlContent(db);
    db.tx(() => {
      for (const [rel, text] of Object.entries(v.files)) files.write(rel, text);
      for (const [rel, bytes] of Object.entries(v.assets)) files.putBlob(rel, `blob/${rel}`, bytes.length, "image/png");
    });
  }
  const wake = () => {
    const db = new DoDb(doStorage(file));
    migrate(db);
    const files = new SqlContent(db);
    const quire = new Quire(db, files);
    quire.sync();
    return { db, files, quire };
  };
  const build: number[] = [];
  let opened!: ReturnType<typeof wake>;
  for (let i = 0; i < reps; i++) {
    const db = new DoDb(doStorage(file));
    for (const t of ["notes", "notes_fts", "links", "tags", "tag_names", "changes", "favorites", "smart_folders"]) db.exec(`DROP TABLE IF EXISTS ${t}`);
    build.push(time(() => (opened = wake())));
  }
  const counter = new Counter();
  const backend: Backend = {
    quire: opened.quire,
    counter,
    raw: opened.db,
    counted: new Quire(counter.db(opened.db), counter.files(opened.files)),
    reopen: () => void wake(),
    close: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
  return { build, backend };
}

/** Run `fn` `reps` times (after one warm-up) for timings, and once more through the counter. */
function measure(size: number, name: string, b: Backend, reps: number, fn: (q: Quire, i: number) => void) {
  if (!OPS.test(name)) return;
  fn(b.quire, -1);
  const samples: number[] = [];
  for (let i = 0; i < reps; i++) samples.push(time(() => fn(b.quire, i)));
  b.counter.queries = b.counter.reads = 0;
  fn(b.counted, reps);
  record(size, backendName, name, samples, { queries: b.counter.queries, reads: b.counter.reads });
}
let backendName = "";

function scenarios(size: number, v: GeneratedVault, b: Backend) {
  const reps = size >= 10_000 ? 20 : 50;
  const hub = v.hubs[0];
  const notes = b.quire.list(undefined, "active").filter((n) => n.kind === "md" && !n.path.startsWith("Logs/"));
  const tag = v.tags[3];
  const root = tag.split("/")[0];

  // Setup, untimed: some history (three changes a note), and stars and smart folders someone might have.
  b.quire.db.tx(() => {
    for (const [i, n] of notes.entries()) {
      for (const source of ["you", "Claude", i % 2 ? "external" : "you"]) b.quire.recordChange({ path: n.path, op: "edit", source, version: n.version, summary: "+1 −0", from_path: null });
    }
  });
  for (const n of notes.slice(0, 20)) b.quire.star(USER, n.path);
  for (const t of b.quire.tags().slice(0, 5)) b.quire.starTag(USER, t.tag);
  const folders = [`tag=${root}`, `tag=${tag}`, "folder=Projects", "folder=Journal sort=title", 'q="launch plan"', "q=budget tag=work", "folder=Ideas", `tag=${v.tags[10]}`];
  for (const [i, q] of folders.entries()) b.quire.saveSmartFolder(USER, { name: `Folder ${i}`, query: q, shared: i % 2 === 0 }, true);

  measure(size, "reopen (warm index)", b, Math.min(reps, 10), () => b.reopen());
  measure(size, "list all", b, reps, (q) => q.list(undefined, "all"));
  measure(size, "read note", b, reps, (q, i) => q.read(notes[Math.abs(i) % notes.length].path));
  measure(size, "search: one word", b, reps, (q) => q.search("budget"));
  measure(size, "search: two words", b, reps, (q) => q.search("launch plan"));
  measure(size, "search: prefix", b, reps, (q) => q.search("onb"));
  measure(size, "feed: first page", b, reps, (q) => q.feed({}));
  measure(size, "feed: page 5", b, reps, (q) => q.feed({ offset: 120, limit: 30 }));
  measure(size, "feed: q", b, reps, (q) => q.feed({ q: "launch plan" }));
  measure(size, "feed: folder", b, reps, (q) => q.feed({ folder: "Projects" }));
  measure(size, "feed: tag", b, reps, (q) => q.feed({ tag: root }));
  measure(size, "feed: sort=title archived", b, reps, (q) => q.feed({ sort: "title", scope: "archived" }));
  measure(size, "tags", b, reps, (q) => q.tags());
  measure(size, "tagged", b, reps, (q) => q.tagged(root));
  measure(size, "tasks: all", b, Math.min(reps, 10), (q) => q.tasks({ today: TODAY }));
  measure(size, "tasks: tag", b, reps, (q) => q.tasks({ tag, today: TODAY }));
  measure(size, "tasks: due<=today", b, Math.min(reps, 10), (q) => q.tasks({ due: "<=today", today: TODAY }));
  measure(size, "today", b, Math.min(reps, 10), (q) => q.today(TODAY));
  measure(size, "smart folders (8)", b, reps, (q) => q.smartFolders(USER));
  measure(size, "favorites (20 notes, 5 tags)", b, reps, (q) => q.favorites(USER));
  measure(size, "backlinks: hub", b, reps, (q) => q.backlinks(hub));
  measure(size, "backlinks: typical", b, reps, (q, i) => q.backlinks(notes[(Math.abs(i) * 7) % notes.length].path));
  measure(size, "save (index one write)", b, reps, (q, i) => {
    const n = notes[(Math.abs(i) * 13 + 5) % notes.length];
    q.save(n.path, `${q.read(n.path).content}\nEdited ${i}.`, { source: "bench" });
  });
  measure(size, "save: 1 MB note", b, Math.min(reps, 10), (q, i) => {
    const big = "Logs/Big log 0.md";
    q.save(big, `${q.read(big).content}\n- [ ] one more ${i}`, { source: "bench" });
  });
  measure(size, "star + unstar", b, reps, (q, i) => {
    const n = notes[(Math.abs(i) * 17 + 40) % notes.length];
    q.star(USER, n.path);
    q.unstar(USER, n.path);
  });
  measure(size, "rename hub (rewrite links)", b, 3, (q) => {
    const moved = q.move(hub, "Renamed/Hub.md", "bench");
    q.move(moved.path, hub, "bench");
  });
}

function explain(raw: SqlDb, counter: Counter) {
  console.log("\nQuery plans (statements the scenarios ran, most frequent first):\n");
  for (const [sql, n] of [...counter.seen].sort((a, b) => b[1] - a[1])) {
    if (!/^\s*(SELECT|UPDATE|DELETE|INSERT)/i.test(sql)) continue;
    let plan: string[];
    try {
      const params = (sql.match(/\?/g) ?? []).map(() => null);
      plan = raw.all<{ detail: string }>(`EXPLAIN QUERY PLAN ${sql}`, ...params).map((r) => r.detail);
    } catch (e) {
      plan = [`(can't explain: ${(e as Error).message})`];
    }
    const scan = plan.some((p) => /^SCAN (?!.*USING)/.test(p) || /USE TEMP B-TREE/.test(p));
    console.log(`${scan ? "!" : " "} x${n}  ${sql.replace(/\s+/g, " ").trim().slice(0, 150)}`);
    for (const p of plan) console.log(`          ${p}`);
  }
}

console.log(`${"notes".padStart(6)}  ${"where".padEnd(5)}  ${"operation".padEnd(34)} ${"runs".padStart(4)}  ${"p50 ms".padStart(10)}  ${"p95 ms".padStart(10)}  ${"queries".padStart(7)}  ${"reads".padStart(6)}`);
for (const size of SIZES) {
  const v = generateVault(size);
  for (const which of BACKENDS) {
    backendName = which;
    const { build, backend } = (which === "local" ? openLocal : openDo)(v, size >= 10_000 ? 3 : 5);
    record(size, which, "cold index build", build, { queries: 0, reads: 0 });
    // One call's statements, counted: exercise the scenarios with the counter to fill `seen`.
    scenarios(size, v, backend);
    if (EXPLAIN && size === Math.max(...SIZES) && which === BACKENDS[0]) explain(backend.raw, backend.counter);
    backend.close();
  }
}
if (JSON_OUT) fs.writeFileSync(JSON_OUT, `${JSON.stringify({ machine: `${os.cpus()[0]?.model} x${os.cpus().length}, ${os.platform()} ${os.release()}, node ${process.version}`, today: TODAY, rows }, null, 2)}\n`);
