// npm run bench:bundle: build the web app and report what a first visit downloads (the page's
// script, the modules it preloads, and its styles) and every chunk loaded later, raw and gzipped.
//
//   npm run bench:bundle -- --dist some/dist   report on a build that's already there
import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const given = args.indexOf("--dist");
const dist = given < 0 ? path.resolve(import.meta.dirname, "../dist") : path.resolve(args[given + 1]);
if (given < 0) execFileSync("npm", ["run", "build:web"], { stdio: "ignore", cwd: path.resolve(import.meta.dirname, "..") });

const html = fs.readFileSync(path.join(dist, "index.html"), "utf8");
const first = [...html.matchAll(/(?:src|href)="\/(assets\/[^"]+\.(?:js|css))"/g)].map((m) => m[1]);
const size = (rel: string) => {
  const bytes = fs.readFileSync(path.join(dist, rel));
  return { raw: bytes.length, gzip: gzipSync(bytes, { level: 9 }).length };
};
const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
const line = (label: string, s: { raw: number; gzip: number }) => console.log(`${label.padEnd(48)} ${kb(s.raw).padStart(10)} ${kb(s.gzip).padStart(10)}`);

console.log(`${"".padEnd(48)} ${"raw".padStart(10)} ${"gzip".padStart(10)}`);
const total = { raw: 0, gzip: 0 };
for (const rel of first) {
  const s = size(rel);
  total.raw += s.raw;
  total.gzip += s.gzip;
  line(`first load: ${rel}`, s);
}
line("first load, total", total);
const later = fs.readdirSync(path.join(dist, "assets")).map((f) => `assets/${f}`).filter((rel) => rel.endsWith(".js") && !first.includes(rel));
const lazy = later.map((rel) => ({ rel, ...size(rel) })).sort((a, b) => b.raw - a.raw);
line(`loaded when needed (${lazy.length} chunks)`, lazy.reduce((t, s) => ({ raw: t.raw + s.raw, gzip: t.gzip + s.gzip }), { raw: 0, gzip: 0 }));
for (const s of lazy.slice(0, Number(process.env.TOP ?? 12))) line(`  ${s.rel}`, s);
