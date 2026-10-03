import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { startCloud, type Cloud } from "./cloud.ts";

let cloud: Cloud;
before(async () => {
  cloud = await startCloud();
});
after(() => cloud.close());

test("hashed scripts and styles are cached for good, and pages are fetched fresh every time", async () => {
  const script = await cloud.request(null, "GET", "/assets/app.js");
  assert.equal(script.status, 200);
  assert.equal(script.headers.get("cache-control"), "public, max-age=31536000, immutable");
  const page = await cloud.request(null, "GET", "/");
  assert.equal(page.status, 200);
  assert.equal(page.headers.get("cache-control"), "no-store");
  assert.equal((await cloud.request(null, "GET", "/_headers")).headers.get("cache-control"), "no-store"); // not served: the app's page instead
});

test("each of the app's pages is the app, so going straight to one (or reloading on it) draws it", async () => {
  const me = await cloud.signIn("pages");
  for (const p of ["/notes", "/tasks", "/tags", "/query-help", "/checkup", "/history", "/calendar", "/contacts", "/replace"]) {
    const res = await cloud.request(me, "GET", p);
    assert.equal(res.status, 200, p);
    assert.match(String(res.headers.get("content-type")), /^text\/html/, p);
    assert.match(await res.text(), /<script type="module" src="\/assets\/app\.js" nonce="[^"]+">/, p);
  }
});
