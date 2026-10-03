// A folder picked for `commonink import`, as the .zip the importer takes.
import fs from "node:fs";
import path from "node:path";
import { zipSync } from "fflate";
import { MAX_IMPORT_BYTES } from "../core/import.ts";
import { kindOf, VaultError } from "../core/paths.ts";

/**
 * A folder's files as a .zip, at their paths inside it; hidden files and folders and node_modules
 * aren't read. Files the importer leaves out go in empty, so it still says it left them out. Sizes are
 * added up before anything is read, so a folder past `limit` is refused without loading it.
 */
export function zipFolder(dir: string, limit = MAX_IMPORT_BYTES): Uint8Array {
  const found: Array<{ rel: string; keep: boolean }> = [];
  let total = 0;
  const walk = (rel: string) => {
    for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      if (e.name.startsWith(".") || e.name === "node_modules") continue;
      const sub = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(sub);
      else if (e.isFile()) {
        const keep = kindOf(sub) !== null;
        if (keep) total += fs.statSync(path.join(dir, sub)).size;
        if (total > limit) throw new VaultError(`That's more than ${limit / 1024 / 1024} MB: import a folder at a time`);
        found.push({ rel: sub, keep });
      }
    }
  };
  walk("");
  const files: Record<string, [Uint8Array, { level: 0 }]> = {};
  for (const f of found) files[f.rel] = [f.keep ? new Uint8Array(fs.readFileSync(path.join(dir, f.rel))) : new Uint8Array(), { level: 0 }];
  return zipSync(files);
}
