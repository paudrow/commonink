import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import WebSocket from "ws";
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
 * One client for the tests that connect several people: registrations are rate-limited per address
 * (20 an hour), and this file would pass that with a client per test.
 */
let reused: string | undefined;
const reusedClient = async () => (reused ??= await register());

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

/** Connect an agent from start to finish: registration (unless it reuses `client`), consent, and the code for tokens with PKCE. */
async function connect(cookie: string, workspace: string, client?: string) {
  client ??= await register();
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

/** What a viewer's agent gets: reading, and what's each person's own (favorites, their smart folders). */
const VIEWER_TOOLS = [
  "backlinks", "delete_smart_folder", "diff_versions", "export_note", "get_event", "get_today", "google_contacts_status", "list_contacts", "list_decisions", "list_events",
  "list_folders", "list_labels", "list_notes", "list_properties", "list_shares", "list_smart_folders", "list_tags", "list_tasks", "list_templates", "missing_links",
  "order_favorites", "read_board", "read_contact", "read_note", "recent_changes", "save_smart_folder", "save_to_drive", "search_notes", "show_change", "star_note",
  "star_smart_folder", "star_tag", "unstar_note", "unstar_smart_folder", "unstar_tag", "workspace_checkup",
];
const ALL_TOOLS = [
  ...VIEWER_TOOLS,
  "add_card", "add_task", "append_to_note", "archive_note", "ask_decision", "create_contact", "create_from_template", "create_meeting_note", "create_note", "delete_folder",
  "delete_note", "edit_card", "edit_note", "import_contacts", "import_notes", "label_version", "list_trash", "merge_contacts", "move_card", "move_note",
  "move_task", "open_journal", "remove_task", "rename_folder", "rename_tag", "replace_text", "restore_change", "restore_from_trash", "restore_label", "set_asset_tags",
  "set_property_type", "share_note", "sync_google_contacts", "unarchive_note", "unshare_note", "update_contact", "update_task", "withdraw_decision", "write_note",
].sort();

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
  assert.match(html, /Its changes show in History as <strong>Test Agent for Viewer<\/strong>/);
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
  assert.deepEqual(await viewer.tools(), VIEWER_TOOLS);

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
  assert.deepEqual([latest.path, latest.agent, latest.person, latest.source], ["From an agent.md", "Test Agent", "Owner Dev", "Test Agent (via Owner Dev)"]);

  const refused = await viewer.call("create_note", { path: "Nope", content: "x" });
  assert.equal(refused.isError, true);
  assert.equal((await viewer.call("read_note", { path: "From an agent" })).isError, false);

  // Online, its views (notes in Views/) say which the workspace shares and which are just theirs.
  await owner.call("save_smart_folder", { name: "Team plans", query: "tag=plan" });
  const { text } = await owner.call("save_smart_folder", { name: "My plans", query: "tag=plan", just_me: true });
  assert.match(text, /^- Team plans \(\d+ notes?, shared\): tag=plan — Views\/Team plans\.md \[/m);
  assert.match(text, /^- My plans \(\d+ notes?, just you\): tag=plan — Views\/[a-z0-9]+\/My plans\.md \[/m);
  await owner.call("delete_smart_folder", { smart_folder: "Team plans" });
  await owner.call("delete_smart_folder", { smart_folder: "My plans" });
  await Promise.all([owner.client.close(), viewer.client.close()]);
});

test("online, an agent exports Markdown and a .zip; a web page and Word come from the app", async () => {
  const viewer = await mcp((await connect(people.viewer, people.id)).access);
  const raw = async (args: Record<string, unknown>) => (await viewer.client.callTool({ name: "export_note", arguments: args })) as { content: Array<{ text?: string; resource?: { mimeType: string; text?: string; blob?: string } }>; isError?: boolean };
  const md = await raw({ target: "Getting started", format: "md" });
  assert.equal(md.content[1].resource?.mimeType, "text/markdown");
  assert.ok(md.content[1].resource?.text?.includes("# "), "the note's markdown");
  const zip = await raw({ target: "/", format: "zip" });
  const { unzipSync } = await import("fflate");
  const files = Object.keys(unzipSync(new Uint8Array(Buffer.from(zip.content[1].resource!.blob!, "base64"))));
  assert.ok(files.includes("Getting started.md") && files.includes("assets/margin.svg"), `the workspace, with its uploads from R2: ${files}`);
  const word = await raw({ target: "Getting started", format: "docx" });
  assert.equal(word.isError, true);
  assert.match(word.content[0].text!, /drawn by the app: use Share → Export as/);
  await viewer.client.close();
});

test("an agent saves a note to its person's Google Drive once they've allowed it in the app (the stand-in here)", async () => {
  const viewer = await mcp((await connect(people.viewer, people.id, await reusedClient())).access);
  const early = await viewer.call("save_to_drive", { note: "Getting started" });
  assert.deepEqual([early.isError, /Google Drive isn't connected yet/.test(early.text)], [true, true]);
  // The person allows it, the way the app's dialog sends them: Google's (stand-in's) consent page, and back.
  const start = await cloud.request(people.viewer, "GET", "/auth/google/drive?next=/notes&as=doc");
  const both = `${people.viewer}; ${start.headers.getSetCookie().map((c) => c.split(";")[0]).find((c) => c.startsWith("__Host-ci_gcal="))}`;
  const consent = new URL(start.headers.get("location")!);
  const allowed = await cloud.server.fetch(new URL(consent.pathname + consent.search, cloud.origin), { method: "POST", redirect: "manual", headers: { cookie: both, origin: cloud.origin, "content-type": "application/x-www-form-urlencoded" }, body: "decision=allow" });
  const callback = new URL(allowed.headers.get("location")!);
  assert.equal((await cloud.request(both, "GET", callback.pathname + callback.search)).status, 302);
  const doc = await viewer.call("save_to_drive", { note: "Getting started" });
  assert.equal(doc.isError, false, doc.text);
  assert.match(doc.text, /^Saved Getting started\.md to Google Drive as Getting started: http.*\/auth\/google\/drive\/mock\/file\?/);
  assert.match(decodeURIComponent(doc.text), /as=Google\+Doc&from=text\/markdown/, "agents send the note's markdown; Drive converts it");
  const pdf = await viewer.call("save_to_drive", { note: "Getting started", format: "pdf" });
  assert.match(pdf.text, /^Saved Getting started\.md to Google Drive as Getting started\.pdf: /);
  await viewer.client.close();
});

test("an agent lists the workspace's events and makes a meeting note, linked to the event and attributed to it", async () => {
  const cal = await cloud.call(people.owner, "POST", `${people.base}/calendar/sources`, { url: "https://demo.commonink.invalid/agents.ics" });
  const agent = await mcp((await connect(people.editor, people.id)).access);
  const list = await agent.call("list_events", { from: "2026-10-05", days: 1, time_zone: "America/Los_Angeles" });
  const id = list.text.match(/^- Standup · .* · id ([a-z2-9]{12})$/m)?.[1];
  assert.match(list.text, /^1 event, Mon, Oct 5 to Mon, Oct 5 \(America\/Los_Angeles\):\n- Standup · Mon, Oct 5, 2026, 9:30 AM to 9:45 AM PDT · Launch team \(demo\) · id [a-z2-9]{12}$/);
  assert.deepEqual(await agent.call("create_meeting_note", { id, time_zone: "America/Los_Angeles" }), { text: "Created Meetings/2026-10-05 Standup.md, linked to the event", isError: false });
  assert.match((await agent.call("get_event", { id })).text, /^meeting note: Meetings\/2026-10-05 Standup\.md$/m);
  const [latest] = await cloud.call(people.owner, "GET", `${people.base}/changes?limit=1`);
  assert.deepEqual([latest.path, latest.source], ["Meetings/2026-10-05 Standup.md", "Test Agent (via Editor Dev)"]);
  await cloud.call(people.owner, "POST", `${people.base}/calendar/sources/remove`, { id: cal.id });
  await agent.client.close();
});

test("an agent's delete tells open tabs the note is gone, as a delete in the app does", async () => {
  const owner = await mcp((await connect(people.owner, people.id)).access);
  await owner.call("create_note", { path: "Short lived", content: "# Short lived\n" });
  const socket = new WebSocket(`${cloud.origin.replace("http", "ws")}${people.base}/live`, { headers: { cookie: people.owner, origin: cloud.origin } });
  await new Promise((resolve, reject) => (socket.once("open", resolve), socket.once("error", reject)));
  const removed = new Promise<string>((resolve) => socket.on("message", (d) => (JSON.parse(String(d)).type === "removed" ? resolve(JSON.parse(String(d)).path) : undefined)));
  assert.equal((await owner.call("delete_note", { paths: ["Short lived"] })).isError, false);
  const gone = await Promise.race([removed, new Promise((r) => setTimeout(() => r("no removed message"), 2000))]);
  assert.equal(gone, "Short lived.md");
  socket.close();
  await owner.client.close();
});

test("an agent's recent_changes counts a run of saves as History's /diffstats does", async () => {
  const agent = await mcp((await connect(people.owner, people.id)).access);
  await agent.call("create_note", { path: "Churn", content: "# Churn\n\none\ntwo\n" });
  await agent.call("edit_note", { path: "Churn", old_string: "two\n", new_string: "two\nthree\nfour\nfive\nsix\n" });
  await agent.call("edit_note", { path: "Churn", old_string: "one\ntwo\nthree\nfour\nfive\nsix\n", new_string: "ONE\ntwo\nthree\n" });
  await agent.call("edit_note", { path: "Churn", old_string: "three\n", new_string: "three\nfour\n" });
  const [latest, , first] = await cloud.call(people.owner, "GET", `${people.base}/changes?path=Churn.md&limit=3`);
  assert.deepEqual(await cloud.call(people.owner, "GET", `${people.base}/diffstats?sets=${first.id}-${latest.id}`), [{ add: 3, del: 1 }]);
  assert.match((await agent.call("recent_changes", { path: "Churn.md", limit: 3 })).text, /^#\d+ \S+ Test Agent for Owner: edited Churn\.md \(\+3 −1, 3 saves\)$/);
  await agent.client.close();
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

test("an owner changing someone's role or removing them disconnects that person's agents there, and only there", async () => {
  const t = await team(cloud);
  const mine = (await cloud.call(t.editor, "GET", "/api/me")).workspaces.find((w: { kind: string }) => w.kind === "personal");
  const here = await connect(t.editor, t.id);
  const elsewhere = await connect(t.editor, mine.id);
  const editorId = (await cloud.call(t.owner, "GET", `${t.base}/members`)).find((m: { name: string }) => m.name === "Editor Dev").id;
  await cloud.call(t.owner, "POST", `${t.base}/members/role`, { user: editorId, role: "viewer" });
  const status = async (token: string) => (await cloud.server.fetch(new URL("/mcp", cloud.origin), { method: "POST", headers: { Authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: "{}" })).status;
  assert.deepEqual([await status(here.access), await status(elsewhere.access) !== 401], [401, true]);
  const again = await connect(t.editor, t.id);
  await cloud.call(t.owner, "POST", `${t.base}/members/remove`, { user: editorId });
  assert.equal(await status(again.access), 401);
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
    [["Test Agent", "Test Agent for Revoker", "Revoker's notes", "owner", "number"]],
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

test("an agent shares a note as its person, lists who it's shared with, and stops sharing; a viewer's agent can only list", async () => {
  const first = await connect(people.owner, people.id, await reusedClient());
  const owner = await mcp(first.access);
  await owner.call("create_note", { path: "Plan to share", content: "# Plan to share\n" });
  // Until an owner allows it, agents (whatever their role) can't make links, public or editor, or invite an editor by email.
  const REFUSED = { text: "Agents can't share by link or for editing in this workspace. An owner can allow it in the workspace's settings.", isError: true };
  for (const share of [{ link: true, role: "viewer" }, { link: true, role: "editor" }, { email: "guest@example.com", role: "editor" }]) {
    assert.deepEqual(await owner.call("share_note", { path: "Plan to share", ...share }), REFUSED, JSON.stringify(share));
  }
  assert.equal((await owner.call("list_shares", { path: "Plan to share" })).text, "Plan to share.md isn't shared with anyone outside the workspace.");
  const viewing = await owner.call("share_note", { path: "Plan to share", email: "reader@example.com", role: "viewer" });
  assert.match(viewing.text, /- reader@example\.com \(by email\) — viewer/, "a viewer by email needs no setting");
  assert.deepEqual(await cloud.call(people.owner, "GET", `${people.base}/workspace/settings`), { agentLinks: false, gamified: true });
  assert.deepEqual(await cloud.call(people.owner, "POST", `${people.base}/workspace/settings`, { agentLinks: true }), { agentLinks: true, gamified: true });
  const [logged] = await cloud.call(people.owner, "GET", `${people.base}/workspace/log`);
  assert.deepEqual([logged.action, logged.detail], ["settings", "agentLinks: on"]);
  const shared = await owner.call("share_note", { path: "Plan to share", email: "guest@example.com", role: "editor", expires_in_days: 7 });
  assert.match(shared.text, /- guest@example\.com \(by email\) — editor, until \d{4}-\d{2}-\d{2} \(id (\w+)\)/);
  const id = shared.text.match(/guest@example\.com .*\(id (\w+)\)/)![1];
  const linked = await owner.call("share_note", { path: "Plan to share", link: true, role: "viewer" });
  assert.match(linked.text, new RegExp(`- Anyone with the link: ${cloud.origin}/s/[a-f0-9]{64} — viewer`));
  assert.deepEqual(await owner.call("unshare_note", { id }), { text: "Stopped sharing it.", isError: false });
  assert.doesNotMatch((await owner.call("list_shares", { path: "Plan to share" })).text, /guest@example\.com/);
  assert.equal((await owner.call("share_note", { path: "Plan to share", role: "viewer" })).isError, true, "an email or a link is needed");
  const viewer = await mcp((await connect(people.viewer, people.id, first.client)).access);
  const seen = (await viewer.call("list_shares", { path: "Plan to share" })).text;
  assert.deepEqual([/Anyone with the link — viewer/.test(seen), /\/s\//.test(seen)], [true, false], "a viewer sees that a link exists, not its URL");
});

test("an agent's today is its person's day in the time zone their browser reported, else the workspace owner's, else UTC", async () => {
  // UTC+14 and UTC-11 are 25 hours apart, so they're never on the same day.
  const [AHEAD, BEHIND] = ["Pacific/Kiritimati", "Pacific/Pago_Pago"];
  const dayIn = (timeZone: string) => new Intl.DateTimeFormat("en-CA", { timeZone }).format(Date.now());
  const client = await reusedClient();
  const agentOf = async (cookie: string, workspace: string) => {
    const { code, verifier } = await authorizeCode(cookie, workspace, client);
    const { access_token } = (await (await exchange(client, code, verifier)).json()) as { access_token: string };
    const agent = await mcp(access_token);
    return async () => (await agent.call("get_today", {})).text.match(/Journal: Journal\/(\d{4}-\d{2}-\d{2})\.md/)?.[1];
  };

  const loner = await cloud.signIn("loner");
  const { workspaces } = await cloud.call(loner, "GET", "/api/me");
  assert.equal(await (await agentOf(loner, workspaces[0].id))(), dayIn("UTC"));

  const [owner, editor, viewer] = await Promise.all([people.owner, people.editor, people.viewer].map((p) => agentOf(p, people.id)));
  assert.deepEqual(await cloud.call(people.owner, "POST", "/api/me/time-zone", { timeZone: AHEAD }), { timeZone: AHEAD });
  assert.deepEqual(await cloud.call(people.editor, "POST", "/api/me/time-zone", { timeZone: BEHIND }), { timeZone: BEHIND });
  assert.equal(await owner(), dayIn(AHEAD));
  assert.equal(await editor(), dayIn(BEHIND));
  assert.equal(await viewer(), dayIn(AHEAD), "no zone of their own: the owner's");

  const bad = await cloud.request(people.editor, "POST", "/api/me/time-zone", { timeZone: "Mars/Olympus_Mons" });
  assert.equal(bad.status, 400);
  assert.equal(await editor(), dayIn(BEHIND), "a bad zone leaves the last good one");
});
