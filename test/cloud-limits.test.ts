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
  const builder = await cloud.signIn("builder");
  assert.equal(await statuses(11, (i) => cloud.request(builder, "POST", "/api/workspaces", { name: `Team ${i}` })), "200×10, 429×1");
});

test("OAuth client registrations are limited per network address", async () => {
  const register = () =>
    cloud.server.fetch(new URL("/oauth/register", cloud.origin), {
      method: "POST",
      headers: { "content-type": "application/json", "CF-Connecting-IP": "203.0.113.50" },
      body: JSON.stringify({ client_name: "Spam", redirect_uris: ["http://127.0.0.1:9/cb"], token_endpoint_auth_method: "none" }),
    });
  assert.equal(await statuses(21, register), "201×20, 429×1");
});

test("a working share link isn't limited, however many requests its page makes; tries at links that don't work are", async () => {
  const sharer = await cloud.signIn("sharer");
  const { id } = await cloud.call(sharer, "POST", "/api/workspaces", { name: "Shared" });
  await cloud.call(sharer, "POST", `/api/w/${id}/note`, { path: "Index.md", content: "# Index\n" });
  const made = await cloud.call(sharer, "POST", `/api/w/${id}/shares`, { path: "Index.md", link: true, role: "viewer" });
  const token: string = made.shares.find((s: { kind: string }) => s.kind === "link").url.split("/")[2];
  const from = (t: string) => cloud.request(null, "GET", `/api/s/${t}/list`, undefined, { "CF-Connecting-IP": "203.0.113.80" });
  assert.equal(await statuses(320, () => from(token)), "200×320", "one office opening a big index note, again and again");
  assert.equal(await statuses(301, (i) => from(i.toString(16).padStart(64, "0"))), "404×300, 429×1");
  assert.equal((await from(token)).status, 429, "past the limit, a working link is refused too, so a right guess looks like a wrong one");
});
