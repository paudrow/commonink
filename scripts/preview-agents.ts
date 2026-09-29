// Give a pull request Preview some changes made by AI, so History's People · AI filters and the
// "<Agent> for <Person>" labels have something to show without connecting a real agent. It connects
// "Claude" and "Cursor" the way any MCP client does (registration, the consent page, a code for
// tokens) and has each make a few edits over MCP. No Preview-only server route: everything goes
// through the same doors a real agent uses, signed in as the Preview's developer (/auth/dev).
//
//   node --import tsx scripts/preview-agents.ts <preview-url>
//
// Safe to run on every deploy: once the workspace has changes from both agents it does nothing.
import { createHash, randomBytes } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const origin = new URL(process.argv[2] ?? "").origin;
const REDIRECT = "http://127.0.0.1:9/callback";
const b64url = (b: Buffer) => b.toString("base64url");

const cookie = await signIn();
const me = (await get("/api/me")) as { workspaces: Array<{ id: string; kind: string }> };
const ws = me.workspaces.find((w) => w.kind === "personal") ?? me.workspaces[0];
const done = (await get(`/api/w/${ws.id}/changes/agents`)) as string[];

if (!done.includes("Claude")) {
  await asAgent("Claude", async (call) => {
    await call("append_to_note", { path: "Common Ink roadmap", text: "- [ ] Show which changes an agent made, and for whom" });
    await call("create_note", {
      path: "Ideas/Agent handoff.md",
      content: "# Agent handoff\n\nWhat an agent leaves for the next one: what it changed, why, and what's still open.\n\n- Link the notes it touched\n- Say what it didn't finish\n",
    });
    await call("append_to_note", { path: "Q4 plan", text: "- Filter History to people or to AI" });
  });
}
if (!done.includes("Cursor")) {
  await asAgent("Cursor", async (call) => {
    await call("append_to_note", { path: "Agent handoff", text: "- Leave the tests it ran" });
  });
}
console.log(`Agent changes in ${origin} (workspace ${ws.id})`);

async function signIn(): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${origin}/auth/dev?next=/`, { redirect: "manual" });
    const session = res.headers.getSetCookie().map((c) => c.split(";")[0]).find((c) => !c.endsWith("="));
    if (session) return session;
    if (res.status < 500 || attempt === 6) throw new Error(`Developer sign-in failed at ${origin} (${res.status}). Is DEV_LOGIN on for Previews?`);
    await new Promise((r) => setTimeout(r, attempt * 3000));
  }
}

/**
 * Just after a deploy, the workspace's Durable Object can run the code from before it for a few
 * seconds, and that doesn't know newer routes (a 404). Waiting for the new code also keeps the
 * agents' edits from being recorded by the old code.
 */
async function get(route: string) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(origin + route, { headers: { cookie } });
    if (res.ok) return res.json();
    if ((res.status !== 404 && res.status < 500) || attempt === 8) throw new Error(`GET ${route} → ${res.status}`);
    await new Promise((r) => setTimeout(r, attempt * 3000));
  }
}

/** Connect an MCP client named `name` to this workspace, as the developer, and let it work. */
async function asAgent(name: string, work: (call: (tool: string, args: Record<string, unknown>) => Promise<void>) => Promise<void>) {
  const reg = await fetch(`${origin}/oauth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: name, redirect_uris: [REDIRECT], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"] }),
  });
  if (reg.status !== 201) throw new Error(`Registering ${name} → ${reg.status}`);
  const client = ((await reg.json()) as { client_id: string }).client_id;

  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const query = new URLSearchParams({ response_type: "code", client_id: client, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: "S256", state: "preview", resource: `${origin}/mcp` });
  const page = await fetch(`${origin}/authorize?${query}`, { headers: { cookie } });
  const handle = (await page.text()).match(/name="handle" value="([^"]+)"/)?.[1];
  if (!handle) throw new Error(`No consent form for ${name} (${page.status})`);
  const binding = page.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  const answer = await fetch(`${origin}/authorize`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: `${cookie}; ${binding}`, origin },
    body: new URLSearchParams({ handle, decision: "allow", workspace: ws.id }),
  });
  const code = new URL(answer.headers.get("location") ?? "about:blank").searchParams.get("code");
  if (!code) throw new Error(`Consent for ${name} → ${answer.status}`);

  const tokens = await fetch(`${origin}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: client, code_verifier: verifier, resource: `${origin}/mcp` }),
  });
  if (!tokens.ok) throw new Error(`Tokens for ${name} → ${tokens.status}`);
  const { access_token } = (await tokens.json()) as { access_token: string };

  const mcp = new Client({ name, version: "1.0.0" });
  await mcp.connect(new StreamableHTTPClientTransport(new URL("/mcp", origin), { requestInit: { headers: { Authorization: `Bearer ${access_token}` } } }));
  try {
    await work(async (tool, args) => {
      const r = (await mcp.callTool({ name: tool, arguments: args })) as { content: Array<{ text: string }>; isError?: boolean };
      if (r.isError) throw new Error(`${name} ${tool} → ${r.content.map((c) => c.text).join(" ")}`);
    });
  } finally {
    await mcp.close();
  }
}
