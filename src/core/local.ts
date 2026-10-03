// The local backend: a folder of markdown files, indexed in <vault>/.commonink/index.db with node:sqlite.
import { dataFolder } from "../legacy.ts"; // first: it reads the env vars below under their legacy names too
import { DatabaseSync, type StatementSync } from "node:sqlite";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Vault, type VaultOptions } from "./vault.ts";
import { kindOf, VaultError } from "./paths.ts";
import { migrate, type Content, type FileStat, type SqlDb } from "./store.ts";

export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
/** Installed from npm (one bundled file, see cli/), the CLI has no project folder: its vault is ~/Common Ink. */
const HOME_VAULT = process.env.COMMONINK_BUNDLED === "1" ? path.join(os.homedir(), "Common Ink") : path.join(PROJECT_ROOT, "vault");
export const DEFAULT_VAULT = process.env.COMMONINK_VAULT ? path.resolve(process.env.COMMONINK_VAULT) : HOME_VAULT;

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

/** Run a file operation, turning a name the disk won't take into a message rather than an internal error. */
function onDisk<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENAMETOOLONG") throw new VaultError("That name is too long: a file or folder name can be up to 255 bytes");
    throw e;
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
      if (real !== this.realRoot && !real.startsWith(this.realRoot + path.sep)) throw new VaultError(`${rel} leads outside the vault`);
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
    // Named by the process and a few random bytes, not the note, so a name near the disk's limit still
    // has room for its temp file. The process ID alone isn't enough: two containers sharing a vault
    // can both be PID 1, and one's rename would move the other's bytes into its note.
    const tmp = path.join(path.dirname(abs), `.${process.pid}-${randomUUID().slice(0, 8)}.tmp`);
    onDisk(() => {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(tmp, text);
      fs.renameSync(tmp, abs);
    });
    return this.stat(rel)!;
  }
  remove(rel: string) {
    fs.rmSync(this.abs(rel), { force: true });
    this.pruneTrash(rel);
  }
  rename(from: string, to: string) {
    onDisk(() => {
      fs.mkdirSync(path.dirname(this.abs(to)), { recursive: true });
      fs.renameSync(this.abs(from), this.abs(to));
    });
    this.pruneTrash(from);
  }
  /** Take away the folders a file leaving Trash emptied, up to Trash itself. */
  private pruneTrash(rel: string) {
    for (let dir = path.posix.dirname(rel); dir.startsWith(".trash/"); dir = path.posix.dirname(dir)) {
      try {
        fs.rmdirSync(this.abs(dir)); // only if empty
      } catch {
        return;
      }
    }
  }
  stat(rel: string): FileStat | null {
    try {
      const st = fs.statSync(this.abs(rel));
      return st.isFile() ? { mtime: st.mtimeMs, size: st.size } : null;
    } catch {
      return null;
    }
  }
  same(a: string, b: string) {
    try {
      const [x, y] = [a, b].map((rel) => fs.statSync(this.abs(rel)));
      return x.dev === y.dev && x.ino === y.ino;
    } catch {
      return false;
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
  listUnder(dir: string) {
    const out: Array<{ path: string } & FileStat> = [];
    const walk = (rel: string) => {
      let ents: fs.Dirent[];
      try {
        ents = fs.readdirSync(this.abs(rel), { withFileTypes: true });
      } catch {
        return; // no such folder yet
      }
      for (const ent of ents) {
        const child = `${rel}/${ent.name}`;
        if (ent.isDirectory()) walk(child);
        else if (ent.isFile()) out.push({ path: child, ...this.stat(child)! });
      }
    };
    walk(dir);
    return out;
  }
  /** Take away the folder `dir`, and the folders in it, if no file is left in them (a folder renamed away). */
  prune(dir: string) {
    const walk = (rel: string): boolean => {
      let ents: fs.Dirent[];
      try {
        ents = fs.readdirSync(this.abs(rel), { withFileTypes: true });
      } catch {
        return false;
      }
      const left = ents.filter((ent) => !(ent.isDirectory() && walk(`${rel}/${ent.name}`)));
      if (left.length) return false;
      try {
        fs.rmdirSync(this.abs(rel));
        return true;
      } catch {
        return false;
      }
    };
    walk(dir);
  }
}

/** A local vault belongs to one person: this is who its favorites are for, from the app, CLI or MCP. */
export const LOCAL_USER = "you";

export type LocalVault = Vault & { files: FsContent };

/** Open (and index) a vault folder. */
export function openVault(root = DEFAULT_VAULT, opts: VaultOptions = {}): LocalVault {
  const data = dataFolder(root);
  fs.mkdirSync(data, { recursive: true });
  const sqlite = new DatabaseSync(path.join(data, "index.db"));
  sqlite.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA synchronous=NORMAL;");
  const db = new NodeDb(sqlite);
  migrate(db, { local: true });
  // Its one person keeps their views right in Views/ (see views.ts).
  const q = new Vault(db, new FsContent(root), { soleUser: LOCAL_USER, ...opts }) as LocalVault;
  q.sync();
  q.upgradeSmartFolders();
  return q;
}
