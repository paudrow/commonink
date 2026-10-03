// The Worker: signs people in, checks what they can open, and forwards workspace requests to that
// workspace's Durable Object. Agents connect over OAuth to /mcp (agents.ts). Everything else is the
// web app, served from the edge as static assets.
import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { json } from "../../src/core/api.ts";
import { assertPublicUrl, unfurl } from "../../src/core/unfurl.ts";
import { MAX_UPLOAD } from "../../src/core/paths.ts";
import { SANDBOX_PATH, sandboxPage } from "../../src/core/sandbox.ts";
import { access, isAccountRoute, LINK_ROUTES, routeKey, SHARED_ROUTES, type AccountRoute } from "./access.ts";
import { memberShareRole, type SharedAccess } from "./grants.ts";
import { grantsFor, joinLink, linkShare, sharedWith } from "./shares.ts";
import { authorize, listAgents, oauthOptions, revokeAgents, withOAuthStore, type OAuthEnv } from "./agents.ts";
import { clearSessionCookies, ensurePersonalWorkspace, escapeHtml, handleAuth, page, readSession, readSessionOf, seedWorkspace, text } from "./auth.ts";
import { adminRoute } from "./admin.ts";
import { deleteAccount, deletionPlan } from "./account.ts";
import { acceptInvite, inviteInfo, createWorkspace, endSessionsOf, locateNote, membership, setTimeZone, workspacesOf, type User } from "./directory.ts";
import { timeZoneNamed } from "../../src/core/tasks.ts";
import type { Env } from "./env.ts";
import { fetchAsset, secure } from "./headers.ts";
import { limit, limited, ROUTE_LIMITS } from "./limits.ts";
import { landingPage } from "./landing.ts";
import { connectionInfo, disconnectGoogle, driveApi, googleApi, googleAuth, googleMode } from "./connections.ts";
import { DRIVE_FORMATS, driveProblem, MAX_DRIVE_BYTES, MIME, saveToDrive, type DriveFormat } from "./drive.ts";

export { Workspace } from "./workspace.ts";

/** The web app, behind the OAuth provider, which answers /mcp and the OAuth endpoints itself. */
const app: ExportedHandler<OAuthEnv> = { fetch: (req, env) => route(req, env, new URL(req.url)) };
const providers = new Map<string, OAuthProvider<OAuthEnv>>();

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    // Anyone may register an OAuth client, so registrations are limited per address.
    if (url.pathname === "/oauth/register" && req.method === "POST") {
      const tooMany = await limit(env.DB, "register", req.headers.get("CF-Connecting-IP") ?? "unknown");
      if (tooMany) return secure(tooMany, url);
    }
    // OAuth needs HTTPS, or plain HTTP on this machine. Anything else gets the app without /mcp.
    if (url.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return secure(await route(req, env, url), url);
    let provider = providers.get(url.origin);
    if (!provider) providers.set(url.origin, (provider = new OAuthProvider(oauthOptions(url.origin, app))));
    return secure(await provider.fetch(req, withOAuthStore(env), ctx), url);
  },
} satisfies ExportedHandler<Env>;

async function route(req: Request, env: Env, url: URL): Promise<Response> {
  if (url.hostname.startsWith("www.")) {
    url.hostname = url.hostname.slice(4);
    return Response.redirect(url.toString(), 301);
  }
  if (url.pathname === SANDBOX_PATH) return sandboxPage();
  if (url.pathname === "/authorize") return authorize(req, env, url);
  if (url.pathname.startsWith("/auth/google/calendar") || url.pathname.startsWith("/auth/google/drive")) return googleAuth(req, env, url);
  if (url.pathname.startsWith("/auth/")) {
    const ip = req.headers.get("CF-Connecting-IP") ?? "unknown";
    const tooMany = url.pathname !== "/auth/logout" && (await limit(env.DB, "signIn", ip, "text"));
    return tooMany || handleAuth(req, env, (user) => ensurePersonalWorkspace(env, user), (s) => disconnect(env, s.user, `s:${s.id}`));
  }
  if (url.pathname.startsWith("/invite/")) return invite(req, env, url);
  if (url.pathname.startsWith("/api/s/")) return shareLink(req, env, url);
  if (url.pathname.startsWith("/api/")) return api(req, env, url);
  if (url.pathname.startsWith("/s/")) {
    // A shared link's page: not for search engines, and its token stays out of Referer.
    const res = await fetchAsset(env.ASSETS, req, url);
    const page = new Response(res.body, res);
    page.headers.set("X-Robots-Tag", "noindex, nofollow");
    page.headers.set("Referrer-Policy", "no-referrer");
    return page;
  }
  // A share the service worker didn't catch (it wasn't set up yet): the capture screen says so.
  if (url.pathname === "/share" && req.method === "POST") return Response.redirect(new URL("/capture?share=none", url).href, 303);
  // The front page: what Common Ink is, for anyone not signed in; the app for everyone who is.
  if (url.pathname === "/" && (req.method === "GET" || req.method === "HEAD") && !(await readSessionOf(req, env))) return landingPage(url, env.DEV_LOGIN === "1");
  return fetchAsset(env.ASSETS, req, url);
}

