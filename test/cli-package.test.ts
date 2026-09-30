// The npm package's CLI (cli/): one bundled file that runs on Node alone, from anywhere.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { build } from "vite";
import { tempVault } from "./helpers.ts";

test("the bundled CLI runs outside the project with no node_modules, and says its version", async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "quire-bundle-"));
  await build({ configFile: path.resolve(import.meta.dirname, "../cli/vite.config.ts"), logLevel: "silent", build: { outDir: out } });
  const bin = path.join(out, "quire.mjs");
  assert.match(fs.readFileSync(bin, "utf8").split("\n")[0], /^#!\/usr\/bin\/env -S node /);
  const vault = tempVault();
  const run = (args: string[]) => spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", bin, ...args], { cwd: out, env: { ...process.env, QUIRE_VAULT: vault }, encoding: "utf8" });
  const pkg = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "../cli/package.json"), "utf8"));
  assert.equal(run(["version"]).stdout, `${pkg.version}\n`);
  assert.equal(run(["tasks"]).stdout, "- [ ] Ship the importer — Projects/Roadmap.md:8\n");
  assert.equal(run(["read", "Nowhere"]).status, 3);
});
