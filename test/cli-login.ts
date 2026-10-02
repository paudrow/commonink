// The CLI against a hosted workspace in tests: a CLI with its own config folder, and `commonink login`
// through a real OAuth round trip. Each login registers an app, and a network address may register 20
// an hour (cloud/src/limits.ts), so a file of tests shares one startCloud for at most about 20 logins.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Cloud } from "./cloud.ts";

export const BIN = path.resolve(import.meta.dirname, "../bin/commonink");

/** A CLI with its own config folder (where login keeps its tokens), and no local vault in the way. */
export function cli() {
  const config = fs.mkdtempSync(path.join(os.tmpdir(), "commonink-config-"));
  const env: NodeJS.ProcessEnv = { ...process.env, COMMONINK_CONFIG_DIR: config };
  delete env.COMMONINK_VAULT;
  delete env.COMMONINK_AGENT;
  delete env.COMMONINK_WORKSPACE;
  const run = (args: string[], input?: string) => {
    const r = spawnSync(BIN, args, { env, input, encoding: "utf8" });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr };
  };
  return { config, env, run, json: (args: string[]) => JSON.parse(run([...args, "--json"]).stdout) };
}

/** `commonink login`, with `cookie`'s person in the browser allowing it for `workspace` ("*" for all of them). */
export async function login(cloud: Cloud, c: ReturnType<typeof cli>, cookie: string, workspace = "*") {
  const child = spawn(BIN, ["login", "--server", cloud.origin, "--no-browser"], { env: c.env, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  let err = "";
  child.stdout.on("data", (d) => (out += d));
  // A login that fails before it prints the address (the server refusing to register it) ends the test, not hangs it.
  const url = await new Promise<string>((resolve, reject) => {
    child.stderr.on("data", (d) => {
      err += d;
      const m = err.match(/(http\S+\/authorize\?\S+)/);
      if (m) resolve(m[1]);
    });
    child.on("exit", (code) => reject(new Error(`commonink login exited (${code}) before asking to authorize: ${err}`)));
  });
  const page = await cloud.request(cookie, "GET", new URL(url).pathname + new URL(url).search);
  assert.equal(page.status, 200);
  const html = await page.text();
  const handle = html.match(/name="handle" value="([^"]+)"/)![1];
  const binding = page.headers.getSetCookie().map((x) => x.split(";")[0]).join("; ");
  const answer = await cloud.server.fetch(new URL("/authorize", cloud.origin), {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: `${cookie}; ${binding}`, origin: cloud.origin },
    body: new URLSearchParams({ handle, decision: "allow", workspace }).toString(),
  });
  assert.equal(answer.status, 302);
  // The browser follows the redirect to the CLI's loopback address.
  await fetch(answer.headers.get("location")!);
  const status = await new Promise<number | null>((resolve) => child.on("exit", resolve));
  return { status, out, err, html };
}
