import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { MAX_UPLOAD } from "../src/core/paths.ts";
import { whoAmI } from "../web/src/api.ts";
import { tempVault } from "./helpers.ts";

const ROOT = path.resolve(import.meta.dirname, "..");
let server: ChildProcess;
let port: number;
let vault: string;

before(async () => {
  vault = tempVault();
  server = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "--import", "tsx", "src/server/main.ts"], {
    cwd: ROOT,
    env: { ...process.env, QUIRE_VAULT: vault, PORT: "0", QUIRE_NO_UI: "1" },
    stdio: ["ignore", "pipe", "inherit"],
  });
  port = await new Promise<number>((resolve, reject) => {
    let out = "";
    server.stdout!.on("data", (d) => {
      out += d;
      const m = out.match(/http:\/\/localhost:(\d+)/);
      if (m) resolve(Number(m[1]));
    });
    server.on("exit", (code) => reject(new Error(`server exited with ${code}`)));
  });
});

after(() => server.kill());

/** A raw request, so tests control Host and Origin (fetch won't let us set Host). */
function request(method: string, url: string, opts: { headers?: Record<string, string>; body?: string | Buffer } = {}) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method, path: url, headers: { Host: `localhost:${port}`, ...opts.headers } }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (d) => (body += d));
      res.on("end", () => resolve({ status: res.statusCode!, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.end(opts.body);
  });
}
const origin = () => ({ Origin: `http://localhost:${port}` });
const jsonWrite = (method: string, url: string, body: unknown) =>
  request(method, url, { headers: { ...origin(), "Content-Type": "application/json" }, body: JSON.stringify(body) });

test("only requests addressed to a loopback name are answered", async () => {
  assert.equal((await request("GET", "/api/notes")).status, 200);
  assert.equal((await request("GET", "/api/notes", { headers: { Host: `evil.example:${port}` } })).status, 403);
});

test("writes need our own Origin and a JSON body", async () => {
  const body = JSON.stringify({ path: "Origin test.md", content: "# Hi\n" });
  const json = { "Content-Type": "application/json" };
  assert.equal((await request("POST", "/api/note", { headers: json, body })).status, 403);
  assert.equal((await request("POST", "/api/note", { headers: { ...json, Origin: "null" }, body })).status, 403);
  assert.equal((await request("POST", "/api/note", { headers: { ...json, Origin: "https://evil.example" }, body })).status, 403);
  assert.equal((await request("POST", "/api/note", { headers: { ...origin(), "Content-Type": "text/plain" }, body })).status, 415);
  assert.equal((await jsonWrite("POST", "/api/note", { path: "Origin test.md", content: "# Hi\n" })).status, 200);
  assert.equal(fs.readFileSync(path.join(vault, "Origin test.md"), "utf8"), "# Hi\n");
});

test("the web app's online-or-local probe, /api/me, gets a 200 saying it's local instead of a 404", async () => {
  const me = await request("GET", "/api/me");
  assert.equal(me.status, 200);
  assert.deepEqual(JSON.parse(me.body), { local: true });
  const realFetch = globalThis.fetch;
  globalThis.fetch = (url) => realFetch(`http://localhost:${port}${url}`);
  try {
    assert.equal(await whoAmI(), undefined);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("vault files are served sandboxed, and paths can't climb out", async () => {
  const svg = await request("GET", "/api/files/assets/chart.svg");
  assert.equal(svg.status, 200);
  assert.equal(svg.body, '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  assert.match(String(svg.headers["content-security-policy"]), /^sandbox;/);
  assert.equal((await request("GET", "/api/files/..%2F..%2Fetc%2Fpasswd")).status, 400);
  assert.equal((await request("GET", "/api/files/%E0%A4%A")).status, 400);
  assert.equal((await request("GET", "/api/files/.quire/index.db")).status, 400);
  assert.equal((await request("GET", "/api/files/Welcome.md")).status, 404);
});

test("other sites get nothing from the app's own files, and the app has the same strict CSP as online", async () => {
  assert.equal((await request("GET", "/", { headers: { Origin: "http://localhost:3000" } })).status, 403);
  assert.equal((await request("GET", "/src/main.ts", { headers: { Origin: "http://evil.localhost:8080" } })).status, 403);
  const own = await request("GET", "/", { headers: origin() });
  assert.deepEqual([own.status, own.headers["x-content-type-options"]], [404, "nosniff"]);
  // The same policy as online: our scripts or the page's nonce only, and no framing.
  assert.match(String(own.headers["content-security-policy"]), /^default-src 'self'; script-src 'self' 'nonce-[\w+/=]{24}'; .*; frame-ancestors 'none'$/);
});

test("a WebSocket to anything but /ws is closed, not left hanging", async () => {
  const { default: WebSocket } = await import("ws");
  const socket = new WebSocket(`ws://localhost:${port}/ws?x=1`, { headers: origin() });
  const outcome = await Promise.race([
    new Promise<string>((resolve) => socket.once("error", () => resolve("closed")).once("close", () => resolve("closed"))),
    new Promise<string>((resolve) => setTimeout(() => resolve("hanging"), 2000)),
  ]);
  socket.terminate();
  assert.equal(outcome, "closed");
});

test("HTML notes' sandbox page has its own policy and an opaque origin", async () => {
  const res = await request("GET", "/sandbox");
  assert.equal(res.status, 200);
  assert.equal(res.headers["content-security-policy"], "sandbox allow-scripts; frame-ancestors 'self'");
  assert.match(res.body, /parent\.postMessage\(\{ quireSandbox: "ready" \}, "\*"\)/);
});

test("uploads land in assets/ under a free name; wrong types and oversized files are refused", async () => {
  const up = (name: string, body: string | Buffer) => request("POST", `/api/upload?name=${encodeURIComponent(name)}`, { headers: origin(), body });
  const first = await up("data.csv", "a,b\n1,2\n");
  const { path: rel, size } = JSON.parse(first.body);
  assert.deepEqual({ rel, size }, { rel: "assets/data.csv", size: 8 });
  assert.equal(JSON.parse((await up("data.csv", "c\n")).body).path, "assets/data 2.csv");
  assert.equal(fs.readFileSync(path.join(vault, "assets/data.csv"), "utf8"), "a,b\n1,2\n");
  const md = await up("notes.md", "# no");
  assert.equal(md.status, 400);
  assert.match(JSON.parse(md.body).error, /Can't upload notes\.md/);
  const big = await up("big.png", Buffer.alloc(MAX_UPLOAD + 1));
  assert.equal(big.status, 413);
  assert.equal(fs.existsSync(path.join(vault, "assets/big.png")), false);
});

test("an oversized JSON body is a 413", async () => {
  const r = await jsonWrite("PUT", "/api/note", { path: "Big.md", content: "x".repeat(21 * 1024 * 1024) });
  assert.equal(r.status, 413);
});

test("a file written behind the server's back is logged as an external change", async () => {
  fs.writeFileSync(path.join(vault, "Dropped.md"), "# Dropped in\n");
  let change: { path: string; op: string; source: string } | undefined;
  for (let i = 0; i < 50 && !change; i++) {
    await new Promise((r) => setTimeout(r, 50));
    const changes = JSON.parse((await request("GET", "/api/changes?path=Dropped.md")).body);
    change = changes[0];
  }
  assert.deepEqual(change && { path: change.path, op: change.op, source: change.source }, { path: "Dropped.md", op: "create", source: "external" });
});
