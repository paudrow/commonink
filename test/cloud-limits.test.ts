import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { startCloud, team, type Cloud } from "./cloud.ts";

let cloud: Cloud;
before(async () => (cloud = await startCloud()));
after(() => cloud.close());

/** Send `n` requests one after another; the statuses, run together ("302×60, 429"). */
async function statuses(n: number, send: (i: number) => Promise<{ status: number; body: { cancel(): Promise<void> } | null }>) {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const res = await send(i);
    await res.body?.cancel();
    out.push(res.status);
  }
  return out.reduce<string[]>((runs, s) => {
    const last = runs.at(-1)?.match(/^(\d+)×(\d+)$/);
    if (last && Number(last[1]) === s) runs[runs.length - 1] = `${s}×${Number(last[2]) + 1}`;
    else runs.push(`${s}×1`);
    return runs;
  }, []).join(", ");
}

test("sign-in attempts are limited per network address", async () => {
  const from = (ip: string) => cloud.server.fetch(new URL("/auth/dev?as=limited", cloud.origin), { redirect: "manual", headers: { "CF-Connecting-IP": ip } });
  assert.equal(await statuses(61, () => from("203.0.113.7")), "302×60, 429×1");
  const refused = await from("203.0.113.7");
  assert.match(refused.headers.get("retry-after")!, /^(5[5-9]\d|600)$/, "about 10 minutes, counted from the first try");
  assert.equal(await refused.text(), "Too many sign-in attempts from your network. Try again in 10 minutes.");
  assert.equal((await from("198.51.100.2")).status, 302, "another address isn't affected");
});

test("invites, uploads and link previews are limited per person", async () => {
  const { owner, editor, base } = await team(cloud);
  // 20 an hour, and team() already invited the editor and the viewer.
  assert.equal(await statuses(19, () => cloud.request(owner, "POST", `${base}/invites`, { role: "viewer" })), "200×18, 429×1");
  const upload = (who: string, i: number) => cloud.request(who, "POST", `${base}/upload?name=f${i}.txt`, new TextEncoder().encode("x"), { "content-type": "text/plain" });
  assert.equal(await statuses(121, (i) => upload(editor, i)), "200×120, 429×1");
  assert.equal((await upload(owner, 999)).status, 200, "someone else can still upload");
  const preview = (i: number) => cloud.request(editor, "GET", `/api/unfurl?url=${encodeURIComponent(`http://localhost/${i}`)}`);
  assert.equal(await statuses(121, preview), "200×120, 429×1");
});
