import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { assertPublicUrl, isPrivateAddress, MAX_BYTES, MAX_REDIRECTS, unfurl } from "../src/core/unfurl.ts";

/** A small site to preview. It counts the requests each path gets. */
const hits = new Map<string, number>();
let base: string;
const server = http.createServer((req, res) => {
  const p = req.url!;
  hits.set(p, (hits.get(p) ?? 0) + 1);
  const html = (body: string) => (res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }), res.end(body));
  if (p === "/page") return html("<head><title>Hello</title><meta property='og:description' content='A page'></head>");
  if (p === "/to-private") return (res.writeHead(302, { Location: `${base}/private` }), res.end());
  if (p === "/private") return html("<title>Secret</title>");
  const hop = p.match(/^\/hop\/(\d+)$/);
  if (hop) return (res.writeHead(301, { Location: `/hop/${Number(hop[1]) + 1}` }), res.end());
  if (p === "/slow") return; // never answers
  if (p === "/json") return (res.writeHead(200, { "Content-Type": "application/json" }), res.end('{"a":"<title>Not a page</title>"}'));
  if (p === "/huge") return html(`${" ".repeat(MAX_BYTES)}<title>Too far in</title>`);
  res.writeHead(404).end();
});

/** Like the real guards, except this test site counts as public; /private doesn't. */
const guard = (u: URL) => {
  if (u.pathname === "/private") throw new Error("private");
};

before(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
after(() => server.close());

test("a page's title and description come back", async () => {
  const r = await unfurl(`${base}/page`, guard);
  assert.deepEqual([r.title, r.description], ["Hello", "A page"]);
});

test("each redirect is checked before it's followed, so one can't lead somewhere private", async () => {
  const r = await unfurl(`${base}/to-private`, guard);
  assert.deepEqual([r.title, hits.get("/private") ?? 0], [null, 0]);
});

test(`redirects stop after ${MAX_REDIRECTS}`, async () => {
  const r = await unfurl(`${base}/hop/0`, guard);
  assert.equal(r.title, null);
  assert.deepEqual([0, 1, 2, 3, 4].map((n) => hits.get(`/hop/${n}`) ?? 0), [1, 1, 1, 1, 0]);
});

test("a page that never answers gives up at the deadline", async () => {
  const started = Date.now();
  const r = await unfurl(`${base}/slow`, guard, { timeout: 300 });
  assert.equal(r.title, null);
  assert.ok(Date.now() - started < 2000, `took ${Date.now() - started} ms`);
});

test("only HTML is read, and only its first 512 KB", async () => {
  assert.equal((await unfurl(`${base}/json`, guard)).title, null);
  assert.equal((await unfurl(`${base}/huge`, guard)).title, null);
});

test("URLs with credentials aren't fetched", async () => {
  const r = await unfurl(`http://me:secret@${base.slice("http://".length)}/page?creds`, guard);
  assert.deepEqual([r.title, hits.get("/page?creds") ?? 0], [null, 0]);
});

test("public URLs: public names and addresses on the default port only", () => {
  const verdict = (url: string) => {
    try {
      assertPublicUrl(new URL(url));
      return "ok";
    } catch (e) {
      return (e as Error).message;
    }
  };
  assert.deepEqual(
    [
      "https://example.com/a", "http://1.1.1.1/", "https://[2606:4700::1111]/",
      "http://localhost/", "http://printer.local/", "http://intranet/", "http://db.internal/", "https://example.com:8443/",
      "http://127.0.0.1/", "http://0x7f.1/", "http://2130706433/", "http://10.1.2.3/", "http://169.254.169.254/latest/meta-data",
      "http://[::1]/", "http://[::ffff:127.0.0.1]/", "http://[fd00::1]/", "http://[fe80::1]/",
    ].map((u) => [u, verdict(u)]),
    [
      ["https://example.com/a", "ok"], ["http://1.1.1.1/", "ok"], ["https://[2606:4700::1111]/", "ok"],
      ["http://localhost/", "private"], ["http://printer.local/", "private"], ["http://intranet/", "private"], ["http://db.internal/", "private"],
      ["https://example.com:8443/", "port"],
      ["http://127.0.0.1/", "private"], ["http://0x7f.1/", "private"], ["http://2130706433/", "private"], ["http://10.1.2.3/", "private"],
      ["http://169.254.169.254/latest/meta-data", "private"],
      ["http://[::1]/", "private"], ["http://[::ffff:127.0.0.1]/", "private"], ["http://[fd00::1]/", "private"], ["http://[fe80::1]/", "private"],
    ],
  );
});

test("private addresses, as DNS returns them", () => {
  const addrs = ["8.8.8.8", "172.15.0.1", "172.16.0.1", "100.64.0.1", "192.168.1.1", "224.0.0.1", "::ffff:10.0.0.1", "2001:4860:4860::8888", "64:ff9b::a00:1"];
  assert.deepEqual(
    addrs.map((a) => [a, isPrivateAddress(a)]),
    [["8.8.8.8", false], ["172.15.0.1", false], ["172.16.0.1", true], ["100.64.0.1", true], ["192.168.1.1", true], ["224.0.0.1", true], ["::ffff:10.0.0.1", true], ["2001:4860:4860::8888", false], ["64:ff9b::a00:1", true]],
  );
});
