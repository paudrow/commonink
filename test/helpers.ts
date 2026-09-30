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

/** Random texts and edits from a seed, so a failure names a seed that reproduces it. */
export function random(seed: number) {
  let s = seed >>> 0 || 1;
  const next = () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 2 ** 32;
  };
  const int = (n: number) => Math.floor(next() * n);
  // Pieces that trip text handling up: line endings, accents, a character outside the BMP (two
  // UTF-16 units, which an edit can split), and runs that repeat.
  const PIECES = ["a", "b", " ", "\n", "\r\n", "é", "😀", "- [ ] task\n", "same line\n", "#", ""];
  const text = (n: number) => Array.from({ length: n }, () => PIECES[int(PIECES.length)]).join("");
  /** `t` with a few random insertions, deletions and replacements, some of them splitting a surrogate pair. */
  const edit = (t: string) => {
    let out = t;
    for (let k = int(4); k >= 0; k--) {
      const at = int(out.length + 1);
      const cut = int(Math.min(12, out.length - at + 1));
      out = out.slice(0, at) + (int(3) ? text(int(6)) : "") + out.slice(at + cut);
    }
    return out;
  };
  return { int, text, edit };
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

/**
 * Whether `run` takes more than linear time on `make(n)`: said how, or null if it's linear. It times
 * the input at n and at four times n, by CPU time, best of three, alternating the two so a slow
 * patch lands on both. Linear work takes about four times as long at four times the size; work that
 * rescans from every position takes sixteen, so eight times (plus noise) is the bound. Pick n so the
 * smaller run takes a few tens of milliseconds, well above timer noise.
 */
export function superlinear<T>(run: (input: T) => unknown, make: (n: number) => T, n: number): string | null {
  const [small, big] = [make(n), make(4 * n)];
  let [once, fourTimes] = [Infinity, Infinity];
  for (let i = 0; i < 3; i++) {
    once = Math.min(once, cpuMs(() => run(small)));
    fourTimes = Math.min(fourTimes, cpuMs(() => run(big)));
  }
  return fourTimes < 8 * once + 20 ? null : `${Math.round(once)} ms, then ${Math.round(fourTimes)} ms at four times the size`;
}
