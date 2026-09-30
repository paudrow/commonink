// Common Ink was called Quire. What people set up under that name keeps working: QUIRE_* env vars,
// a vault's .quire/ folder and ~/.config/quire. Importing this module reads the env vars; the local
// backend (src/core/local.ts) imports it first, so the CLI, the MCP server and the app all do.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

type Say = (line: string) => void;
const stderr: Say = (line) => console.error(line);
const told = new Set<string>();
const once = (say: Say, line: string) => {
  if (told.has(line)) return;
  told.add(line);
  say(line);
};

/** Each QUIRE_X sets COMMONINK_X, unless that's set too; either way, a notice to use the new name. */
export function readLegacyEnv(env: NodeJS.ProcessEnv = process.env, say: Say = stderr): void {
  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith("QUIRE_") || value === undefined) continue;
    const now = `COMMONINK_${name.slice("QUIRE_".length)}`;
    env[now] ??= value;
    once(say, `${name} is now ${now}. ${name} still works, for now.`);
  }
}

/**
 * The folder to use at `to`, moving the legacy one at `from` there if only it exists. With both,
 * the new one is used and the legacy one is left as it was, with a notice. Returns the folder to
 * use: `from` only if it couldn't be moved, so nothing in it is ever lost.
 */
export function moveLegacyFolder(from: string, to: string, say: Say = stderr): string {
  if (!fs.existsSync(from)) return to;
  if (fs.existsSync(to)) {
    once(say, `Both ${from} (from before Common Ink's rename) and ${to} are here: using ${to}, and leaving ${from} as it was.`);
    return to;
  }
  try {
    fs.renameSync(from, to);
    return to;
  } catch (e) {
    once(say, `Couldn't move ${from} to ${to} (${(e as Error).message}): using ${from} for now.`);
    return from;
  }
}

/** A vault's data folder (its index, change log, favorites): `.commonink`, moved from the legacy `.quire`. */
export const dataFolder = (root: string, say?: Say) => moveLegacyFolder(path.join(root, ".quire"), path.join(root, ".commonink"), say);

/** Where the CLI keeps its settings: ~/.config/commonink (or $XDG_CONFIG_HOME/commonink), moved from the legacy …/quire. */
export function configFolder(env: NodeJS.ProcessEnv = process.env, say?: Say): string {
  if (env.COMMONINK_CONFIG_DIR) return env.COMMONINK_CONFIG_DIR;
  const base = env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return moveLegacyFolder(path.join(base, "quire"), path.join(base, "commonink"), say);
}

readLegacyEnv();
