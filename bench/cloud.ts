// npm run bench:cloud: the hosted app in workerd (the Worker, D1 and a real workspace Durable
// Object, as the cloud tests run it), with a made-up vault stored in the workspace. Times the
// Durable Object waking up (with a full reindex, and with its index warm) and API requests end to
// end: session and membership checks in D1, then the workspace.
//
//   npm run bench:cloud                   1k notes
//   npm run bench:cloud -- --sizes 1000,10000 --json out.json
import fs from "node:fs";
import os from "node:os";
import { startCloud } from "../test/cloud.ts";
import { generateVault, TODAY } from "./vault.ts";

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i < 0 ? undefined : args[i + 1];
};
const SIZES = (opt("sizes") ?? "1000").split(",").map(Number);
const JSON_OUT = opt("json");
const rows: Array<{ size: number; op: string; runs: number; p50: number; p95: number; bytes: number }> = [];

const pct = (samples: number[], p: number) => [...samples].sort((a, b) => a - b)[Math.min(samples.length - 1, Math.ceil((p / 100) * samples.length) - 1)];

function record(size: number, op: string, samples: number[], bytes = 0) {
  const row = { size, op, runs: samples.length, p50: pct(samples, 50), p95: pct(samples, 95), bytes };
  rows.push(row);
  console.log(`${String(size).padStart(6)}  ${op.padEnd(36)} ${String(row.runs).padStart(4)}  ${row.p50.toFixed(2).padStart(9)}  ${row.p95.toFixed(2).padStart(9)}  ${String(bytes).padStart(9)}`);
}

console.log(`${"notes".padStart(6)}  ${"operation".padEnd(36)} ${"runs".padStart(4)}  ${"p50 ms".padStart(9)}  ${"p95 ms".padStart(9)}  ${"bytes".padStart(9)}`);
for (const size of SIZES) {
  const cloud = await startCloud();
  const worker = cloud.server.getWorker();
  const me = await cloud.signIn("bench");
  const { workspaces } = await cloud.call<{ workspaces: Array<{ id: string }> }>(me, "GET", "/api/me");
  const ws = workspaces[0].id;
  const base = `/api/w/${ws}`;

  // Store the vault's notes in the workspace directly: the next wake indexes them, like an upgrade.
  const v = generateVault(size);
  const sql = await worker.getDurableObjectStorage("Workspace", { name: ws });
  const notes = Object.entries(v.files);
  for (let i = 0; i < notes.length; i += 20) {
    const chunk = notes.slice(i, i + 20);
    await sql.exec(
      `INSERT INTO files(path, text, mtime, size) VALUES ${chunk.map(() => "(?,?,?,?)").join(",")}`,
      ...chunk.flatMap(([rel, text]) => [rel, text, Date.now(), new TextEncoder().encode(text).length]),
    );
  }
  const wake = async () => {
    await worker.evictDurableObject("Workspace", { name: ws }).catch(() => {}); // not running: asleep already
    const t = performance.now();
    const res = await cloud.request(me, "GET", `${base}/info`);
    const body = await res.text();
    if (!res.ok) throw new Error(`Waking the workspace: ${res.status} ${body}`);
    return performance.now() - t;
  };
  record(size, "wake + index every note", [await wake()]);
  const warm: number[] = [];
  for (let i = 0; i < 5; i++) warm.push(await wake());
  record(size, "wake, index warm", warm);

  const time = async (op: string, reps: number, send: (i: number) => [string, string, unknown?]) => {
    const samples: number[] = [];
    let bytes = 0;
    for (let i = -1; i < reps; i++) {
      const [method, path, body] = send(i);
      const t = performance.now();
      const res = await cloud.request(me, method, path, body);
      const buf = await res.arrayBuffer();
      if (res.status >= 400) throw new Error(`${method} ${path}: ${res.status} ${new TextDecoder().decode(buf)}`);
      if (i >= 0) samples.push(performance.now() - t);
      bytes = buf.byteLength;
    }
    record(size, op, samples, bytes);
  };
  const hub = v.hubs[0];
  const reps = 20;
  await time("GET /info", reps, () => ["GET", `${base}/info`]);
  await time("GET /notes", reps, () => ["GET", `${base}/notes`]);
  await time("GET /feed", reps, () => ["GET", `${base}/feed`]);
  await time("GET /feed?tag", reps, () => ["GET", `${base}/feed?tag=work`]);
  await time("GET /search", reps, () => ["GET", `${base}/search?q=launch%20plan`]);
  await time("GET /tags", reps, () => ["GET", `${base}/tags`]);
  await time("GET /favorites", reps, () => ["GET", `${base}/favorites`]);
  await time("GET /smart-folders", reps, () => ["GET", `${base}/smart-folders`]);
  await time("GET /tasks", 5, () => ["GET", `${base}/tasks?today=${TODAY}`]);
  await time("GET /tasks?tag", reps, () => ["GET", `${base}/tasks?tag=work&today=${TODAY}`]);
  await time("GET /today", reps, () => ["GET", `${base}/today?today=${TODAY}`]);
  await time("GET /backlinks (hub)", reps, () => ["GET", `${base}/backlinks?path=${encodeURIComponent(hub)}`]);
  await time("PUT /note", reps, (i) => ["PUT", `${base}/note`, { path: "Bench/Scratch.md", content: `# Scratch\n\nEdit ${i}.\n` }]);
  const big = v.files["Logs/Big log 0.md"];
  await time("PUT /note (1 MB)", 5, (i) => ["PUT", `${base}/note`, { path: "Logs/Big log 0.md", content: `${big}\n- [ ] more ${i}` }]);
  cloud.close();
}
if (JSON_OUT) fs.writeFileSync(JSON_OUT, `${JSON.stringify({ machine: `${os.cpus()[0]?.model} x${os.cpus().length}, ${os.platform()} ${os.release()}, node ${process.version}`, today: TODAY, rows }, null, 2)}\n`);