/** A request's JSON body as an object; anything else (empty, malformed, a list) counts as {}. */
async function body(req: Request): Promise<Record<string, unknown>> {
  const data = await req.json().catch(() => null);
  return data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
}

interface Call {
  req: Request;
  env: Env;
  url: URL;
  user: User;
}

/** What someone signed in can do outside any one workspace. */
const ACCOUNT: Record<AccountRoute, (c: Call) => Promise<Response>> = {
  "GET /api/me": async ({ env, user }) => json({ user, workspaces: await workspacesOf(env.DB, user.id) }),
  // The app reports the browser's time zone on every load, so an agent's "today" is its person's.
  "POST /api/me/time-zone": async ({ req, env, user }) => {
    const { timeZone } = (await body(req)) as { timeZone?: unknown };
    const zone = typeof timeZone === "string" && timeZone.length <= 64 ? timeZoneNamed(timeZone) : null;
    if (!zone) return json({ error: '"timeZone" must be an IANA time zone, like America/Chicago' }, 400);
    await setTimeZone(env.DB, user.id, zone);
    return json({ timeZone: zone });
  },
  "POST /api/workspaces": async ({ req, env, user }) => {
    const tooMany = await limit(env.DB, "workspace", user.id);
    if (tooMany) return tooMany;
    const { name } = (await body(req)) as { name?: unknown };
    const clean = (typeof name === "string" ? name : "").trim().slice(0, 80);
    if (!clean) return json({ error: "Give the workspace a name" }, 400);
    const id = await createWorkspace(env.DB, user, clean, "team");
    await seedWorkspace(env, id);
    return json({ id });
  },
  "GET /api/unfurl": async ({ env, url, user }) => {
    const target = url.searchParams.get("url") ?? "";
    if (!/^https?:\/\//i.test(target)) return json({ error: "http(s) URLs only" }, 400);
    const tooMany = await limit(env.DB, "unfurl", user.id);
    if (tooMany) return tooMany;
    // Public hosts on default ports, and never this app (it would fetch itself).
    return json(
      await unfurl(target, (u) => {
        assertPublicUrl(u);
        if (u.hostname.replace(/\.$/, "") === url.hostname) throw new Error("self"); // "commonink.app." too
      }, { githubToken: env.GITHUB_TOKEN || undefined }),
    );
  },
  "GET /api/note-ids/*": async ({ env, url, user }) => {
    const noteId = url.pathname.match(/^\/api\/note-ids\/([a-z2-9]{8})$/)?.[1];
    const ws = noteId && (await locateNote(env.DB, user.id, noteId));
    return ws ? json({ workspace: ws }) : json({ error: "That note doesn't exist, or you don't have access to it" }, 404);
  },
  "GET /api/agents": async ({ env, url, user }) => json(await listAgents(env, url, user)),
  // "Shared with me": notes other workspaces share with you, each workspace's by title.
  "GET /api/shared": async ({ env, user }) =>
    json(
      await Promise.all(
        (await sharedWith(env.DB, user)).map(async ({ workspace, grants }) => ({
          workspace,
          notes: await env.WORKSPACE.get(env.WORKSPACE.idFromName(workspace.id)).sharedList({ grants, write: true }),
        })),
      ),
    ),
  // Google Calendar (connections.ts): whether it's on here, and the person's connection. Never a token.
  "GET /api/google": async ({ env, user }) => json({ mode: googleMode(env), connection: await connectionInfo(env, user.id) }),
  "GET /api/google/calendars": async ({ env, user }) => {
    const tooMany = await limit(env.DB, "calendar", user.id);
    if (tooMany) return tooMany;
    if (!(await connectionInfo(env, user.id))?.calendar) return json({ error: "Connect Google Calendar first" }, 409);
    try {
      return json(await googleApi(env, user.id).calendars());
    } catch (e) {
      return json({ error: e instanceof Error ? e.message.replace(/^feed:/, "") : "Couldn't reach Google Calendar" }, 502);
    }
  },
  // Save a note to the person's Google Drive (drive.ts): the app sends it as Word (its static render)
  // or markdown, `as` says what it becomes there, and `title` names it. It's their own Drive, so no
  // workspace is involved: what's sent is what the app already showed them.
  "POST /api/google/drive": async ({ req, env, url, user }) => {
    if (googleMode(env) === "off") return json({ error: "Google isn't configured on this server" }, 503);
    const tooMany = await limit(env.DB, "drive", user.id);
    if (tooMany) return tooMany;
    const as = url.searchParams.get("as") ?? "doc";
    if (!(DRIVE_FORMATS as readonly string[]).includes(as)) return json({ error: `"as" must be one of ${DRIVE_FORMATS.join(", ")}` }, 400);
    if (!(await connectionInfo(env, user.id))?.drive) return json({ error: "Allow Common Ink to save to your Google Drive first", connect: true }, 409);
    const type = String(req.headers.get("Content-Type")).split(";")[0].trim().toLowerCase();
    const kind = type === MIME.docx ? "docx" : type === MIME.md ? "md" : null;
    if (!kind) return json({ error: "Send the note as Word (.docx) or markdown" }, 415);
    const data = new Uint8Array(await req.arrayBuffer());
    if (!data.byteLength) return json({ error: "That note is empty" }, 400);
    if (data.byteLength > MAX_DRIVE_BYTES) return json({ error: "That note is over 50 MB with its pictures: Google Drive won't convert it" }, 413);
    if (as === "md" && kind !== "md") return json({ error: "A markdown file needs the note's markdown" }, 400);
    try {
      return json(await saveToDrive(driveApi(env, user.id, url.origin), { title: url.searchParams.get("title") ?? "", type: kind, data }, as as DriveFormat));
    } catch (e) {
      const error = driveProblem(e);
      return json({ error, connect: /^Allow Common Ink|connect/i.test(error) }, 502);
    }
  },
  // Google forgets the grant, the connection goes, and so do this person's Google calendars in every workspace.
  "POST /api/google/disconnect": async ({ env, user }) => {
    await disconnectGoogle(env, user.id);
    await Promise.all((await workspacesOf(env.DB, user.id)).map((w) => env.WORKSPACE.get(env.WORKSPACE.idFromName(w.id)).dropCalendarsOf(user.id, "google")));
    return json({ ok: true });
  },
  "POST /api/agents/revoke": async ({ req, env, url, user }) => {
    const { id } = (await body(req)) as { id?: unknown };
    if (typeof id !== "string") return json({ error: '"id" must be a string' }, 400);
    await revokeAgents(env, url, user, id);
    return json({ ok: true });
  },
  // Every session ends, every open tab's live connection closes (which sends it to sign-in), and
  // every connected agent is disconnected: a stolen session could have connected one.
  "POST /api/sign-out-everywhere": async ({ env, url, user }) => {
    await endSessionsOf(env.DB, user.id);
    await revokeAgents(env, url, user, "all");
    await disconnect(env, user, user.id);
    const res = json({ ok: true });
    for (const c of clearSessionCookies()) res.headers.append("Set-Cookie", c);
    return res;
  },
  // Deleting your account (account.ts): what it would take with it, and doing it, once you type your email.
  "GET /api/me/delete": async ({ env, user }) => json(await deletionPlan(env, user)),
  "POST /api/me/delete": async ({ req, env, url, user }) => {
    const { confirm } = (await body(req)) as { confirm?: unknown };
    if (typeof confirm !== "string" || confirm.trim().toLowerCase() !== user.email.toLowerCase()) {
      return json({ error: `Type your email, ${user.email}, to delete your account` }, 400);
    }
    const plan = await deleteAccount(env, url, user, () => disconnect(env, user, user.id));
    if (!plan) {
      const { blocked } = await deletionPlan(env, user);
      return json({ error: `You're the only owner of ${blocked.map((w) => w.name).join(", ")}. Make someone else an owner first, or delete ${blocked.length === 1 ? "it" : "them"}.`, blocked }, 409);
    }
    const res = json({ ok: true, ...plan });
    for (const c of clearSessionCookies()) res.headers.append("Set-Cookie", c);
    return res;
  },
};

/** Close live connections tagged `tag` (a person, or one of their sessions) in each workspace they're in or that shares with them. */
async function disconnect(env: Env, user: User, tag: string) {
  const ids = new Set([...(await workspacesOf(env.DB, user.id)).map((w) => w.id), ...(await sharedWith(env.DB, user)).map((s) => s.workspace.id)]);
  await Promise.all([...ids].map((id) => env.WORKSPACE.get(env.WORKSPACE.idFromName(id)).disconnect(tag)));
}

async function api(req: Request, env: Env, url: URL): Promise<Response> {
  const session = await readSessionOf(req, env);
  if (!session) return json({ error: "Sign in first", devLogin: env.DEV_LOGIN === "1" }, 401);
  const { user } = session;

  // Cookies ride along on any request to us, so writes must come from our own pages.
  const isWrite = req.method !== "GET" && req.method !== "HEAD";
  const upgrade = req.headers.get("Upgrade") === "websocket";
  if ((isWrite || upgrade) && req.headers.get("Origin") !== url.origin) return json({ error: "Cross-origin request refused" }, 403);
  // Uploads and a note on its way to Drive are raw bytes; everything else that writes must be JSON.
  const isUpload = req.method === "POST" && /^\/api\/w\/[a-z0-9]+\/upload$/.test(url.pathname);
  const isDrive = req.method === "POST" && url.pathname === "/api/google/drive";
  if (isUpload && Number(req.headers.get("Content-Length") ?? 0) > MAX_UPLOAD) return json({ error: "That file is over 50 MB" }, 413);
  if (isDrive && Number(req.headers.get("Content-Length") ?? 0) > MAX_DRIVE_BYTES) return json({ error: "That note is over 50 MB with its pictures: Google Drive won't convert it" }, 413);
  if (isWrite && !isUpload && !isDrive && !String(req.headers.get("Content-Type")).startsWith("application/json")) return json({ error: "JSON only" }, 415);

  const key = routeKey(req.method, url.pathname);
  if (isAccountRoute(key)) return ACCOUNT[key]({ req, env, url, user });

  const m = url.pathname.match(/^\/api\/w\/([a-z0-9]+)(\/.*)$/);
  if (!m) return json({ error: "Not found" }, 404);
  const [, wsId, route] = m;
  if (route.startsWith("/shared/")) return shared(req, env, url, user, session, wsId, route);
  const ws = await membership(env.DB, user.id, wsId);
  if (!ws) return json({ error: "Not found" }, 404);
  const allowed = access(ws.role, req.method, route);
  if (allowed === "unknown") return json({ error: "Not found" }, 404);
  if (allowed === "forbidden") {
    return json({ error: ws.role === "viewer" ? "You can view this workspace but not edit it" : "Only the workspace's owner can do that" }, 403);
  }

  // The workspace's own settings (members, invites, name) live in D1, so they're answered here.
  const settings = await adminRoute(req, env, url, user, ws, route, () => body(req));
  if (settings) return settings;

  const limited = ROUTE_LIMITS[`${req.method} ${route}`];
  if (limited) {
    const tooMany = await limit(env.DB, limited, user.id);
    if (tooMany) return tooMany;
  }

  // Forward to the workspace. Only this Worker can reach it, so these headers can be trusted there;
  // any the client sent are dropped first.
  const headers = new Headers([...req.headers].filter(([k]) => !k.toLowerCase().startsWith("x-ci-")));
  headers.set("x-ci-workspace", ws.id);
  headers.set("x-ci-workspace-name", encodeURIComponent(ws.name));
  headers.set("x-ci-actor", encodeURIComponent(user.name));
  headers.set("x-ci-user", user.id);
  headers.set("x-ci-role", ws.role);
  headers.set("x-ci-session", session.id);
  headers.set("x-ci-session-expires", String(session.expiresAt));
  headers.set("x-ci-origin", url.origin);
  const inner = new Request(`https://workspace${route}${url.search}`, { method: req.method, headers, body: isWrite ? req.body : undefined, redirect: "manual" });
  return env.WORKSPACE.get(env.WORKSPACE.idFromName(ws.id)).fetch(inner);
}

/** What a signed-in person may see of a workspace through what's shared: everything, for a member. */
async function shared(req: Request, env: Env, url: URL, user: User, session: { id: string; expiresAt: number }, wsId: string, route: string) {
  if (!SHARED_ROUTES.includes(routeKey(req.method, route) as (typeof SHARED_ROUTES)[number])) return json({ error: "Not found" }, 404);
  const ws = await membership(env.DB, user.id, wsId);
  const grants = ws ? [] : await grantsFor(env.DB, wsId, user);
  if (!ws && !grants.length) return json({ error: "Not found" }, 404);
  const access: SharedAccess = ws ? { member: memberShareRole(ws.role) } : { grants, write: true };
  const headers = forwardHeaders(req, wsId, access, `/api/w/${wsId}/shared`);
  headers.set("x-ci-actor", encodeURIComponent(user.name));
  headers.set("x-ci-user", user.id);
  headers.set("x-ci-session", session.id);
  headers.set("x-ci-session-expires", String(session.expiresAt));
  return toWorkspace(env, req, wsId, route, url, headers);
}

/**
 * A shared link, `/api/s/<token>/…`: no sign-in needed to read what it shares, and nothing else of
 * its workspace. Lookups that find no live link are limited per address, so tokens can't be guessed
 * by volume (they're 256 bits anyway); a working link's page makes many requests, and none count.
 * Signed in, `join` keeps it in your Shared with me, with the link's role.
 */
async function shareLink(req: Request, env: Env, url: URL): Promise<Response> {
  const [, , , token = "", ...rest] = url.pathname.split("/");
  const route = `/${rest.join("/")}`;
  const ip = req.headers.get("CF-Connecting-IP") ?? "unknown";
  // Past the limit, every link is refused, so a right guess reads the same as a wrong one.
  const tooMany = await limited(env.DB, "shareLink", ip);
  if (tooMany) return tooMany;
  const share = await linkShare(env.DB, token);
  if (!share) return (await limit(env.DB, "shareLink", ip)) ?? json({ error: "This link doesn't work any more, or never did" }, 404);
  if (route === "/join" && req.method === "POST") {
    const session = await readSessionOf(req, env);
    if (!session) return json({ error: "Sign in first", devLogin: env.DEV_LOGIN === "1" }, 401);
    if (req.headers.get("Origin") !== url.origin) return json({ error: "Cross-origin request refused" }, 403);
    await joinLink(env.DB, share, session.user.id);
    return json({ workspace: share.workspaceId, note: share.note, folder: share.folder });
  }
  if (!LINK_ROUTES.includes(routeKey(req.method, route) as (typeof LINK_ROUTES)[number])) return json({ error: "Not found" }, 404);
  const headers = forwardHeaders(req, share.workspaceId, { grants: [share], write: false }, `/api/s/${token}`);
  const res = await toWorkspace(env, req, share.workspaceId, `/shared${route}`, url, headers);
  const out = new Response(res.body, res);
  out.headers.set("X-Robots-Tag", "noindex, nofollow");
  out.headers.set("Referrer-Policy", "no-referrer"); // the token is in the URL
  return out;
}

/** Headers for a request into a workspace's shared routes; any the client sent are dropped first. */
function forwardHeaders(req: Request, wsId: string, access: SharedAccess, base: string) {
  const headers = new Headers([...req.headers].filter(([k]) => !k.toLowerCase().startsWith("x-ci-")));
  headers.set("x-ci-workspace", wsId);
  headers.set("x-ci-share", JSON.stringify(access));
  headers.set("x-ci-base", base);
  return headers;
}

function toWorkspace(env: Env, req: Request, wsId: string, route: string, url: URL, headers: Headers) {
  const isWrite = req.method !== "GET" && req.method !== "HEAD";
  const inner = new Request(`https://workspace${route.startsWith("/shared/") ? route : `/shared${route}`}${url.search}`, { method: req.method, headers, body: isWrite ? req.body : undefined, redirect: "manual" });
  return env.WORKSPACE.get(env.WORKSPACE.idFromName(wsId)).fetch(inner);
}

/**
 * An invite link: opening it asks, and only a POST from our own page joins. A GET that joined could
 * be fired by an image in someone's note.
 */
async function invite(req: Request, env: Env, url: URL): Promise<Response> {
  const user = await readSession(req, env);
  if (!user) return Response.redirect(`${url.origin}/auth/${env.DEV_LOGIN === "1" ? "dev" : "google"}?next=${encodeURIComponent(url.pathname)}`, 302);
  const token = url.pathname.split("/")[2] ?? "";
  const gone = () => text(410, "This invite link has been used, has expired or isn't valid. Ask for a new one.");
  if (req.method === "POST") {
    if (req.headers.get("Origin") !== url.origin) return text(403, "Cross-origin request refused");
    const wsId = await acceptInvite(env.DB, token, user.id);
    return wsId ? Response.redirect(`${url.origin}/?w=${wsId}`, 302) : gone();
  }
  const inv = await inviteInfo(env.DB, token);
  if (!inv) return gone();
  return page(
    200,
    `<h1>Join ${escapeHtml(inv.workspaceName)}?</h1>
     <p class="muted">You're signed in as ${escapeHtml(user.email)}. You'll be able to ${inv.role === "viewer" ? "read its notes" : "read and edit its notes"}.</p>
     <form method="post"><button type="submit">Join ${escapeHtml(inv.workspaceName)}</button></form>`,
  );
}
