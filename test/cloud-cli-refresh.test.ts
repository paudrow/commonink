// Many CLI commands at once as the sign-in runs out. Its own file, with its own server: the logins in
// cloud-cli.test.ts already use up most of an address's 20 app registrations an hour.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { startCloud, team, type Cloud } from "./cloud.ts";
import { BIN, cli, login as loginTo } from "./cli-login.ts";

let cloud: Cloud;
let people: Awaited<ReturnType<typeof team>>;

before(async () => {
  cloud = await startCloud();
  people = await team(cloud);
});
after(() => cloud.close());

const login = (c: ReturnType<typeof cli>, cookie: string) => loginTo(cloud, c, cookie);

test("commands run at once as the sign-in runs out all refresh it, and the next command still works", async () => {
  const c = cli();
  await login(c, people.viewer);
  const file = path.join(c.config, "credentials.json");
  const run = (args: string[]) =>
    new Promise<{ status: number | null; stderr: string }>((resolve) => {
      const child = spawn(BIN, args, { env: c.env, stdio: ["ignore", "ignore", "pipe"] });
      let stderr = "";
      child.stderr.on("data", (d) => (stderr += d));
      child.on("exit", (status) => resolve({ status, stderr }));
    });
  const expire = () => {
    const creds = JSON.parse(fs.readFileSync(file, "utf8"));
    fs.writeFileSync(file, JSON.stringify({ ...creds, expiresAt: Date.now() - 1000 }), { mode: 0o600 });
  };
  for (let round = 0; round < 3; round++) {
    expire();
    const all = await Promise.all(Array.from({ length: 8 }, () => run(["ls", "--workspace", "Team"])));
    for (const r of all) assert.equal(r.status, 0, r.stderr);
    // The token kept is one the server still takes: the next refresh works.
    expire();
    const later = c.run(["ls", "--workspace", "Team"]);
    assert.equal(later.status, 0, later.stderr);
  }
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(fs.readdirSync(c.config), ["credentials.json"]);
});
