// The Worker: signs people in, checks what they can open, and forwards workspace requests to that
// workspace's Durable Object. Everything else is the web app, served from the edge as static assets.
import { json } from "../../src/core/api.ts";
import { unfurl } from "../../src/core/unfurl.ts";
import { MAX_UPLOAD } from "../../src/core/paths.ts";
import { SANDBOX_PATH, sandboxPage } from "../../src/core/sandbox.ts";
import { access, isAccountRoute, routeKey, type AccountRoute } from "./access.ts";
import { clearSessionCookies, ensurePersonalWorkspace, handleAuth, readSession, seedWorkspace } from "./auth.ts";
import { acceptInvite, createInvite, createWorkspace, endSessionsOf, locateNote, membership, workspacesOf, type User } from "./directory.ts";
import type { Env } from "./env.ts";
import { fetchAsset, secure } from "./headers.ts";

export { Workspace } from "./workspace.ts";

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    return secure(await route(req, env, url), url);
  },
} satisfies ExportedHandler<Env>;

async function route(req: Request, env: Env, url: URL): Promise<Response> {
  if (url.hostname.startsWith("www.")) {
    url.hostname = url.hostname.slice(4);
    return Response.redirect(url.toString(), 301);
  }
  if (url.pathname === SANDBOX_PATH) return sandboxPage();
  if (url.pathname.startsWith("/auth/")) return handleAuth(req, env, (user) => ensurePersonalWorkspace(env, user));
  if (url.pathname.startsWith("/invite/")) return invite(req, env, url);
  if (url.pathname.startsWith("/api/")) return api(req, env, url);
  return fetchAsset(env.ASSETS, req, url);
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
  "POST /api/workspaces": async ({ req, env, user }) => {
    const { name } = (await req.json()) as { name?: string };
    const clean = String(name ?? "").trim().slice(0, 80);
    if (!clean) return json({ error: "Give the workspace a name" }, 400);
    const id = await createWorkspace(env.DB, user, clean, "team");
    await seedWorkspace(env, id);
    return json({ id });
  },
  "GET /api/unfurl": async ({ url }) => {
    const target = url.searchParams.get("url") ?? "";
    if (!/^https?:\/\//i.test(target)) return json({ error: "http(s) URLs only" }, 400);
    return json(await unfurl(target));
  },
  "GET /api/note-ids/*": async ({ env, url, user }) => {
    const noteId = url.pathname.match(/^\/api\/note-ids\/([a-z2-9]{8})$/)?.[1];
    const ws = noteId && (await locateNote(env.DB, user.id, noteId));
    return ws ? json({ workspace: ws }) : json({ error: "That note doesn't exist, or you don't have access to it" }, 404);
  },
  // Every session ends, and every open tab's live connection closes, which sends it to sign-in.
  "POST /api/sign-out-everywhere": async ({ env, user }) => {
    await endSessionsOf(env.DB, user.id);
    await Promise.all((await workspacesOf(env.DB, user.id)).map((w) => env.WORKSPACE.get(env.WORKSPACE.idFromName(w.id)).disconnect(user.id)));
    const res = json({ ok: true });
    for (const c of clearSessionCookies()) res.headers.append("Set-Cookie", c);
    return res;
  },
};

async function api(req: Request, env: Env, url: URL): Promise<Response> {
  const user = await readSession(req, env);
  if (!user) return json({ error: "Sign in first", devLogin: env.DEV_LOGIN === "1" }, 401);

  // Cookies ride along on any request to us, so writes must come from our own pages.
  const isWrite = req.method !== "GET" && req.method !== "HEAD";
  const upgrade = req.headers.get("Upgrade") === "websocket";
  if ((isWrite || upgrade) && req.headers.get("Origin") !== url.origin) return json({ error: "Cross-origin request refused" }, 403);
  // Uploads are raw bytes; everything else that writes must be JSON.
  const isUpload = req.method === "POST" && /^\/api\/w\/[a-z0-9]+\/upload$/.test(url.pathname);
  if (isUpload && Number(req.headers.get("Content-Length") ?? 0) > MAX_UPLOAD) return json({ error: "That file is over 50 MB" }, 413);
  if (isWrite && !isUpload && !String(req.headers.get("Content-Type")).startsWith("application/json")) return json({ error: "JSON only" }, 415);

  const key = routeKey(req.method, url.pathname);
  if (isAccountRoute(key)) return ACCOUNT[key]({ req, env, url, user });

  const m = url.pathname.match(/^\/api\/w\/([a-z0-9]+)(\/.*)$/);
  if (!m) return json({ error: "Not found" }, 404);
  const [, wsId, route] = m;
  const ws = await membership(env.DB, user.id, wsId);
  if (!ws) return json({ error: "Not found" }, 404);
  const allowed = access(ws.role, req.method, route);
  if (allowed === "unknown") return json({ error: "Not found" }, 404);
  if (allowed === "forbidden") {
    return json({ error: ws.role === "viewer" ? "You can view this workspace but not edit it" : "Only the workspace's owner can do that" }, 403);
  }

  if (route === "/invites" && req.method === "POST") {
    if (ws.kind !== "team") return json({ error: "Only a team's owner can invite people" }, 403);
    const { role } = (await req.json()) as { role?: string };
    const token = await createInvite(env.DB, ws.id, user.id, role === "viewer" ? "viewer" : "editor");
    return json({ url: `${url.origin}/invite/${token}` });
  }

  // Forward to the workspace. Only this Worker can reach it, so these headers can be trusted there.
  const headers = new Headers(req.headers);
  headers.set("x-ci-workspace", ws.id);
  headers.set("x-ci-workspace-name", encodeURIComponent(ws.name));
  headers.set("x-ci-actor", encodeURIComponent(user.name));
  headers.set("x-ci-user", user.id);
  headers.set("x-ci-role", ws.role);
  const inner = new Request(`https://workspace${route}${url.search}`, { method: req.method, headers, body: isWrite ? req.body : undefined, redirect: "manual" });
  return env.WORKSPACE.get(env.WORKSPACE.idFromName(ws.id)).fetch(inner);
}

async function invite(req: Request, env: Env, url: URL): Promise<Response> {
  const user = await readSession(req, env);
  if (!user) return Response.redirect(`${url.origin}/auth/${env.DEV_LOGIN === "1" ? "dev" : "google"}?next=${encodeURIComponent(url.pathname)}`, 302);
  const wsId = await acceptInvite(env.DB, url.pathname.split("/")[2] ?? "", user.id);
  if (!wsId) return new Response("This invite link has expired or isn't valid. Ask for a new one.", { status: 410 });
  return Response.redirect(`${url.origin}/?w=${wsId}`, 302);
}
