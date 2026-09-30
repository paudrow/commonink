// npm run bench:changelog: how much the change log grows while someone edits one long note, locally
// (index.db on disk) and the way a workspace Durable Object stores it (see do-shim.ts).
//
//   saves     200 saves in a row through the core, as bugs-report B18 measured it
//   burst     200 autosaves from the editor, 600 ms apart: one sitting
//   sessions  the same 200 autosaves in 50 sittings of 4, half an hour apart
//
// Each prints how much the database file grew, the time one save took on average, and how long
// reading back a change's text takes (Quire.diff, what History, restore and Undo read): the newest
// change, and the slowest of all of them.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { handleApi, type ApiHost } from "../src/core/api.ts";
import { openVault } from "../src/core/local.ts";
import { Quire } from "../src/core/quire.ts";
import { migrate } from "../src/core/store.ts";
import { DoDb, SqlContent } from "../cloud/src/do-store.ts";
import { doStorage } from "./do-shim.ts";

const LONG = "Some line of a long document that keeps going.\n".repeat(2000);
const SCENARIOS: Record<string, Array<{ gapMs: number }>> = {
  saves: [],
  burst: Array.from({ length: 200 }, () => ({ gapMs: 600 })),
  sessions: Array.from({ length: 200 }, (_, i) => ({ gapMs: i % 4 === 0 ? 30 * 60_000 : 600 })),
};

function open(backend: "local" | "do", now: () => number) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "commonink-changelog-"));
  if (backend === "local") {
    fs.writeFileSync(path.join(dir, "Long.md"), LONG);
    const quire = openVault(dir, { now });
    const files = [path.join(dir, ".quire/index.db"), path.join(dir, ".quire/index.db-wal")];
    return { dir, quire, files };
  }
  const file = path.join(dir, "do.sqlite");
  const db = new DoDb(doStorage(file));
  migrate(db);
  const content = new SqlContent(db);
  content.write("Long.md", LONG);
  const quire = new Quire(db, content, { now, maxNoteBytes: 1_900_000 });
  quire.sync();
  return { dir, quire, files: [file, `${file}-wal`] };
}

function ms(run: () => unknown): number {
  const start = performance.now();
  for (let i = 0; i < 5; i++) run();
  return (performance.now() - start) / 5;
}

async function measure(backend: "local" | "do", scenario: string) {
  let clock = Date.UTC(2026, 8, 30, 9);
  const { dir, quire, files } = open(backend, () => clock);
  const size = () => files.reduce((n, f) => n + (fs.existsSync(f) ? fs.statSync(f).size : 0), 0);
  const checkpoint = () => {
    try {
      quire.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    } catch {}
  };
  checkpoint();
  const start = size();
  const host: ApiHost = { quire, actor: "you", user: "you", canEditShared: true, info: () => ({}), written() {}, moved() {}, removed() {}, tree() {} };
  let text = LONG;
  let version = quire.read("Long").version;
  const steps = SCENARIOS[scenario];
  const began = performance.now();
  for (let i = 0; i < 200; i++) {
    text += `typed ${i}\n`;
    if (!steps.length) {
      version = quire.save("Long.md", text, { baseVersion: version, source: "you" }).version;
      continue;
    }
    clock += steps[i].gapMs;
    const req = new Request("http://localhost/api/note", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: "Long.md", content: text, baseVersion: version }) });
    version = ((await (await handleApi(host, req, "/note"))!.json()) as { version: string }).version;
  }
  const saveMs = (performance.now() - began) / 200;
  checkpoint();
  const log = quire.changes({ path: "Long.md", limit: 500 });
  const oldest = log[log.length - 1].id;
  const newest = log[0].id;
  if (quire.diff(oldest, newest).before !== LONG || quire.diff(oldest, newest).after !== text) throw new Error("History lost text");
  const row = {
    backend,
    scenario,
    changes: log.length,
    grewMB: +((size() - start) / 1024 / 1024).toFixed(2),
    saveMs: +saveMs.toFixed(2),
    readNewestMs: +ms(() => quire.diff(newest, newest)).toFixed(2),
    readSlowestMs: +Math.max(...log.map((c) => ms(() => quire.diff(c.id, c.id)))).toFixed(2),
  };
  fs.rmSync(dir, { recursive: true, force: true });
  return row;
}

const rows = [];
for (const backend of ["local", "do"] as const) for (const scenario of Object.keys(SCENARIOS)) rows.push(await measure(backend, scenario));
console.table(rows);
