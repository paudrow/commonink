// Deleting your own account: what it takes with it, and doing it. Your personal workspace and any
// team workspace you're the only member of are deleted (notes, files, history); you leave every
// other workspace, as Leave does; your agents, sessions, Google connection and what's shared with you
// go; and then so does your account. Notes you wrote in teams you leave stay theirs. If you're the
// only owner of a team that others are in, it waits until you make someone else an owner.
import { deleteWorkspace, drop, log, membersOf } from "./admin.ts";
import { revokeAgents } from "./agents.ts";
import { disconnectGoogle } from "./connections.ts";
import { endSessionsOf, workspacesOf, type User, type WorkspaceRef } from "./directory.ts";
import type { Env } from "./env.ts";
import { sharedWith } from "./shares.ts";

type Ws = Pick<WorkspaceRef, "id" | "name" | "kind">;

export interface DeletionPlan {
  /** Deleted with the account: your personal workspace, and teams with no one else in them. */
  deletes: Ws[];
  /** Left, as Leave does: teams that have someone else, where you aren't the last owner. */
  leaves: Ws[];
  /** In the way: teams others are in where you're the only owner. Make someone else an owner first. */
  blocked: Ws[];
}

const ref = (w: WorkspaceRef): Ws => ({ id: w.id, name: w.name, kind: w.kind });

export async function deletionPlan(env: Env, user: User): Promise<DeletionPlan> {
  const plan: DeletionPlan = { deletes: [], leaves: [], blocked: [] };
  for (const w of await workspacesOf(env.DB, user.id)) {
    if (w.kind === "personal") {
      plan.deletes.push(ref(w));
      continue;
    }
    const members = await membersOf(env, w.id);
    if (members.every((m) => m.id === user.id)) plan.deletes.push(ref(w));
    else if (w.role === "owner" && members.filter((m) => m.role === "owner").length === 1) plan.blocked.push(ref(w));
    else plan.leaves.push(ref(w));
  }
  return plan;
}

/**
 * Delete `user` for good, as `deletionPlan` says. Returns the plan, or null (and nothing changes)
 * while a team is blocking it. `closeTabs` closes their open tabs everywhere first.
 */
export async function deleteAccount(env: Env, url: URL, user: User, closeTabs: () => Promise<void>): Promise<DeletionPlan | null> {
  const plan = await deletionPlan(env, user);
  if (plan.blocked.length) return null;
  const sharedIn = (await sharedWith(env.DB, user)).map((s) => s.workspace.id);

  // Nothing of theirs keeps working while the rest goes: tabs, sessions, agents, Google.
  await closeTabs();
  await endSessionsOf(env.DB, user.id);
  await revokeAgents(env, url, user, "all");
  await disconnectGoogle(env, user.id);

  for (const w of plan.leaves) {
    if (await drop(env, url, w.id, user.id)) await log(env, w.id, user.id, "leave", user.id, "account deleted");
  }
  for (const w of plan.deletes) await deleteWorkspace(env, url, w.id);

  // What still names them in the directory: teams they co-owned, shares they made there, invites.
  const email = user.email.toLowerCase();
  const sub = (await env.DB.prepare("SELECT google_sub FROM users WHERE id = ?").bind(user.id).first<{ google_sub: string | null }>())?.google_sub ?? "";
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE workspaces SET owner_id = (SELECT user_id FROM members WHERE workspace_id = workspaces.id AND role = 'owner' ORDER BY created_at LIMIT 1) WHERE owner_id = ?1",
    ).bind(user.id),
    env.DB.prepare("UPDATE shares SET created_by = (SELECT owner_id FROM workspaces WHERE id = shares.workspace_id) WHERE created_by = ?1").bind(user.id),
    env.DB.prepare("DELETE FROM shares WHERE (principal_type = 'user' AND principal = ?1) OR (principal_type = 'email' AND principal = ?2)").bind(user.id, email),
    env.DB.prepare("UPDATE invites SET used_by = NULL WHERE used_by = ?1").bind(user.id),
    env.DB.prepare("DELETE FROM invites WHERE created_by = ?1").bind(user.id),
    env.DB.prepare("DELETE FROM connections WHERE user_id = ?1").bind(user.id),
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ?1").bind(user.id),
    env.DB.prepare("DELETE FROM signup_attempts WHERE sub = ?1").bind(sub),
    env.DB.prepare("DELETE FROM users WHERE id = ?1").bind(user.id),
  ]);
  // Workspaces that shared notes with them stop showing them as someone with access.
  await Promise.all(sharedIn.map((id) => env.WORKSPACE.get(env.WORKSPACE.idFromName(id)).sharingChanged()));
  return plan;
}
