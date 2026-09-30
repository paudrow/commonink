// Rename Quire to Common Ink, everywhere: the product's name in text, the CLI (`commonink`), env vars
// (COMMONINK_*), storage keys and folders (`commonink.*`, `.commonink/`), and code (`class Quire` is
// now `Vault`, in src/core/vault.ts). Deterministic and safe to run again: on a newer main, or on a
// branch, it renames whatever still has the old name and leaves the rest.
//
//   node --import tsx scripts/rename-to-common-ink.ts           rename, and `git mv` renamed files
//   node --import tsx scripts/rename-to-common-ink.ts --dry     print each change instead
//
// In TypeScript and JavaScript it reads the syntax tree (with the editor's parser, @lezer/javascript), so an identifier (`quire.save`) and a word in
// a string or comment ("quire help") each get their own rule. Everything else is text.
//
// What keeps the old name on purpose (compatibility with what people already have) is listed in
// KEEP_FILES, KEEP_LINES, and any line that says "legacy" or "formerly". This script leaves those
// alone, and test/rename.test.ts fails on any other mention.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parser } from "@lezer/javascript";

const ROOT = path.resolve(import.meta.dirname, "..");

/** Files that keep the old name throughout, and why. */
export const KEEP_FILES: Readonly<Record<string, string>> = {
  "scripts/rename-to-common-ink.ts": "this script",
  "test/rename.test.ts": "the test that nothing else says quire",
  "bin/quire": "the legacy `quire` command: says it's now `commonink`, and runs it",
  "src/legacy.ts": "reads legacy QUIRE_* env vars and moves legacy folders",
  "test/legacy.test.ts": "tests the legacy env vars, folders and storage keys",
  "examples/preview/rename.md": "the Preview's steps, which try the legacy names",
};

/** Lines that keep the old name wherever they are, and why. */
export const KEEP_LINES: Readonly<Record<string, string>> = {
  '"quire": "bin/quire"': "package.json: the legacy `quire` bin still works",
};

/** A line that mentions the old name on purpose. */
export const keepsOldName = (line: string) => /legacy|formerly/i.test(line) || Object.keys(KEEP_LINES).some((k) => line.includes(k));

/** A mention of the old name: `quire`, `Quire`, `QUIRE_…`, but not `require`, `acquire` or `inquire`. */
export const OLD_NAME = /(?<!re|ac|in)quire/gi;

/**
 * Where `quire` becoming `vault` would clash with a `vault` already there, or `quire` isn't the vault:
 * each file's own renames, applied while it still says quire. A clash shows up as a type error; add it here.
 */
export const CLASHES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  "test/api.test.ts": { vault: "opened" },
  "test/noteRoles.test.ts": { vault: "seededVault" },
  "test/assign.test.ts": { vault: "freshVault" },
  "test/templates.test.ts": { vault: "freshVault" },
};

export const BINARY = /\.(png|ico|jpe?g|gif|webp|woff2?|ttf|otf|pdf|zip|db|sqlite)$/i;

// ---------------------------------------------------------------------------------------------
// The words

/** An identifier in code. `before` is the code before it, for the few that name the product rather than the vault. */
function identifier(name: string, before = ""): string {
  // A global for devtools, and an MCP server's entry in a client's config.
  if (name === "quire" && /(\bwindow as any\)\.|\bwindow\.|mcpServers: \{ )$/.test(before)) return "commonink";
  const exact: Record<string, string> = { quire: "vault", Quire: "Vault", QuireError: "VaultError", QuireOptions: "VaultOptions" };
  if (exact[name]) return exact[name];
  return name
    .replace(/QUIRE/g, "COMMONINK")
    .replace(/^quire(?=[A-Z0-9_$]|$)/, "commonInk")
    .replace(/Quire/g, "CommonInk")
    .replace(/(?<!re|ac|in)quire/g, "commonink");
}

type Ctx = "code-string" | "comment" | "doc";

