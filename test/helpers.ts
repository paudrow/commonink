import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openVault } from "../src/core/local.ts";

/** A small vault every test can reason about: two notes that link, an HTML note, and an asset. */
export const FIXTURE: Record<string, string> = {
  "Welcome.md": "# Welcome\n\nStart with [[Roadmap]].\n\n![[chart.svg]]\n",
  "Projects/Roadmap.md": "---\ntags: [plan, q3]\n---\n# Roadmap\n\n## Now\n\n- [ ] Ship the importer\n- [x] Write the parser\n",
  "Dashboards/Stats.html": "<title>Stats</title><h1>Reading stats</h1>",
  "assets/chart.svg": '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
};

const made: string[] = [];
process.on("exit", () => {
  for (const dir of made) fs.rmSync(dir, { recursive: true, force: true });
});

/** A fresh vault folder on disk holding `files`, removed when the test process exits. */
export function tempVault(files: Record<string, string> = FIXTURE): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quire-test-"));
  made.push(dir);
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  return dir;
}

export function openTempVault(files?: Record<string, string>, opts?: Parameters<typeof openVault>[1]) {
  const dir = tempVault(files);
  return { dir, quire: openVault(dir, opts) };
}

/**
 * The CPU time `run` took, in milliseconds. Time bounds in tests use it rather than the clock: on a
 * busy machine other processes stretch the clock time several times over, but not this.
 */
export function cpuMs(run: () => unknown): number {
  const start = process.cpuUsage();
  run();
  const { user, system } = process.cpuUsage(start);
  return (user + system) / 1000;
}
