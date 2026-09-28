// The Worker: signs people in, checks what they can open, and forwards workspace requests to that
// workspace's Durable Object. Everything else is the web app, served from the edge as static assets.
import { json } from "../../src/core/api.ts";
import { unfurl } from "../../src/core/unfurl.ts";
import { ensurePersonalWorkspace, handleAuth, readSession, seedWorkspace } from "./auth.ts";
import { acceptInvite, createInvite, createWorkspace, getUser, membership, workspacesOf } from "./directory.ts";
import type { Env } from "./env.ts";

export { Workspace } from "./workspace.ts";

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.hostname.startsWith("www.")) {
      url.hostname = url.hostname.slice(4);
      return Response.redirect(url.toString(), 301);
    }
    if (url.pathname.startsWith("/auth/")) return handleAuth(req, env, (user) => ensurePersonalWorkspace(env, user));
    if (url.pathname.startsWith("/invite/")) return invite(req, env, url);
    if (url.pathname.startsWith("/api/")) return api(req, env, url);
    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;

async function api(req: Request, env: Env, url: URL): Promise<Response> {
  const session = await readSession(req, env);
  if (!session) return json({ error: "Sign in first", devLogin: env.DEV_LOGIN === "1" }, 401);
  const user = await getUser(env.DB, session.uid);
  if (!user) return json({ error: "Sign in first", devLogin: env.DEV_LOGIN === "1" }, 401);

  // Cookies ride along on any request to us, so writes must come from our own pages.
  const isWrite = req.method !== "GET" && req.method !== "HEAD";
  const upgrade = req.headers.get("Upgrade") === "websocket";
  if ((isWrite || upgrade) && req.headers.get("Origin") !== url.origin) return json({ error: "Cross-origin request refused" }, 403);
  if (isWrite && !String(req.headers.get("Content-Type")).startsWith("application/json")) return json({ error: "JSON only" }, 415);

  if (url.pathname === "/api/me") return json({ user, workspaces: await workspacesOf(env.DB, user.id) });
  if (url.pathname === "/api/workspaces" && req.method === "POST") {
    const { name } = (await req.json()) as { name?: string };
    const clean = String(name ?? "").trim().slice(0, 80);
    if (!clean) return json({ error: "Give the workspace a name" }, 400);
    const id = await createWorkspace(env.DB, user, clean, "team");
    await seedWorkspace(env, id);
    return json({ id });
  }
  if (url.pathname === "/api/unfurl") {
    const target = url.searchParams.get("url") ?? "";
    if (!/^https?:\/\//i.test(target)) return json({ error: "http(s) URLs only" }, 400);
    return json(await unfurl(target));
  }

  const m = url.pathname.match(/^\/api\/w\/([a-z0-9]+)(\/.*)$/);
  if (!m) return json({ error: "Not found" }, 404);
  const [, wsId, route] = m;
  const ws = await membership(env.DB, user.id, wsId);
  if (!ws) return json({ error: "Not found" }, 404);
  if (isWrite && ws.role === "viewer") return json({ error: "You can view this workspace but not edit it" }, 403);

  if (route === "/invites" && req.method === "POST") {
    if (ws.role !== "owner" || ws.kind !== "team") return json({ error: "Only a team's owner can invite people" }, 403);
    const { role } = (await req.json()) as { role?: string };
    const token = await createInvite(env.DB, ws.id, user.id, role === "viewer" ? "viewer" : "editor");
    return json({ url: `${url.origin}/invite/${token}` });
  }

  // Forward to the workspace. Only this Worker can reach it, so these headers can be trusted there.
  const headers = new Headers(req.headers);
  headers.set("x-ci-workspace", ws.id);
  headers.set("x-ci-workspace-name", encodeURIComponent(ws.name));
  headers.set("x-ci-actor", encodeURIComponent(user.name));
  const inner = new Request(`https://workspace${route}${url.search}`, { method: req.method, headers, body: isWrite ? req.body : undefined, redirect: "manual" });
  return env.WORKSPACE.get(env.WORKSPACE.idFromName(ws.id)).fetch(inner);
}

async function invite(req: Request, env: Env, url: URL): Promise<Response> {
  const session = await readSession(req, env);
  if (!session) return Response.redirect(`${url.origin}/auth/${env.DEV_LOGIN === "1" ? "dev" : "google"}?next=${encodeURIComponent(url.pathname)}`, 302);
  const wsId = await acceptInvite(env.DB, url.pathname.split("/")[2] ?? "", session.uid);
  if (!wsId) return new Response("This invite link has expired or isn't valid. Ask for a new one.", { status: 410 });
  return Response.redirect(`${url.origin}/?w=${wsId}`, 302);
}
