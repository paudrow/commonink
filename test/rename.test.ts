// Common Ink, everywhere. Nothing in the repo says quire, except what keeps the legacy name on
// purpose (scripts/rename-to-common-ink.ts lists it), and the rename script has nothing left to do.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { BINARY, KEEP_FILES, keepsOldName, OLD_NAME, renameCode, renameFile, renamePath, renameText } from "../scripts/rename-to-common-ink.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
const files = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: ROOT, encoding: "utf8" })
  .split("\0")
  .filter((f) => f && fs.existsSync(path.join(ROOT, f)));
const text = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

test("nothing says quire, except what keeps the legacy name on purpose", () => {
  const stray: string[] = [];
  for (const rel of files) {
    if (KEEP_FILES[rel]) continue;
    if (rel.match(OLD_NAME)) stray.push(rel);
    if (BINARY.test(rel)) continue;
    text(rel)
      .split("\n")
      .forEach((line, i) => {
        if (line.match(OLD_NAME) && !keepsOldName(line)) stray.push(`${rel}:${i + 1}: ${line.trim()}`);
      });
  }
  assert.deepEqual(stray, [], "say Common Ink (or commonink), or mark the line as legacy");
});

test("every file kept for the legacy name is there", () => {
  for (const rel of Object.keys(KEEP_FILES)) assert.ok(fs.existsSync(path.join(ROOT, rel)), rel);
});

test("the rename script has nothing left to do", () => {
  const left = files.filter((rel) => !KEEP_FILES[rel] && (renamePath(rel) !== rel || (!BINARY.test(rel) && renameFile(rel, text(rel)) !== text(rel))));
  assert.deepEqual(left, []);
});

test("the rename script tells the vault in code from the product and the CLI in words", () => {
  assert.equal(
    renameCode('import { Quire, QuireError } from "./quire.ts";\n// `quire.save` on a new Quire(db)\nconst quire: Quire = open();\nrun("quire help", this.quire, createRequire);\n', "x.ts"),
    'import { Vault, VaultError } from "./vault.ts";\n// `vault.save` on a new Vault(db)\nconst vault: Vault = open();\nrun("commonink help", this.vault, createRequire);\n',
  );
  assert.equal(renameCode("const s = `quire ${quire.x} QUIRE_VAULT`;\n(window as any).quire = 1;\n", "x.ts"), "const s = `commonink ${vault.x} COMMONINK_VAULT`;\n(window as any).commonink = 1;\n");
  assert.equal(
    renameText("Quire's CLI: `quire help`, $QUIRE_VAULT, <vault>/.quire/, quire.theme, bin/quire, the Quire roadmap, required\n", "doc"),
    "Common Ink's CLI: `commonink help`, $COMMONINK_VAULT, <vault>/.commonink/, commonink.theme, bin/commonink, the Common Ink roadmap, required\n",
  );
  assert.equal(renameText("Common Ink (formerly Quire)\n", "doc"), "Common Ink (formerly Quire)\n");
  // Two bins for one file become one.
  assert.equal(
    renameFile("cli/package.json", '{\n  "bin": {\n    "quire": "dist/quire.mjs",\n    "commonink": "dist/quire.mjs"\n  }\n}\n'),
    '{\n  "bin": {\n    "commonink": "dist/commonink.mjs"\n  }\n}\n',
  );
  // A bash completion function, and a test's function that runs the CLI.
  assert.equal(renameCode("const s = `_quire() {}\\ncomplete -F _quire quire`;\n", "x.ts"), "const s = `_commonink() {}\\ncomplete -F _commonink commonink`;\n");
  assert.equal(renameCode("function quire(vault: string) {}\nquire(vault);\n", "x.test.ts"), "function commonink(vault: string) {}\ncommonink(vault);\n");
});
