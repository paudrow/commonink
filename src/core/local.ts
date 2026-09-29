// The local backend: a folder of markdown files, indexed in <vault>/.quire/index.db with node:sqlite.
import { DatabaseSync, type StatementSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Quire, type QuireOptions } from "./quire.ts";
import { kindOf, QuireError } from "./paths.ts";
import { migrate, type Content, type FileStat, type SqlDb } from "./store.ts";

export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const DEFAULT_VAULT = process.env.QUIRE_VAULT ? path.resolve(process.env.QUIRE_VAULT) : path.join(PROJECT_ROOT, "vault");

export class NodeDb implements SqlDb {
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
  private realRoot: string | null = null;

  /**
   * Where a note lives on disk. A symlink in the vault (a synced or cloned folder can have them)
   * mustn't lead reads or writes outside it, so the path, or its nearest existing folder, has to
   * resolve to somewhere inside.
   */
  abs(rel: string) {
    const p = path.join(this.root, rel);
    this.realRoot ??= fs.realpathSync(this.root);
    for (let probe = p; ; probe = path.dirname(probe)) {
      let real: string;
      try {
        real = fs.realpathSync(probe);
      } catch {
        if (path.dirname(probe) === probe) return p;
        continue; // doesn't exist yet: check the folder it would go in
      }
      if (real !== this.realRoot && !real.startsWith(this.realRoot + path.sep)) throw new QuireError(`${rel} leads outside the vault`);
      return p;
    }
  }
  read(rel: string) {
    try {
      return fs.readFileSync(this.abs(rel), "utf8");
    } catch {
      return null;
    }
  }
  write(rel: string, text: string | Uint8Array): FileStat {
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
      // Symlinks are neither files nor folders to readdir, so the walk never follows one out.
      for (const ent of fs.readdirSync(path.join(this.root, dir), { withFileTypes: true })) {
        if (ent.name.startsWith(".") || ent.name === "node_modules") continue;
        const rel = dir ? `${dir}/${ent.name}` : ent.name;
        if (ent.isDirectory()) walk(rel);
        else if (ent.isFile() && kindOf(rel)) {
          const st = fs.statSync(path.join(this.root, rel));
          out.push({ path: rel, mtime: st.mtimeMs, size: st.size });
        }
      }
    };
    walk("");
    return out;
  }
}

/** A local vault belongs to one person: this is who its favorites are for, from the app, CLI or MCP. */
export const LOCAL_USER = "you";

export type LocalVault = Quire & { files: FsContent };

/** Open (and index) a vault folder. */
export function openVault(root = DEFAULT_VAULT, opts: QuireOptions = {}): LocalVault {
  fs.mkdirSync(path.join(root, ".quire"), { recursive: true });
  const sqlite = new DatabaseSync(path.join(root, ".quire", "index.db"));
  sqlite.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA synchronous=NORMAL;");
  const db = new NodeDb(sqlite);
  migrate(db, { local: true });
  const q = new Quire(db, new FsContent(root), opts) as LocalVault;
  q.sync();
  return q;
}
