// Exporting notes as a .zip (src/core/export.ts): folders kept, files included, links that work.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { exportZip, relink } from "../src/core/export.ts";
import { openTempVault } from "./helpers.ts";

const VAULT: Record<string, string> = {
  "Projects/Launch.md": "# Launch\n\nSee [[Plan]], [[Plan|the plan]] and [[Budget#Q3]]. Also [the budget](../Finance/Budget.md) and [[Nowhere]].\n\n![[logo.svg]]\n\n![[Budget]]\n\n`[[Budget]]` stays as code.\n",
  "Projects/Plan.md": "# Plan\n\nBack to [[Launch]]. ![chart](../assets/chart.svg)\n",
  "Finance/Budget.md": "# Budget\n\n## Q3\n\nNumbers.\n",
  "assets/logo.svg": '<svg xmlns="http://www.w3.org/2000/svg"><circle r="4"/></svg>',
  "assets/chart.svg": '<svg xmlns="http://www.w3.org/2000/svg"><rect width="4" height="4"/></svg>',
  "assets/unused.png": "not really a png",
  "Archive/Old.md": "# Old\n",
};

function setup() {
  const { dir, quire } = openTempVault(VAULT);
  const host = { quire, origin: "https://ink.test", name: "My notes", bytes: async (rel: string) => new Uint8Array(fs.readFileSync(path.join(dir, rel))) };
  const id = (rel: string) => quire.meta(rel)!.id;
  return { quire, host, id };
}

const unzip = (zip: Uint8Array) => Object.fromEntries(Object.entries(unzipSync(zip)).map(([k, v]) => [k, strFromU8(v)]));

test("a folder exports with its folder structure, the files its notes use, and links that keep working", async () => {
  const { host, id } = setup();
  const out = await exportZip(host, { folder: "Projects" });
  assert.equal(out.name, "Projects.zip");
  assert.deepEqual(out.files, ["Projects/Launch.md", "Projects/Plan.md", "assets/chart.svg", "assets/logo.svg"]);
  const files = unzip(out.zip);
  assert.equal(files["assets/logo.svg"], VAULT["assets/logo.svg"], "a picture comes byte for byte");
  const budget = `https://ink.test/notes/budget-${id("Finance/Budget.md")}`;
  assert.equal(
    files["Projects/Launch.md"],
    `# Launch\n\nSee [[Plan]], [[Plan|the plan]] and [Budget › Q3](${budget}). Also [the budget](${budget}) and [[Nowhere]].\n\n![[logo.svg]]\n\n↳ [Budget](${budget})\n\n\`[[Budget]]\` stays as code.\n`,
    "links inside the export stay; links out of it go to the web; code and unknown links stay as written",
  );
  assert.equal(files["Projects/Plan.md"], VAULT["Projects/Plan.md"]);
});

test("selected notes, and the whole workspace with its archive, export too", async () => {
  const { host } = setup();
  const two = await exportZip(host, { paths: ["Launch", "Finance/Budget.md"] });
  assert.equal(two.name, "Notes.zip");
  const files = unzip(two.zip);
  assert.ok(files["Projects/Launch.md"].includes("[[Budget#Q3]]") && files["Projects/Launch.md"].includes("![[Budget]]"), "Budget is in this export, so its links stay");
  assert.ok(files["Projects/Launch.md"].includes("[[Plan]]") === false, "Plan isn't, so its link goes to the web");
  const one = await exportZip(host, { paths: ["Plan"] });
  assert.equal(one.name, "Plan.zip");
  assert.deepEqual(one.files, ["Projects/Plan.md", "assets/chart.svg"]);
  const all = await exportZip(host, { all: true });
  assert.equal(all.name, "My notes.zip");
  assert.ok(all.files.includes("Archive/Old.md") && all.files.includes("assets/unused.png"));
});

test("a missing note or folder, or an export too big to build, is a clear error", async () => {
  const { host } = setup();
  await assert.rejects(exportZip(host, { paths: ["Nope"] }), /No note matches "Nope"/);
  await assert.rejects(exportZip(host, { folder: "Nope" }), /No folder "Nope"/);
  const huge = { ...host, bytes: async () => new Uint8Array(60 * 1024 * 1024) };
  await assert.rejects(exportZip(huge, { all: true }), /more than 100 MB/);
});

test("GET /export answers with the .zip as a download, named for what's in it", async () => {
  const { handleApi } = await import("../src/core/api.ts");
  const { quire, host: files } = setup();
  const host = { quire, actor: "you", user: "you", canEditShared: true, info: () => ({ name: "My notes" }), written() {}, moved() {}, removed() {}, tree() {}, fileBytes: files.bytes };
  const get = (q: string) => handleApi(host, new Request(`https://ink.test/api/export?${q}`), "/export");
  const res = (await get("folder=Projects"))!;
  assert.equal(res.headers.get("Content-Type"), "application/zip");
  assert.equal(res.headers.get("Content-Disposition"), `attachment; filename="Projects.zip"; filename*=UTF-8''Projects.zip`);
  assert.deepEqual(Object.keys(unzipSync(new Uint8Array(await res.arrayBuffer()))).sort(), ["Projects/Launch.md", "Projects/Plan.md", "assets/chart.svg", "assets/logo.svg"]);
  assert.equal((await get("path=Plan&path=Launch"))!.headers.get("Content-Disposition")?.startsWith('attachment; filename="Notes.zip"'), true);
  assert.equal((await get("all=1"))!.headers.get("Content-Disposition")?.includes("My%20notes.zip"), true);
  const missing = (await get("path=Nope"))!;
  assert.equal(missing.status, 404);
  assert.match((await missing.json()).error, /No note matches/);
});

test("relinking reads long, hostile lines in linear time", () => {
  const plan = { resolve: () => null, included: () => false, url: () => null, uses: () => {} };
  for (const s of ["[[".repeat(50_000), "![".repeat(50_000), "[a](".repeat(30_000), "[[a|".repeat(30_000)]) {
    const t = performance.now();
    assert.equal(relink(s, "n.md", plan), s);
    assert.ok(performance.now() - t < 1500, `slow on ${s.slice(0, 8)}`);
  }
});
