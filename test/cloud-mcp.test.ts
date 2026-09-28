import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startCloud, team, type Cloud } from "./cloud.ts";

let cloud: Cloud;
let people: Awaited<ReturnType<typeof team>>;
const REDIRECT = "http://127.0.0.1:9/callback";

before(async () => {
  cloud = await startCloud();
  people = await team(cloud);
});
after(() => cloud.close());

const b64url = (b: Buffer) => b.toString("base64url");
const form = (fields: Record<string, string>) => new URLSearchParams(fields).toString();
const post = (p: string, body: string, headers: Record<string, string> = {}) =>
  cloud.server.fetch(new URL(p, cloud.origin), { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded", ...headers }, body });

/** Register a client the way an MCP client does (dynamic client registration). */
async function register(name = "Test Agent") {
  const res = await cloud.server.fetch(new URL("/oauth/register", cloud.origin), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: name, redirect_uris: [REDIRECT], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"] }),
  });
  assert.equal(res.status, 201);
  return ((await res.json()) as { client_id: string }).client_id;
}

/**
 * The browser side of connecting an agent: sign-in cookie, consent page, Allow with a workspace,
 * and the code at the redirect.
 */
async function authorizeCode(cookie: string, workspace: string, client: string) {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const query = form({ response_type: "code", client_id: client, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: "S256", state: "st4te", resource: `${cloud.origin}/mcp` });
  const page = await cloud.request(cookie, "GET", `/authorize?${query}`);
  assert.equal(page.status, 200);
  const html = await page.text();
  const handle = html.match(/name="handle" value="([^"]+)"/)![1];
  const binding = page.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const answer = await post("/authorize", form({ handle, decision: "allow", workspace }), { cookie: `${cookie}; ${binding}`, origin: cloud.origin });
  assert.equal(answer.status, 302);
  const back = new URL(answer.headers.get("location")!);
  assert.deepEqual([back.origin + back.pathname, back.searchParams.get("state")], [REDIRECT, "st4te"]);
  return { html, verifier, code: back.searchParams.get("code")! };
}

const exchange = (client: string, code: string, verifier: string) =>
  post("/oauth/token", form({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: client, code_verifier: verifier, resource: `${cloud.origin}/mcp` }));

/** Connect an agent from start to finish: registration, consent, and the code for tokens with PKCE. */
async function connect(cookie: string, workspace: string) {
  const client = await register();
  const { html, code, verifier } = await authorizeCode(cookie, workspace, client);
  const tokens = await exchange(client, code, verifier);
  assert.equal(tokens.status, 200);
  const t = (await tokens.json()) as { access_token: string; refresh_token: string };
  return { client, html, access: t.access_token, refresh: t.refresh_token };
}

