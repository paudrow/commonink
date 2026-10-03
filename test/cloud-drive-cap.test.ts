import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startCloud, type Cloud } from "./cloud.ts";

// A note on its way to Drive is counted as it arrives, so one sent without a length stops at 50 MB
// instead of being read whole first (the test Worker's Drive is the stand-in, cloud/src/google-mock.ts).
let cloud: Cloud;
before(async () => {
  cloud = await startCloud();
});
after(() => cloud.close());

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** A body sent without a length: `mb` megabytes, then the end. */
function chunked(mb: number) {
  const chunk = new Uint8Array(1024 * 1024).fill(120);
  let sent = 0;
  return new ReadableStream<Uint8Array>({ pull: (c) => (sent++ < mb ? c.enqueue(chunk) : c.close()) });
}

/** Allow Drive, the way a browser does: start, the stand-in's consent page, Allow, and back. */
async function connectDrive(cookie: string) {
  const res = await cloud.request(cookie, "GET", "/auth/google/drive?next=%2F&as=doc");
  const pending = res.headers.getSetCookie().map((c) => c.split(";")[0]).find((c) => c.startsWith("__Host-ci_gcal="))!;
  const consent = new URL(res.headers.get("location")!);
  const both = `${cookie}; ${pending}`;
  const allowed = await cloud.server.fetch(new URL(consent.pathname + consent.search, cloud.origin), {
    method: "POST",
    redirect: "manual",
    headers: { cookie: both, origin: cloud.origin, "content-type": "application/x-www-form-urlencoded" },
    body: "decision=allow",
  });
  const callback = new URL(allowed.headers.get("location")!);
  await cloud.request(both, "GET", callback.pathname + callback.search);
}

test("a note sent to Drive without a length is refused past 50 MB", async () => {
  const me = await cloud.signIn("drivestreamer");
  await connectDrive(me);
  const send = (body: ReadableStream<Uint8Array>) =>
    cloud.server.fetch(new URL("/api/google/drive?as=doc&title=Big", cloud.origin), { method: "POST", headers: { cookie: me, origin: cloud.origin, "content-type": DOCX }, body, duplex: "half" } as never);

  assert.equal((await send(chunked(1))).status, 200);
  const res = await send(chunked(51));
  assert.equal(res.status, 413);
  assert.deepEqual(await res.json(), { error: "That note is over 50 MB with its pictures: Google Drive won't convert it" });
});

// The test server hands the Worker a request's whole body before it answers, so it can't tell a capped
// read from one that buffers everything first: this does. Stored files and Google's answers are ours to read.
test("no route reads a request's body whole as bytes; each goes through readUpTo", () => {
  const dir = path.resolve(import.meta.dirname, "../cloud/src");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".ts"));
  const whole = files.flatMap((f) => [...fs.readFileSync(path.join(dir, f), "utf8").matchAll(/\b(req|request)\.(arrayBuffer|blob|bytes)\(\)/g)].map((m) => `${f}: ${m[0]}`));
  assert.deepEqual(whole, []);
});
