// Remote MCP: agents such as Claude and Cursor connect to /mcp with OAuth 2.1 (dynamic client
// registration, PKCE), and act as the person who connected them, in the one workspace they picked,
// with that person's role in it right now. @cloudflare/workers-oauth-provider runs the protocol; its
// records live in D1 (oauth-store.ts). This file has the consent page, the MCP handler, and the
// "Connected agents" list.
import { AuthorizationError, getOAuthApi, type ConsentDescription, type GrantSummary, type OAuthHelpers, type OAuthProviderOptions } from "@cloudflare/workers-oauth-provider";
import { json } from "../../src/core/api.ts";
import { escapeHtml, page, readSession, text } from "./auth.ts";
import { getUser, membership, workspacesOf, type User, type WorkspaceRef } from "./directory.ts";
import type { Env } from "./env.ts";
import { D1Kv } from "./oauth-store.ts";

/** What a grant carries: who connected, to which workspace, and the client's name. */
export interface AgentProps {
  userId: string;
  workspaceId: string;
  client: string;
}

export type OAuthEnv = Env & { OAUTH_KV: KVNamespace };
export const withOAuthStore = (env: Env): OAuthEnv => ({ ...env, OAUTH_KV: new D1Kv(env.DB) as unknown as KVNamespace });

/** How the provider is set up for this origin (production, a Preview, or local). */
export function oauthOptions(origin: string, app: ExportedHandler<OAuthEnv>): OAuthProviderOptions<OAuthEnv> {
  return {
    apiRoute: "/mcp",
    apiHandler: { fetch: (req, env, ctx) => serveMcp(req, env, ctx as ExecutionContext<AgentProps> & { auth: { token: string } }) },
    defaultHandler: app,
    authorizeEndpoint: "/authorize",
    tokenEndpoint: "/oauth/token",
    clientRegistrationEndpoint: "/oauth/register",
    accessTokenTTL: 3600,
    // Cursor registers cursor://… next to its loopback address, and may use either.
    allowPrivateUseRedirectUris: true,
    resourceMetadata: { resource: `${origin}/mcp`, resource_name: "Common Ink" },
  };
}

/** The provider's helpers (consent, grants), for code that runs outside its own routing. */
const oauthApi = (env: Env, url: URL) => getOAuthApi(oauthOptions(url.origin, { fetch: () => new Response(null, { status: 404 }) }), withOAuthStore(env));

/** "Claude (via Audrow)": how an agent's changes appear in the change log. */
export const agentActor = (client: string, user: Pick<User, "name">) => `${client} (via ${user.name.split(" ")[0]})`;

/** A client names itself when it registers, so keep that name short and printable. */
const clientName = (name: string | undefined) => (name ?? "").replace(/[\x00-\x1f\x7f()]/g, "").trim().slice(0, 40) || "An agent";

// ------------------------------------------------------------------ MCP

/**
 * An MCP request with a valid token. The person must still be a member of the workspace; their
 * role now decides which tools the workspace offers (see TOOL_ROUTES in src/core/tools.ts).
 */
async function serveMcp(req: Request, env: OAuthEnv, ctx: ExecutionContext<AgentProps> & { auth: { token: string } }) {
  const { userId, workspaceId, client } = ctx.props;
  const [user, ws] = await Promise.all([getUser(env.DB, userId), membership(env.DB, userId, workspaceId)]);
  if (!user || !ws) return json({ error: "The person who connected this agent is no longer in that workspace" }, 403);
  // Tokens are "<user>:<grant>:<secret>". Last use is kept to the minute, to save a write per call.
  const grantId = ctx.auth.token.split(":")[1];
  const now = Date.now();
  ctx.waitUntil(
    env.DB.prepare("INSERT INTO agent_use(grant_id, used_at) VALUES (?, ?) ON CONFLICT(grant_id) DO UPDATE SET used_at = excluded.used_at WHERE used_at < ?")
      .bind(grantId, now, now - 60_000)
      .run(),
  );
  const stub = env.WORKSPACE.get(env.WORKSPACE.idFromName(ws.id));
  return stub.mcp(req, { workspace: ws.id, user: user.id, actor: agentActor(client, user), role: ws.role });
}

// ------------------------------------------------------------------ consent

/** GET shows the consent page; POST is the answer. */
export async function authorize(req: Request, env: Env, url: URL): Promise<Response> {
  const user = await readSession(req, env);
  if (!user) return Response.redirect(`${url.origin}/auth/${env.DEV_LOGIN === "1" ? "dev" : "google"}?next=${encodeURIComponent(url.pathname + url.search)}`, 302);
  const oauth = oauthApi(env, url);
  try {
    if (req.method === "POST") {
      if (req.headers.get("Origin") !== url.origin) return text(403, "Cross-origin request refused");
      const form = await req.formData();
      const handle = String(form.get("handle") ?? "");
      if (form.get("decision") !== "allow") {
        const denied = await oauth.denyConsent(req, handle);
        return new Response(null, { status: 302, headers: denied.headers });
      }
      const ws = await membership(env.DB, user.id, String(form.get("workspace") ?? ""));
      if (!ws) return text(400, "Pick one of your workspaces, then try again.");
      const approved = await oauth.approveConsent(req, handle);
      const client = clientName((await oauth.lookupClient(approved.request.clientId))?.clientName);
      // Connecting again to the same workspace replaces that connection; other workspaces keep theirs.
      for (const g of await grantsOf(oauth, user.id)) {
        if (g.clientId === approved.request.clientId && g.metadata?.workspaceId === ws.id) await oauth.revokeGrant(g.id, user.id);
      }
      const { redirectTo } = await oauth.completeAuthorization({
        revokeExistingGrants: false,
        request: approved.request,
        userId: user.id,
        metadata: { client, workspaceId: ws.id },
        scope: approved.request.scope,
        props: { userId: user.id, workspaceId: ws.id, client } satisfies AgentProps,
      });
      approved.headers.set("Location", redirectTo);
      return new Response(null, { status: 302, headers: approved.headers });
    }
    const request = await oauth.parseAuthRequest(req);
    const details = await oauth.describeConsent(request);
    const consent = await oauth.beginConsent(request);
    const res = consentPage(details, consent.handle, user, await workspacesOf(env.DB, user.id));
    for (const [k, v] of consent.headers) if (k.toLowerCase() === "set-cookie") res.headers.append(k, v);
    return res;
  } catch (e) {
    if (e instanceof AuthorizationError && e.redirectTo) return Response.redirect(e.redirectTo, 302);
    if (e instanceof AuthorizationError) return text(400, `${e.description} Start connecting from your app again.`);
    throw e;
  }
}