// A word with the old name in it, where a word starts: after a non-letter, leading underscores (`_quire`), or \n, \t in a string.
const WORD = /(?<=^|[^A-Za-z0-9_]|(?:^|[^A-Za-z0-9])_+|\\[ntr])(QUIRE[A-Z0-9_]*|Quire[A-Za-z0-9_$]*|quire[A-Za-z0-9_$]*(?:-[a-z0-9]+)*)/g;

/** Text: a string or regex in code, a comment, or a document. */
export function renameText(text: string, ctx: Ctx): string {
  return text
    .split(/(?<=\n)/)
    .map((line) => (keepsOldName(line) ? line : line.replace(WORD, (w, _g, at: number) => word(w, line, at, ctx))))
    .join("");
}

function word(w: string, line: string, at: number, ctx: Ctx): string {
  const before = line.slice(0, at);
  const after = line.slice(at + w.length);
  if (/^QUIRE/.test(w)) return w.replace(/^QUIRE/, "COMMONINK");
  if (w === "QuireError" || w === "QuireOptions") return identifier(w);
  if (w.startsWith("Quire") && w !== "Quire") return identifier(w);
  if (w === "Quire") {
    // The class (`new Quire(`, `Quire.prototype`, `Quire#save`, a `Quire`), or the product.
    const cls = /^[(<#]|^\.[a-z]/.test(after) || /\bnew $|\btypeof $|: $/.test(before) || (/`$/.test(before) && /^`/.test(after) && ctx !== "doc");
    return cls ? "Vault" : "Common Ink";
  }
  // Lowercase from here: `quire`, `quire-…`, `quireSomething`.
  if (/^quire[A-Z0-9_$]/.test(w)) return identifier(w);
  if (w.includes("-")) return w === "quire-roadmap" || w.startsWith("quire-roadmap-") ? w.replace("quire-roadmap", "common-ink-roadmap") : w.replace(/^quire/, "commonink");
  // A property (`this.quire`), or the data folder (`.quire/`).
  if (before.endsWith(".")) return /[A-Za-z0-9_$)\]]\.$/.test(before) ? "vault" : "commonink";
  // The core module: quire.ts, src/core/quire.
  if (/^\.ts\b/.test(after) || /core\/$/.test(before)) return "vault";
  // `quire.something`: a storage key in a string or a document, the vault object in a comment.
  if (/^\.[A-Za-z$*{]/.test(after)) return ctx === "comment" && /^\.[a-z]/.test(after) && !/^\.\*/.test(after) ? "vault" : "commonink";
  // The CLI, the package, a folder: commonink.
  return "commonink";
}

// ---------------------------------------------------------------------------------------------
// Files

const ts = parser.configure({ dialect: "ts" });
const js = parser;
/** The syntax tree's names for an identifier. */
const NAMES = new Set(["VariableName", "VariableDefinition", "PropertyName", "PropertyDefinition", "TypeName", "TypeDefinition", "Label", "PrivatePropertyName", "PrivatePropertyDefinition"]);

/** TypeScript or JavaScript: identifiers by `identifier`, strings, regexes and comments by `renameText`. */
export function renameCode(text: string, file: string): string {
  const tree = (/\.m?js$/.test(file) ? js : ts).parse(text);
  const edits: Array<[number, number, string]> = [];
  // A function called quire runs the CLI (the tests have them), so it's commonink.
  const own: Record<string, string> = text.match(OLD_NAME) ? { ...(/\bfunction quire\(/.test(text) ? { quire: "commonink" } : {}), ...CLASHES[file] } : {};
  const edit = (from: number, to: number, ctx: Ctx | "id") => {
    const was = text.slice(from, to);
    if (ctx === "id" && Object.hasOwn(own, was)) return void edits.push([from, to, own[was]]);
    if (!was.match(OLD_NAME)) return;
    // A line that keeps the old name on purpose keeps it in code too.
    const lineStart = text.lastIndexOf("\n", from - 1) + 1;
    const lineEnd = text.indexOf("\n", from);
    if (keepsOldName(text.slice(lineStart, lineEnd < 0 ? undefined : lineEnd))) return;
    const now = ctx === "id" ? identifier(was, text.slice(Math.max(0, from - 20), from)) : renameText(was, ctx);
    if (now !== was) edits.push([from, to, now]);
  };
  tree.iterate({
    enter(n) {
      if (n.name === "LineComment" || n.name === "BlockComment") edit(n.from, n.to, "comment");
      else if (n.name === "String" || n.name === "RegExp") edit(n.from, n.to, "code-string");
      else if (NAMES.has(n.name)) edit(n.from, n.to, "id");
      else if (n.name === "TemplateString") {
        // The template's own text, between its ${…} (whose code is visited as usual).
        let at = n.from;
        for (let c = n.node.firstChild; c; c = c.nextSibling) {
          if (c.name !== "Interpolation") continue;
          edit(at, c.from, "code-string");
          at = c.to;
        }
        edit(at, n.to, "code-string");
      }
    },
  });
  let out = text;
  for (const [from, to, now] of edits.sort((a, b) => b[0] - a[0])) out = out.slice(0, from) + now + out.slice(to);
  return out;
}

/** The new path of a file, if its name changes. */
export function renamePath(rel: string): string {
  return rel
    .split("/")
    .map((seg) => (seg === "quire.ts" ? "vault.ts" : seg.replace(/(?<!re|ac|in)quire/g, "commonink").replace(/Quire/g, "Common Ink")))
    .join("/");
}

export function renameFile(rel: string, text: string): string {
  if (/\.(m?[jt]s)$/.test(rel)) return renameCode(text, rel);
  const now = renameText(text, "doc");
  return /\.json$/.test(rel) && now !== text ? dedupeKeys(now) : now;
}

/**
 * Two names for one thing become the same name (`"quire"` and `"commonink"` bins for one file):
 * keep one of two lines that now set the same key to the same value.
 */
function dedupeKeys(json: string): string {
  const lines = json.split("\n");
  const bare = (l: string) => l.trim().replace(/,$/, "");
  const out: string[] = [];
  for (const line of lines) {
    const prev = out[out.length - 1];
    if (prev !== undefined && /^"[^"]+":/.test(bare(line)) && bare(line) === bare(prev)) out[out.length - 1] = line;
    else out.push(line);
  }
  return out.join("\n");
}

const tracked = () => execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" }).split("\0").filter(Boolean);

function main() {
  const dry = process.argv.includes("--dry");
  // Renamed files first. `bin/quire` becomes `bin/commonink`, unless it's already the legacy one.
  const moves = tracked().flatMap((rel) => {
    const legacyBin = rel === "bin/quire" && /legacy/.test(fs.readFileSync(path.join(ROOT, rel), "utf8"));
    const to = rel === "bin/quire" ? "bin/commonink" : renamePath(rel);
    return to !== rel && !legacyBin && !(KEEP_FILES[rel] && rel !== "bin/quire") && !fs.existsSync(path.join(ROOT, to)) ? [[rel, to]] : [];
  });
  for (const [rel, to] of moves) {
    if (dry) console.log(`mv ${rel} → ${to}`);
    else {
      fs.mkdirSync(path.dirname(path.join(ROOT, to)), { recursive: true });
      execFileSync("git", ["mv", rel, to], { cwd: ROOT });
    }
  }
  const renamedTo = new Map(moves.map(([rel, to]) => [to, rel]));
  let changed = 0;
  for (const rel of dry ? tracked().map((f) => moves.find(([from]) => from === f)?.[1] ?? f) : tracked()) {
    const src = dry ? (renamedTo.get(rel) ?? rel) : rel;
    if (KEEP_FILES[rel] || BINARY.test(rel)) continue;
    const abs = path.join(ROOT, src);
    if (!fs.existsSync(abs)) continue;
    const text = fs.readFileSync(abs, "utf8");
    const now = renameFile(rel, text);
    if (now === text) continue;
    changed++;
    if (!dry) {
      fs.writeFileSync(abs, now);
      continue;
    }
    const a = text.split("\n");
    const b = now.split("\n");
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) console.log(`${rel}:${i + 1}\n  - ${a[i].trim().slice(0, 240)}\n  + ${b[i]?.trim().slice(0, 240)}`);
  }
  console.error(`${dry ? "Would change" : "Changed"} ${changed} files.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) main();
