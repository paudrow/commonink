// The `quire` CLI in a hosted workspace: after `quire login` (OAuth, as for remote MCP), it sends
// each command here with its token, and the workspace runs it with the same command table and core
// as a local vault. A CLI's grant may cover all of the person's workspaces; which one a command runs
// in, and the person's role there, are read fresh on every request.
import { json } from "../../src/core/api.ts";
import { agentSource } from "../../src/core/actor.ts";
import { COMMANDS, UsageError, type WorkspaceSettings } from "../../src/core/commands/index.ts";
import { QuireError } from "../../src/core/paths.ts";
import { CLI_ROUTE, fromWire, toWire, type RunRequest, type RunResponse } from "../../src/core/commands/wire.ts";
import { access } from "./access.ts";
import { adminRoute } from "./admin.ts";
import { getUser, workspacesOf, type User, type WorkspaceRef } from "./directory.ts";
import { limit } from "./limits.ts";
import type { AgentProps, OAuthEnv } from "./agents.ts";

/** A grant for every workspace the person is in (the CLI asks for it with the `workspaces` scope). */
export const ALL_WORKSPACES = "*";

const HTTP: Record<string, number> = { usage: 400, invalid: 400, not_found: 404, conflict: 409, exists: 409, forbidden: 403 };
const CODE: Record<number, QuireError["code"]> = { 403: "forbidden", 404: "not_found", 409: "conflict" };
const fail = (error: string, code: string) => json({ ok: false, error, code } satisfies RunResponse, HTTP[code] ?? 400);

/** `GET /mcp/cli/workspaces` and `POST /mcp/cli/run`, for a request with a valid token. */
export async function serveCli(req: Request, env: OAuthEnv, props: AgentProps): Promise<Response> {
  const user = await getUser(env.DB, props.userId);
  if (!user) return fail("The person who signed in no longer has an account", "forbidden");
  const all = await workspacesOf(env.DB, user.id);
  const mine = props.workspaceId === ALL_WORKSPACES ? all : all.filter((w) => w.id === props.workspaceId);
  const path = new URL(req.url).pathname;
  if (req.method === "GET" && path === `${CLI_ROUTE}/workspaces`) return json({ user: { name: user.name }, workspaces: mine });
  if (req.method !== "POST" || path !== `${CLI_ROUTE}/run`) return fail(`No route ${req.method} ${path}`, "not_found");

  const body = (await req.json().catch(() => null)) as RunRequest | null;
  if (!body || typeof body.command !== "string" || typeof body.input !== "object" || body.input === null) return fail("Expected {command, input}", "usage");
  const command = COMMANDS.find((c) => c.cli === body.command);
  if (!command) return fail(`No command "${body.command}": see quire help`, "usage");
  const ws = pick(mine, body.workspace);
  if ("error" in ws) return fail(ws.error, ws.code);
  if (access(ws.role, ...(command.route.split(" ") as [string, string])) !== "allowed") {
    return fail(ws.role === "viewer" ? `You can view ${ws.name} but not edit it` : "Only the workspace's owner can do that", "forbidden");
  }
  if (command.cli === "upload") {
    const tooMany = await limit(env.DB, "upload", user.id);
    if (tooMany) return tooMany;
  }
  if (command.settings) {
    // Settings live in the directory, not the workspace's notes: the Worker runs these itself, as it does the app's.
    try {
      return json(toWire({ ok: true, ...(await command.run({ settings: settingsOf(req, env, user, ws), user: user.id }, fromWire(body.input) as never)) } satisfies RunResponse));
    } catch (e) {
      if (e instanceof Response) return e;
      if (e instanceof QuireError) return fail(e.message, e.code);
      if (e instanceof UsageError) return fail(e.message, "usage");
      throw e;
    }
  }
  const agent = typeof body.agent === "string" && body.agent.trim() ? body.agent.trim().slice(0, 40) : null;
  const actor = agent ? agentSource(agent, user.name) : user.name;
  const stub = env.WORKSPACE.get(env.WORKSPACE.idFromName(ws.id));
  const out = await stub.runCommand(command.cli, fromWire(body.input) as Record<string, unknown>, { workspace: ws.id, user: user.id, actor, role: ws.role });
  return out.ok ? json(toWire(out)) : fail(out.error, out.code);
}

/**
 * A workspace's settings for a settings command: each call goes through the same handler as the
 * app's Settings (admin.ts). A refusal throws a QuireError; being rate-limited throws the 429 as is.
 */
function settingsOf(req: Request, env: OAuthEnv, user: User, ws: WorkspaceRef): WorkspaceSettings {
  const url = new URL(req.url);
  return {
    name: ws.name,
    async call(route, body = {}) {
      const [method, path] = route.split(" ");
      const res = (await adminRoute(new Request(url, { method }), env, url, user, ws, path, async () => body))!;
      if (res.status === 429) throw res;
      const out = (await res.json()) as { error?: string };
      if (!res.ok) throw new QuireError(out.error ?? `${route} failed (${res.status})`, CODE[res.status] ?? "invalid");
      return out;
    },
  };
}

/** The workspace a command names (by ID or name, any case), or why there isn't one. */
function pick(mine: WorkspaceRef[], want: string | undefined): WorkspaceRef | { error: string; code: string } {
  const names = mine.map((w) => w.name).join(", ");
  if (!mine.length) return { error: "This sign-in doesn't reach any workspace you're in now. Run quire login again.", code: "forbidden" };
  if (!want) return mine.length === 1 ? mine[0] : { error: `Say which workspace: --workspace <name>, or quire workspaces use <name>. Yours: ${names}`, code: "usage" };
  const t = want.trim().toLowerCase();
  const found = mine.filter((w) => w.id === want || w.name.toLowerCase() === t);
  if (found.length === 1) return found[0];
  return found.length
    ? { error: `More than one workspace is called ${want}: use its ID (quire workspaces)`, code: "usage" }
    : { error: `No workspace "${want}" here. Yours: ${names}`, code: "not_found" };
}
