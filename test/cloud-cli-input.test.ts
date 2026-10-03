// What reaches POST /mcp/cli/run is checked against the command's arguments, as MCP's tools are: the
// CLI checks before it sends, but anything holding a token can post JSON there.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { startCloud, team, type Cloud } from "./cloud.ts";
import { cli, login } from "./cli-login.ts";

let cloud: Cloud;
let people: Awaited<ReturnType<typeof team>>;
let token: string;

before(async () => {
  cloud = await startCloud();
  people = await team(cloud);
  // An editor's sign-in for just the Team workspace.
  const c = cli();
  await login(cloud, c, people.editor, people.id);
  token = JSON.parse(fs.readFileSync(path.join(c.config, "credentials.json"), "utf8")).accessToken;
});
after(() => cloud.close());

const run = async (command: string, input: Record<string, unknown>) => {
  const res = await fetch(new URL("/mcp/cli/run", cloud.origin), {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ command, input }),
  });
  const text = await res.text();
  return { status: res.status, body: (() => { try { return JSON.parse(text); } catch { return text; } })() };
};

test("input that doesn't fit the command's arguments is a usage error, not a crash or a value out of range", async () => {
  assert.equal((await run("create", { path: "Plan", content: "# Plan\n" })).status, 200);
  for (const [command, input] of [
    ["archive", { paths: "Plan" }], // a string where a list goes
    ["read", {}], // a required argument left out
    ["search", { query: "Plan", limit: 100000 }], // over the command's cap of 50
    ["share", { path: "Plan", email: "x@example.com", role: "viewer", expires_in_days: -3 }], // already expired
    ["share", { path: "Plan", email: "x@example.com", role: "owner" }], // not a role a share can have
  ] as const) {
    const { status, body } = await run(command, input);
    assert.equal(status, 400, `${command} ${JSON.stringify(input)}: ${JSON.stringify(body)}`);
    assert.equal(body.code, "usage");
    assert.match(body.error, new RegExp(`^${command}: .*See commonink help ${command}$`));
    assert.doesNotMatch(body.error, /D1_ERROR|CHECK constraint/);
  }
  // Nothing was shared or archived.
  assert.match((await run("shares", { path: "Plan" })).body.text, /isn't shared with anyone/);
  assert.equal((await run("read", { path: "Plan" })).body.data.content, "# Plan\n");
  // What fits still runs.
  assert.equal((await run("search", { query: "Plan", limit: 50 })).status, 200);
});