async function mcp(token: string) {
  const client = new Client({ name: "test-agent", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL("/mcp", cloud.origin), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = (await client.callTool({ name, arguments: args })) as { content: Array<{ text: string }>; isError?: boolean };
    return { text: r.content.map((c) => c.text).join("\n"), isError: !!r.isError };
  };
  return { client, call, tools: async () => (await client.listTools()).tools.map((t) => t.name).sort() };
}

const READ_TOOLS = ["backlinks", "list_notes", "read_note", "recent_changes", "search_notes"];
const ALL_TOOLS = ["append_to_note", "archive_note", "backlinks", "create_note", "edit_note", "list_notes", "move_note", "read_note", "recent_changes", "search_notes", "star_note", "unarchive_note", "unstar_note"];

test("an agent discovers where to sign in from /mcp", async () => {
  const res = await cloud.server.fetch(new URL("/mcp", cloud.origin), { method: "POST" });
  assert.equal(res.status, 401);
  assert.match(res.headers.get("www-authenticate")!, new RegExp(`resource_metadata="${cloud.origin}/.well-known/oauth-protected-resource/mcp"`));
  const meta = (await (await cloud.server.fetch(new URL("/.well-known/oauth-protected-resource/mcp", cloud.origin))).json()) as Record<string, unknown>;
  assert.equal(meta.resource, `${cloud.origin}/mcp`);
  const as = (await (await cloud.server.fetch(new URL("/.well-known/oauth-authorization-server", cloud.origin))).json()) as Record<string, unknown>;
  assert.deepEqual(
    [as.authorization_endpoint, as.token_endpoint, as.registration_endpoint, as.code_challenge_methods_supported],
    [`${cloud.origin}/authorize`, `${cloud.origin}/oauth/token`, `${cloud.origin}/oauth/register`, ["S256"]],
  );
});

test("the consent page names the agent, where access goes, and each workspace with your role", async () => {
  const { html } = await connect(people.viewer, people.id);
  assert.match(html, /Connect Test Agent to Common Ink\?/);
  assert.match(html, /Its changes show in History as <strong>Test Agent \(via Viewer\)<\/strong>/);
  assert.match(html, /Access goes to <strong>127\.0\.0\.1<\/strong>\. That's an app on your computer/);
  assert.match(html, /<strong>Team<\/strong><br><span class="muted">You're a viewer: it can read notes, and star them for you\.<\/span>/);
});

test("Deny sends the agent back with access_denied, and a forged answer from another site is refused", async () => {
  const client = await register();
  const query = form({ response_type: "code", client_id: client, redirect_uri: REDIRECT, code_challenge: b64url(randomBytes(32)), code_challenge_method: "S256", state: "s" });
  const page = await cloud.request(people.owner, "GET", `/authorize?${query}`);
  const handle = (await page.text()).match(/name="handle" value="([^"]+)"/)![1];
  const cookie = `${people.owner}; ${page.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ")}`;
  const forged = await post("/authorize", form({ handle, decision: "allow", workspace: people.id }), { cookie, origin: "https://evil.example" });
  assert.equal(forged.status, 403);
  const denied = await post("/authorize", form({ handle, decision: "deny" }), { cookie, origin: cloud.origin });
  const back = new URL(denied.headers.get("location")!);
  assert.deepEqual([denied.status, back.searchParams.get("error"), back.searchParams.get("state")], [302, "access_denied", "s"]);
});

test("a wrong PKCE verifier or a used code gets no tokens", async () => {
  const client = await register();
  const first = await authorizeCode(people.owner, people.id, client);
  assert.equal((await exchange(client, first.code, b64url(randomBytes(32)))).status, 400, "wrong verifier");
  const second = await authorizeCode(people.owner, people.id, client);
  assert.deepEqual([(await exchange(client, second.code, second.verifier)).status, (await exchange(client, second.code, second.verifier)).status], [200, 400]);
});

test("an agent acts as its person, with their role, and its writes say who", async () => {
  const owner = await mcp((await connect(people.owner, people.id)).access);
  const viewer = await mcp((await connect(people.viewer, people.id)).access);
  assert.deepEqual(await owner.tools(), ALL_TOOLS);
  assert.deepEqual(await viewer.tools(), [...READ_TOOLS, "star_note", "unstar_note"].sort());

  assert.deepEqual(await owner.call("create_note", { path: "From an agent", content: "# From an agent\n" }), { text: "Created From an agent.md → version ef45559ebd67 (2 lines)", isError: false });
  // Its note's URL works like any other: the ID reaches the directory once the call is done,
  // without waiting for some other request to the workspace.
  const storage = await cloud.server.getWorker().getDurableObjectStorage("WORKSPACE", { name: people.id });
  const [{ id }] = (await storage.exec("SELECT id FROM notes WHERE path = ?", "From an agent.md")) as Array<{ id: string }>;
  const locate = async () => (await cloud.request(people.editor, "GET", `/api/note-ids/${id}`)).status;
  let status = await locate();
  for (let i = 0; i < 40 && status !== 200; i++) status = await new Promise((r) => setTimeout(r, 50)).then(locate);
  assert.equal(status, 200);
  const [latest] = await cloud.call(people.owner, "GET", `${people.base}/changes?limit=1`);
  assert.deepEqual([latest.path, latest.source], ["From an agent.md", "Test Agent (via Owner)"]);

  const refused = await viewer.call("create_note", { path: "Nope", content: "x" });
  assert.equal(refused.isError, true);
  assert.equal((await viewer.call("read_note", { path: "From an agent" })).isError, false);
  await Promise.all([owner.client.close(), viewer.client.close()]);
});

test("a role change applies to a connected agent on its next request", async () => {
  const editor = await mcp((await connect(people.editor, people.id)).access);
  assert.ok((await editor.tools()).includes("create_note"));
  const env = await cloud.server.getWorker().getEnv();
  await env.DB.prepare("UPDATE members SET role = 'viewer' WHERE workspace_id = ? AND user_id = (SELECT id FROM users WHERE email = 'editor@localhost')").bind(people.id).run();
  const later = await mcp((await connect(people.editor, people.id)).access);
  assert.deepEqual([(await editor.tools()).includes("create_note"), (await later.tools()).includes("create_note")], [false, false]);
  await env.DB.prepare("UPDATE members SET role = 'editor' WHERE workspace_id = ? AND user_id = (SELECT id FROM users WHERE email = 'editor@localhost')").bind(people.id).run();
});

test("refresh tokens rotate, and tokens are stored only as hashes", async () => {
  const { client, refresh, access } = await connect(people.owner, people.id);
  const res = await post("/oauth/token", form({ grant_type: "refresh_token", refresh_token: refresh, client_id: client }));
  assert.equal(res.status, 200);
  const next = (await res.json()) as { access_token: string; refresh_token: string };
  assert.notEqual(next.refresh_token, refresh);
  assert.deepEqual(await (await mcp(next.access_token)).tools(), ALL_TOOLS);
  const env = await cloud.server.getWorker().getEnv();
  const secret = (t: string) => t.split(":")[2];
  const leaked = await env.DB.prepare("SELECT COUNT(*) AS n FROM oauth_kv WHERE instr(key || value, ?) > 0 OR instr(key || value, ?) > 0 OR instr(key || value, ?) > 0")
    .bind(secret(access), secret(refresh), secret(next.refresh_token))
    .first();
  assert.equal(leaked.n, 0);
});

test("Connected agents lists your agents, and Revoke cuts one off at once", async () => {
  const cookie = await cloud.signIn("revoker");
  const { workspaces } = await cloud.call(cookie, "GET", "/api/me");
  const { access, refresh, client } = await connect(cookie, workspaces[0].id);
  const agent = await mcp(access);
  await agent.call("list_notes", {});

  const list = await cloud.call(cookie, "GET", "/api/agents");
  assert.deepEqual(
    list.map((a: any) => [a.client, a.actor, a.workspace.name, a.workspace.role, typeof a.usedAt]),
    [["Test Agent", "Test Agent (via Revoker)", "Revoker's notes", "owner", "number"]],
  );
  assert.equal((await cloud.call(people.owner, "GET", "/api/agents")).some((a: any) => a.id === list[0].id), false, "only your own");
  const stolen = await cloud.request(people.owner, "POST", "/api/agents/revoke", { id: list[0].id });
  assert.equal(stolen.status, 200);
  assert.deepEqual((await cloud.call(cookie, "GET", "/api/agents")).map((a: any) => typeof a.usedAt), ["number"], "someone else can't revoke it, or touch it");

  await cloud.call(cookie, "POST", "/api/agents/revoke", { id: list[0].id });
  const after = await cloud.server.fetch(new URL("/mcp", cloud.origin), {
    method: "POST",
    headers: { authorization: `Bearer ${access}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  assert.equal(after.status, 401);
  assert.equal((await post("/oauth/token", form({ grant_type: "refresh_token", refresh_token: refresh, client_id: client }))).status, 400);
  assert.deepEqual(await cloud.call(cookie, "GET", "/api/agents"), []);
});

test("one client can work in two workspaces; connecting again to one replaces only that one", async () => {
  const cookie = await cloud.signIn("twoplaces");
  const { workspaces } = await cloud.call(cookie, "GET", "/api/me");
  const { id: second } = await cloud.call(cookie, "POST", "/api/workspaces", { name: "Second" });
  const client = await register();
  const tokenFor = async (ws: string) => {
    const { code, verifier } = await authorizeCode(cookie, ws, client);
    return ((await (await exchange(client, code, verifier)).json()) as { access_token: string }).access_token;
  };
  const status = async (token: string) =>
    (
      await cloud.server.fetch(new URL("/mcp", cloud.origin), {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      })
    ).status;
  const first = await tokenFor(workspaces[0].id);
  const other = await tokenFor(second);
  assert.deepEqual([await status(first), await status(other)], [200, 200]);
  const again = await tokenFor(workspaces[0].id);
  assert.deepEqual([await status(first), await status(other), await status(again)], [401, 200, 200]);
  assert.deepEqual((await cloud.call(cookie, "GET", "/api/agents")).map((a: any) => a.workspace.name).sort(), ["Second", "Twoplaces's notes"]);
});

test("signing out everywhere disconnects your agents too", async () => {
  const cookie = await cloud.signIn("leaver");
  const { workspaces } = await cloud.call(cookie, "GET", "/api/me");
  const { access } = await connect(cookie, workspaces[0].id);
  await cloud.call(cookie, "POST", "/api/sign-out-everywhere", {});
  const res = await cloud.server.fetch(new URL("/mcp", cloud.origin), { method: "POST", headers: { authorization: `Bearer ${access}` } });
  assert.equal(res.status, 401);
});

test("sign-in and consent keep a popup's link to the app that opened it", async () => {
  const res = await cloud.server.fetch(new URL("/authorize?client_id=x", cloud.origin), { redirect: "manual" });
  assert.equal(res.headers.get("cross-origin-opener-policy"), "unsafe-none");
  assert.equal((await cloud.server.fetch(new URL("/", cloud.origin))).headers.get("cross-origin-opener-policy"), "same-origin");
});

test("a client can revoke its own token (RFC 7009)", async () => {
  const { access, client } = await connect(people.owner, people.id);
  assert.equal((await post("/oauth/token", form({ token: access, client_id: client }))).status, 200);
  const res = await cloud.server.fetch(new URL("/mcp", cloud.origin), { method: "POST", headers: { authorization: `Bearer ${access}` } });
  assert.equal(res.status, 401);
});
