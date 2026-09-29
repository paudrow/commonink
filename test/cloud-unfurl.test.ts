import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startCloud, type Cloud } from "./cloud.ts";

let cloud: Cloud;
before(async () => (cloud = await startCloud()));
after(() => cloud.close());

test("link previews online never reach private addresses or the app itself", async () => {
  let reached = 0;
  const inside = http.createServer((_req, res) => (reached++, res.end("<title>Inside</title>")));
  await new Promise<void>((r) => inside.listen(0, "127.0.0.1", r));
  const port = (inside.address() as { port: number }).port;
  const cookie = await cloud.signIn("prober");
  const targets = [`http://127.0.0.1:${port}/`, `http://localhost:${port}/`, `http://[::1]:${port}/`, `${cloud.origin}/api/me`];
  const titles = [];
  for (const t of targets) titles.push((await cloud.call(cookie, "GET", `/api/unfurl?url=${encodeURIComponent(t)}`)).title);
  inside.close();
  assert.deepEqual([titles, reached], [[null, null, null, null], 0]);
});
