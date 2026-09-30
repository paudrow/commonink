// Watching the vault folder for changes made outside the app (agents, editors, sync tools).
import fs from "node:fs";
import path from "node:path";

/** Folders never watched: hidden ones (the index, Trash, .git) and installed packages. */
const skipped = (name: string) => name.startsWith(".") || name === "node_modules";

/**
 * Call `onChange` with the vault-relative path (POSIX style) of each file or folder that changes
 * under `root`. macOS and Windows watch a whole tree natively. Elsewhere (Linux) Node emulates that
 * with a watch on every file, which fails, and stops the process, on a file it can't read; so there
 * each folder is watched instead: a folder's watch reports its files' changes without opening
 * them, and a folder that can't be watched is left out rather than taking the server down.
 * `native` picks the first way (tests try both).
 */
export function watchTree(root: string, onChange: (rel: string) => void, native = process.platform === "darwin" || process.platform === "win32"): { close(): void } {
  const report = (e: unknown) => console.error(`Not watching part of the vault:`, (e as Error).message);
  if (native) {
    const w = fs.watch(root, { recursive: true }, (_event, filename) => filename && onChange(filename.split(path.sep).join("/")));
    w.on("error", report);
    return w;
  }
  const watchers = new Map<string, fs.FSWatcher>();
  const unwatch = (dir: string) => {
    for (const [d, w] of watchers) {
      if (d === dir || d.startsWith(`${dir}/`)) {
        w.close();
        watchers.delete(d);
      }
    }
  };
  const watchDir = (dir: string) => {
    if (watchers.has(dir)) return;
    const abs = path.join(root, dir);
    let w: fs.FSWatcher;
    try {
      w = fs.watch(abs, (_event, name) => {
        if (!name) return;
        const rel = dir ? `${dir}/${name}` : name;
        let isDir = false;
        try {
          isDir = fs.statSync(path.join(root, rel)).isDirectory();
        } catch {
          unwatch(rel); // gone: stop watching it, and anything that was under it
        }
        if (isDir && !skipped(name)) watchDir(rel);
        onChange(rel);
      });
    } catch (e) {
      return report(e);
    }
    w.on("error", (e) => {
      report(e);
      unwatch(dir);
    });
    watchers.set(dir, w);
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch (e) {
      report(e);
    }
    for (const ent of entries) if (ent.isDirectory() && !skipped(ent.name)) watchDir(dir ? `${dir}/${ent.name}` : ent.name);
  };
  watchDir("");
  return {
    close() {
      for (const w of watchers.values()) w.close();
      watchers.clear();
    },
  };
}
