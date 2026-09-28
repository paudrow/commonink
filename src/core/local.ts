// The local backend: a folder of markdown files, indexed in <vault>/.quire/index.db with node:sqlite.
import { DatabaseSync, type StatementSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Quire } from "./quire.ts";
import { kindOf } from "./paths.ts";
import { migrate, type Content, type FileStat, type SqlDb } from "./store.ts";

export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const DEFAULT_VAULT = process.env.QUIRE_VAULT ? path.resolve(process.env.QUIRE_VAULT) : path.join(PROJECT_ROOT, "vault");

class NodeDb implements SqlDb {
  private stmts = new Map<string, StatementSync>();
  constructor(private db: DatabaseSync) {}
  private prep(sql: string) {
    let s = this.stmts.get(sql);
    if (!s) this.stmts.set(sql, (s = this.db.prepare(sql)));
    return s;
  }
  exec(sql: string) {
    this.db.exec(sql);
  }
  all<T = any>(sql: string, ...params: any[]): T[] {
    return this.prep(sql).all(...params) as T[];
  }
  get<T = any>(sql: string, ...params: any[]): T | undefined {
    return this.prep(sql).get(...params) as T | undefined;
  }
  run(sql: string, ...params: any[]) {
    return { lastId: Number(this.prep(sql).run(...params).lastInsertRowid) };
  }
  tx<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const out = fn();
      this.db.exec("COMMIT");
      return out;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
}

/** Notes as files in a folder. Writes are atomic (temp file + rename) so watchers never see half a note. */
export class FsContent implements Content {
  constructor(readonly root: string) {}
  abs(rel: string) {
    return path.join(this.root, rel);
  }
  read(rel: string) {
    try {
      return fs.readFileSync(this.abs(rel), "utf8");
    } catch {
      return null;
    }
  }
  write(rel: string, text: string): FileStat {
    const abs = this.abs(rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const tmp = path.join(path.dirname(abs), `.${path.basename(abs)}.${process.pid}.tmp`);
    fs.writeFileSync(tmp, text);
    fs.renameSync(tmp, abs);
    return this.stat(rel)!;
  }
  remove(rel: string) {
    fs.rmSync(this.abs(rel), { force: true });
  }
  rename(from: string, to: string) {
    fs.mkdirSync(path.dirname(this.abs(to)), { recursive: true });
    fs.renameSync(this.abs(from), this.abs(to));
  }
  stat(rel: string): FileStat | null {
    try {
      const st = fs.statSync(this.abs(rel));
      return st.isFile() ? { mtime: st.mtimeMs, size: st.size } : null;
    } catch {
      return null;
    }
  }
  list() {
    const out: Array<{ path: string } & FileStat> = [];
    const walk = (dir: string) => {
      for (const ent of fs.readdirSync(this.abs(dir), { withFileTypes: true })) {
        if (ent.name.startsWith(".") || ent.name === "node_modules") continue;
        const rel = dir ? `${dir}/${ent.name}` : ent.name;
        if (ent.isDirectory()) walk(rel);
        else if (ent.isFile() && kindOf(rel)) out.push({ path: rel, ...this.stat(rel)! });
      }
    };
    walk("");
    return out;
  }
}

export type LocalVault = Quire & { files: FsContent };

/** Open (and index) a vault folder. */
export function openVault(root = DEFAULT_VAULT): LocalVault {
  fs.mkdirSync(path.join(root, ".quire"), { recursive: true });
  const sqlite = new DatabaseSync(path.join(root, ".quire", "index.db"));
  sqlite.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA synchronous=NORMAL;");
  const db = new NodeDb(sqlite);
  migrate(db);
  const q = new Quire(db, new FsContent(root)) as LocalVault;
  q.sync();
  return q;
}
