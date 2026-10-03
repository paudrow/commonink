// An MCP client's token reaches POST /mcp/cli/run too: there it gets what MCP gives it, no command that
// isn't a tool and nothing a tool requires left out. The CLI signed in for one workspace keeps the CLI's.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startCloud, team, type Cloud } from "./cloud.ts";
import { cli, login } from "./cli-login.ts";

let cloud: Cloud;
let people: Awaited<ReturnType<typeof team>>;

before(async () => {
  cloud = await startCloud();
  people = await team(cloud);
});
after(() => cloud.close());

const form = (fields: Record<string, string>) => new URLSearchParams(fields).toString();
const post = (p: string, body: string, headers: Record<string, string> = {}) =>
  cloud.server.fetch(new URL(p, cloud.origin), { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded", ...headers }, body });

/** An app connected to the Team workspace as the editor, start to finish: its access token. */
async function connect(redirect: string, scope?: string) {
  const reg = await cloud.server.fetch(new URL("/oauth/register", cloud.origin), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: "Some Agent", redirect_uris: [redirect], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"] }),
  });
  const { client_id } = (await reg.json()) as { client_id: string };
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest().toString("base64url");
  const query = form({ response_type: "code", client_id, redirect_uri: redirect, code_challenge: challenge, code_challenge_method: "S256", state: "s", ...(scope ? { scope } : {}) });
  const page = await cloud.request(people.editor, "GET", `/authorize?${query}`);
  const handle = (await page.text()).match(/name="handle" value="([^"]+)"/)![1];
  const binding = page.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const answer = await post("/authorize", form({ handle, decision: "allow", workspace: people.id }), { cookie: `${people.editor}; ${binding}`, origin: cloud.origin });
  const code = new URL(answer.headers.get("location")!).searchParams.get("code")!;
  const tokens = await post("/oauth/token", form({ grant_type: "authorization_code", code, redirect_uri: redirect, client_id, code_verifier: verifier }));
  assert.equal(tokens.status, 200);
  return ((await tokens.json()) as { access_token: string }).access_token;
}

const run = async (token: string, command: string, input: Record<string, unknown>) => {
  const res = await fetch(new URL("/mcp/cli/run", cloud.origin), {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ command, input }),
  });
  return { status: res.status, body: (await res.json()) as { ok: boolean; error?: string; code?: string; text?: string } };
};

test("an MCP client on the CLI route gets MCP's commands, with what their tools require", async () => {
  // One on this computer (as most MCP clients are), and a website that asked for every workspace and got one.
  for (const [i, token] of [await connect("http://127.0.0.1:9/callback"), await connect("https://look-alike.example/cb", "workspaces")].entries()) {
    const folder = `Agent ${i}`;
    assert.equal((await run(token, "create", { path: `${folder}/Acme plan`, content: "Acme\n" })).status, 200);
    // Not tools: for people, in the app or the CLI.
    for (const [command, input] of [
      ["label-rm", { label: "v1", note: `${folder}/Acme plan` }],
      ["calendars add", { url: "https://demo.commonink.invalid/agents.ics" }],
    ] as const) {
      const { status, body } = await run(token, command, input);
      assert.equal(status, 403, command);
      assert.match(body.error!, new RegExp(`^${command} isn't open to agents: `));
    }
    // replace_text runs only with dry_run said outright.
    const blind = await run(token, "replace", { find: "Acme", replace: "Evil", folder });
    assert.deepEqual([blind.status, blind.body.code, blind.body.error], [400, "usage", "replace needs dry_run from an agent, as the replace_text tool does"]);
    // null says nothing either: it would write, as leaving it out does.
    assert.equal((await run(token, "replace", { find: "Acme", replace: "Evil", folder, dry_run: null })).status, 400);
    assert.equal((await run(token, "replace", { find: "Acme", replace: "Evil", folder, dry_run: true })).status, 200);
    const note = await cloud.call(people.editor, "GET", `${people.base}/note?path=${encodeURIComponent(`${folder}/Acme plan.md`)}`);
    assert.equal(note.content, "Acme\n");
  }
});

test("the CLI signed in for one workspace is still the CLI", async () => {
  const c = cli();
  await login(cloud, c, people.editor, people.id);
  assert.equal(c.run(["create", "CLI/Plan", "Acme"]).status, 0);
  // A person at the CLI leaves --dry-run out to write.
  const replaced = c.run(["replace", "Acme", "Evil", "--folder", "CLI"]);
  assert.equal(replaced.status, 0, replaced.stderr);
  assert.equal(c.json(["read", "CLI/Plan"]).content, "Evil");
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "commonink-up-")), "pic.png");
  fs.writeFileSync(file, Buffer.from([137, 80, 78, 71]));
  const up = c.run(["upload", file]);
  assert.equal(up.status, 0, up.stderr);
  // Runs, and finds no such label.
  assert.equal(c.run(["label-rm", "nope", "--note", "CLI/Plan"]).status, 3);
});