const CAN: Record<WorkspaceRef["role"], string> = {
  owner: "read and edit notes",
  editor: "read and edit notes",
  viewer: "read notes, and star them for you",
};

function consentPage(details: ConsentDescription, handle: string, user: User, workspaces: WorkspaceRef[]) {
  const name = escapeHtml(clientName(details.clientName));
  const choices = workspaces
    .map(
      (w, i) => `<label class="ws"><input type="radio" name="workspace" value="${escapeHtml(w.id)}"${i === 0 ? " checked" : ""}>
        <span><strong>${escapeHtml(w.name)}</strong><br><span class="muted">You're ${w.role === "owner" ? "the owner" : `a${w.role === "editor" ? "n" : ""} ${w.role}`}: it can ${CAN[w.role]}.</span></span></label>`,
    )
    .join("");
  const res = page(
    200,
    `<style>
       .ws { display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border: 1px solid var(--line); border-radius: 10px; margin: 0 0 8px; cursor: pointer; }
       .ws input { width: auto; height: auto; margin-top: 5px; }
       .row { display: flex; gap: 10px; } .row button { flex: 1; } .row button.no { background: transparent; color: var(--ink); border: 1px solid var(--line); }
     </style>
     <h1>Connect ${name} to Common Ink?</h1>
     <p>${name} will work in your notes as you, ${escapeHtml(user.name)}. Its changes show in History as <strong>${escapeHtml(agentActor(clientName(details.clientName), user))}</strong>.</p>
     <p class="muted">Access goes to <strong>${escapeHtml(details.redirectHost)}</strong>. ${
       details.redirectIsLoopback ? "That's an app on your computer: continue only if you just started connecting from it. " : ""
     }${details.clientDomain ? `Published by ${escapeHtml(details.clientDomain)}.` : "The app named itself, so its name isn't verified."}</p>
     <form method="post" action="/authorize">
       <input type="hidden" name="handle" value="${escapeHtml(handle)}">
       <p>Which workspace?</p>
       ${choices}
       <div class="row"><button type="submit" name="decision" value="deny" class="no">Deny</button><button type="submit" name="decision" value="allow">Allow</button></div>
     </form>
     <p class="muted" style="margin-top:14px">You can disconnect it any time from Connected agents in your account menu.</p>`,
  );
  // No scripts at all on this page, and nobody may frame it.
  res.headers.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'");
  return res;
}

// ------------------------------------------------------------------ connected agents

export interface ConnectedAgent {
  id: string;
  client: string;
  /** How its changes are attributed in the change log. */
  actor: string;
  workspace: { id: string; name: string; role: WorkspaceRef["role"] } | null;
  connectedAt: number;
  usedAt: number | null;
}

async function grantsOf(oauth: OAuthHelpers, userId: string) {
  const grants: GrantSummary[] = [];
  let cursor: string | undefined;
  do {
    const page = await oauth.listUserGrants(userId, { cursor });
    grants.push(...page.items);
    cursor = page.cursor;
  } while (cursor);
  return grants;
}

export async function listAgents(env: Env, url: URL, user: User): Promise<ConnectedAgent[]> {
  const grants = await grantsOf(oauthApi(env, url), user.id);
  if (!grants.length) return [];
  const workspaces = new Map((await workspacesOf(env.DB, user.id)).map((w) => [w.id, w]));
  const used = new Map<string, number>();
  // D1 takes at most 100 parameters per query.
  for (let i = 0; i < grants.length; i += 100) {
    const ids = grants.slice(i, i + 100).map((g) => g.id);
    const { results } = await env.DB.prepare(`SELECT grant_id, used_at FROM agent_use WHERE grant_id IN (${ids.map(() => "?").join(",")})`)
      .bind(...ids)
      .all<{ grant_id: string; used_at: number }>();
    for (const r of results) used.set(r.grant_id, r.used_at);
  }
  return grants
    .map((g) => {
      const ws = workspaces.get(g.metadata?.workspaceId);
      const client = clientName(g.metadata?.client);
      return {
        id: g.id,
        client,
        actor: agentActor(client, user),
        workspace: ws ? { id: ws.id, name: ws.name, role: ws.role } : null,
        connectedAt: g.createdAt * 1000,
        usedAt: used.get(g.id) ?? null,
      };
    })
    .sort((a, b) => (b.usedAt ?? b.connectedAt) - (a.usedAt ?? a.connectedAt));
}

/** Disconnect agents (one, or all of them): their tokens stop working with the next request. */
export async function revokeAgents(env: Env, url: URL, user: User, which: string | "all") {
  const oauth = oauthApi(env, url);
  for (const g of await grantsOf(oauth, user.id)) {
    if (which !== "all" && g.id !== which) continue;
    await oauth.revokeGrant(g.id, user.id);
    await env.DB.prepare("DELETE FROM agent_use WHERE grant_id = ?").bind(g.id).run();
  }
}
