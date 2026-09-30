// A workspace's own settings, all in D1: its name, its members and their roles, its invite links,
// leaving it and deleting it. The Worker handles these routes itself (the workspace's Durable Object
// holds only notes); `access.ts` says who may use each. Every change goes in `workspace_log`.
import { json } from "../../src/core/api.ts";
import type { Role } from "./access.ts";
import { revokeAgentsIn } from "./agents.ts";
import { createInvite, type User, type WorkspaceRef } from "./directory.ts";
import type { Env } from "./env.ts";
import { limit } from "./limits.ts";

export interface Member {
  id: string;
  name: string;
  email: string;
  role: Role;
  joinedAt: number;
}

export interface InviteRow {
  /** The stored hash of its token: enough to revoke it, useless for joining. */
  id: string;
  role: "editor" | "viewer";
  createdBy: string | null;
  createdAt: number;
  expiresAt: number;
  usedBy: string | null;
  usedAt: number | null;
}

export interface LogEntry {
  at: number;
  actor: string | null;
  action: "rename" | "role" | "remove" | "leave" | "invite" | "revoke-invite";
  target: string | null;
  detail: string | null;
}

const ROLES: Role[] = ["owner", "editor", "viewer"];
const fail = (error: string, status = 400) => json({ error }, status);

async function log(env: Env, ws: string, actor: string, action: LogEntry["action"], target: string | null, detail: string | null = null) {
  await env.DB.prepare("INSERT INTO workspace_log(workspace_id, at, actor_id, action, target_id, detail) VALUES (?,?,?,?,?,?)").bind(ws, Date.now(), actor, action, target, detail).run();
}

export async function membersOf(env: Env, ws: string): Promise<Member[]> {
  const { results } = await env.DB.prepare(
    `SELECT u.id, u.name, u.email, m.role, m.created_at AS joinedAt FROM members m JOIN users u ON u.id = m.user_id
     WHERE m.workspace_id = ? ORDER BY m.role = 'viewer', m.role = 'editor', u.name`,
  )
    .bind(ws)
    .all<Member>();
  return results;
}

const owners = async (env: Env, ws: string) =>
  (await env.DB.prepare("SELECT COUNT(*) AS n FROM members WHERE workspace_id = ? AND role = 'owner'").bind(ws).first<{ n: number }>())?.n ?? 0;

/** Someone leaves (or is removed): their membership, their agents' access here, their open tabs and their own calendars here all go. */
async function drop(env: Env, url: URL, ws: string, userId: string) {
  await env.DB.prepare("DELETE FROM members WHERE workspace_id = ? AND user_id = ?").bind(ws, userId).run();
  await revokeAgentsIn(env, url, userId, ws);
  const stub = env.WORKSPACE.get(env.WORKSPACE.idFromName(ws));
  await stub.disconnect(userId);
  await stub.dropCalendarsOf(userId); // their own calendars there (Google's) go with them
}

