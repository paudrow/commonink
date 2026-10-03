// How much a hosted workspace reads of a CLI command (POST /mcp/cli/run): a body past MAX_RUN_BODY is
// refused as it streams in, so a Worker never decodes more base64 than fits its memory, and the CLI
// says so before sending a file that big.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startCloud, type Cloud } from "./cloud.ts";
import { cli, login } from "./cli-login.ts";
import { MAX_RUN_BODY } from "../src/core/commands/wire.ts";

let cloud: Cloud;
let c: ReturnType<typeof cli>;
let token: string;

before(async () => {
  cloud = await startCloud();
  c = cli();
  assert.equal((await login(cloud, c, await cloud.signIn("uploader"))).status, 0);
  token = JSON.parse(fs.readFileSync(path.join(c.config, "credentials.json"), "utf8")).accessToken;
});
after(() => cloud.close());

const run = (body: BodyInit, headers: Record<string, string> = {}) =>
  cloud.server.fetch(new URL("/mcp/cli/run", cloud.origin), { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...headers }, body, duplex: "half" } as never);

test("a command's body past the cap is refused with 413, with a length or without one", async () => {
  // Under the cap, a file goes up as before.
  const small = await run(JSON.stringify({ command: "upload", input: { files: [{ name: "small.txt", bytes: { $bytes: btoa("hello") } }] } }));
  assert.equal(small.status, 200);
  assert.deepEqual((await small.json()).data, [{ path: "assets/small.txt", size: 5 }]);
  const big = JSON.stringify({ command: "upload", input: { files: [{ name: "big.bin", bytes: { $bytes: "A".repeat(MAX_RUN_BODY) } }] } });
  const said = await run(big);
  assert.equal(said.status, 413);
  assert.deepEqual(await said.json(), { ok: false, error: "That's over 20 MB: upload bigger files in the app", code: "too_large" });
  // Streamed, with no Content-Length to go by: counted as it comes in.
  const chunk = new Uint8Array(1024 * 1024).fill(65);
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(ctl) {
      if (sent > MAX_RUN_BODY + chunk.length) return ctl.close();
      ctl.enqueue(chunk);
      sent += chunk.length;
    },
  });
  const streamed = await run(stream);
  assert.equal(streamed.status, 413);
  await streamed.body?.cancel();
});

test("the CLI won't send a file the workspace wouldn't read, and says why", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "commonink-big-"));
  const file = path.join(dir, "big.bin");
  fs.writeFileSync(file, Buffer.alloc(16 * 1024 * 1024, 7));
  const r = c.run(["upload", file]);
  assert.equal(r.status, 1);
  assert.equal(r.stderr, "That's too big to send to a hosted workspace: 20 MB at most, about 15 MB of files. Upload bigger files in the app.\n");
  fs.rmSync(dir, { recursive: true, force: true });
});
