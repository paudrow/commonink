// The sample exports in examples/import-samples/ (an Obsidian vault, a Notion export, an Evernote
// .enex, Apple Notes as scripts/export-apple-notes.js saves them, and a folder of plain markdown),
// each zipped into examples/preview/importers/_root/assets/Import samples/, so a Preview lists them
// on its Assets page, to download and import. `npm run import-samples`
// rebuilds them; test/convert.test.ts checks they're up to date and import as they should.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync } from "fflate";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
export const SAMPLES = path.join(ROOT, "examples/import-samples");
export const OUT = path.join(ROOT, "examples/preview/importers/_root/assets/Import samples");

/** Every sample folder as a .zip of what's in it (hidden folders too, as the apps write them), the same bytes every time. */
export function buildSamples(): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  for (const name of fs.readdirSync(SAMPLES).sort()) {
    const dir = path.join(SAMPLES, name);
    if (!fs.statSync(dir).isDirectory()) continue;
    const files: Record<string, [Uint8Array, { mtime: Date }]> = {};
    const walk = (rel: string) => {
      for (const ent of fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const r = rel ? `${rel}/${ent.name}` : ent.name;
        if (ent.isDirectory()) walk(r);
        else files[`${name}/${r}`] = [new Uint8Array(fs.readFileSync(path.join(dir, r))), { mtime: new Date("2026-10-02T12:00:00Z") }];
      }
    };
    walk("");
    out.set(`${name}.zip`, zipSync(files, { level: 9 }));
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  fs.mkdirSync(OUT, { recursive: true });
  for (const [name, bytes] of buildSamples()) fs.writeFileSync(path.join(OUT, name), bytes);
  console.log(`Wrote ${[...buildSamples().keys()].join(", ")} to ${path.relative(ROOT, OUT)}`);
}