/** The settings routes, or null if `route` isn't one (it goes on to the workspace). */
export async function adminRoute(req: Request, env: Env, url: URL, user: User, ws: WorkspaceRef, route: string, body: () => Promise<Record<string, unknown>>): Promise<Response | null> {
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  switch (`${req.method} ${route}`) {
    case "GET /members":
      // `you`: which one is the person asking (a contact with their email is them; see src/core/contacts.ts).
      return json((await membersOf(env, ws.id)).map((m) => ({ ...m, you: m.id === user.id })));

    case "POST /members/role": {
      const b = await body();
      const [target, role] = [str(b.user), str(b.role) as Role];
      if (!ROLES.includes(role)) return fail(`"role" must be one of ${ROLES.join(", ")}`);
      const current = (await membersOf(env, ws.id)).find((m) => m.id === target);
      if (!current) return fail("They aren't in this workspace", 404);
      if (current.role === role) return json({ ok: true });
      if (current.role === "owner" && (await owners(env, ws.id)) === 1) return fail("A workspace needs an owner. Make someone else an owner first.", 409);
      await env.DB.prepare("UPDATE members SET role = ? WHERE workspace_id = ? AND user_id = ?").bind(role, ws.id, target).run();
      // Their agents connected with the old role; they reconnect to get the new one.
      await revokeAgentsIn(env, url, target, ws.id);
      await log(env, ws.id, user.id, "role", target, `${current.role} → ${role}`);
      return json({ ok: true });
    }

    case "POST /members/remove": {
      const target = str((await body()).user);
      const current = (await membersOf(env, ws.id)).find((m) => m.id === target);
      if (!current) return fail("They aren't in this workspace", 404);
      if (target === user.id) return fail("To leave, use Leave workspace", 400);
      if (current.role === "owner" && (await owners(env, ws.id)) === 1) return fail("A workspace needs an owner. Make someone else an owner first.", 409);
      await drop(env, url, ws.id, target);
      await log(env, ws.id, user.id, "remove", target, current.role);
      return json({ ok: true });
    }

    case "POST /leave": {
      if (ws.kind === "personal") return fail("Your own workspace is yours to keep. Rename it instead.", 409);
      if (ws.role === "owner" && (await owners(env, ws.id)) === 1) return fail("You're its only owner. Make someone else an owner first, or delete the workspace.", 409);
      await drop(env, url, ws.id, user.id);
      await log(env, ws.id, user.id, "leave", user.id, ws.role);
      return json({ ok: true });
    }

    case "POST /invites": {
      if (ws.kind !== "team") return fail("Only a team's owner can invite people", 403);
      const tooMany = await limit(env.DB, "invite", user.id);
      if (tooMany) return tooMany;
      const role = (await body()).role === "viewer" ? "viewer" : "editor";
      const token = await createInvite(env.DB, ws.id, user.id, role);
      await log(env, ws.id, user.id, "invite", null, role);
      return json({ url: `${url.origin}/invite/${token}` });
    }

    case "GET /invites": {
      const { results } = await env.DB.prepare(
        `SELECT i.token AS id, i.role, c.name AS createdBy, i.created_at AS createdAt, i.expires_at AS expiresAt, u.name AS usedBy, i.used_at AS usedAt
         FROM invites i LEFT JOIN users c ON c.id = i.created_by LEFT JOIN users u ON u.id = i.used_by
         WHERE i.workspace_id = ? ORDER BY i.created_at DESC LIMIT 100`,
      )
        .bind(ws.id)
        .all<InviteRow>();
      return json(results);
    }

    case "POST /invites/revoke": {
      const id = str((await body()).id);
      // By workspace too, so an id from another workspace revokes nothing.
      const gone = await env.DB.prepare("DELETE FROM invites WHERE token = ? AND workspace_id = ? AND used_at IS NULL RETURNING role").bind(id, ws.id).first<{ role: string }>();
      if (!gone) return fail("That invite link isn't active here", 404);
      await log(env, ws.id, user.id, "revoke-invite", null, gone.role);
      return json({ ok: true });
    }

    case "GET /workspace/log": {
      const { results } = await env.DB.prepare(
        `SELECT l.at, a.name AS actor, l.action, t.name AS target, l.detail FROM workspace_log l
         LEFT JOIN users a ON a.id = l.actor_id LEFT JOIN users t ON t.id = l.target_id
         WHERE l.workspace_id = ? ORDER BY l.id DESC LIMIT 100`,
      )
        .bind(ws.id)
        .all<LogEntry>();
      return json(results);
    }

    case "POST /workspace/rename": {
      const name = str((await body()).name).trim().slice(0, 80);
      if (!name) return fail("Give the workspace a name");
      await env.DB.prepare("UPDATE workspaces SET name = ? WHERE id = ?").bind(name, ws.id).run();
      await log(env, ws.id, user.id, "rename", null, `${ws.name} → ${name}`);
      return json({ ok: true, name });
    }

    case "POST /workspace/delete": {
      if (ws.kind === "personal") return fail("Your own workspace can't be deleted. Rename it, or delete its notes.", 409);
      if (str((await body()).confirm).trim() !== ws.name) return fail(`Type the workspace's name, ${ws.name}, to delete it`);
      await deleteWorkspace(env, url, ws.id);
      return json({ ok: true });
    }
  }
  return null;
}

/**
 * Delete a team workspace for good: everyone's agents lose access, open tabs close, its notes and
 * files go (the Durable Object's storage and R2), and so do its members, invites, note IDs and log.
 */
async function deleteWorkspace(env: Env, url: URL, ws: string) {
  for (const m of await membersOf(env, ws)) await revokeAgentsIn(env, url, m.id, ws);
  await env.WORKSPACE.get(env.WORKSPACE.idFromName(ws)).destroy(ws);
  await env.DB.batch(
    ["DELETE FROM invites WHERE workspace_id = ?", "DELETE FROM note_ids WHERE workspace_id = ?", "DELETE FROM workspace_log WHERE workspace_id = ?", "DELETE FROM members WHERE workspace_id = ?", "DELETE FROM workspaces WHERE id = ?"].map(
      (sql) => env.DB.prepare(sql).bind(ws),
    ),
  );
}
