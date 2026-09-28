// The directory in D1: people, workspaces, memberships, invites.
export type Role = "owner" | "editor" | "viewer";
export interface User {
  id: string;
  email: string;
  name: string;
  picture: string | null;
}
export interface WorkspaceRef {
  id: string;
  name: string;
  kind: "personal" | "team";
  role: Role;
}

export const newId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 16);

/** Find or create the person behind a Google (or dev) identity. */
export async function upsertUser(db: D1Database, sub: string, profile: { email: string; name: string; picture?: string | null }) {
  const existing = await db.prepare("SELECT id, email, name, picture FROM users WHERE google_sub = ?").bind(sub).first<User>();
  if (existing) {
    await db
      .prepare("UPDATE users SET email = ?, name = ?, picture = ? WHERE id = ?")
      .bind(profile.email, profile.name, profile.picture ?? null, existing.id)
      .run();
    return { user: { ...existing, ...profile, picture: profile.picture ?? null }, isNew: false };
  }
  const user: User = { id: newId(), email: profile.email, name: profile.name, picture: profile.picture ?? null };
  await db
    .prepare("INSERT INTO users(id, google_sub, email, name, picture, created_at) VALUES (?,?,?,?,?,?)")
    .bind(user.id, sub, user.email, user.name, user.picture, Date.now())
    .run();
  return { user, isNew: true };
}

export function getUser(db: D1Database, id: string) {
  return db.prepare("SELECT id, email, name, picture FROM users WHERE id = ?").bind(id).first<User>();
}

export async function workspacesOf(db: D1Database, userId: string): Promise<WorkspaceRef[]> {
  const { results } = await db
    .prepare(
      `SELECT w.id, w.name, w.kind, m.role FROM members m JOIN workspaces w ON w.id = m.workspace_id
       WHERE m.user_id = ? ORDER BY w.kind = 'team', w.created_at`,
    )
    .bind(userId)
    .all<WorkspaceRef>();
  return results;
}

export function membership(db: D1Database, userId: string, workspaceId: string) {
  return db
    .prepare(
      `SELECT w.id, w.name, w.kind, m.role FROM members m JOIN workspaces w ON w.id = m.workspace_id
       WHERE m.user_id = ? AND m.workspace_id = ?`,
    )
    .bind(userId, workspaceId)
    .first<WorkspaceRef>();
}

/**
 * Which workspace a note ID belongs to, if this person can open it. Not-found and no-access look the
 * same, so a guessed ID reveals nothing. (Per-note sharing will add its grants here.)
 */
export function locateNote(db: D1Database, userId: string, noteId: string) {
  return db
    .prepare(
      `SELECT w.id, w.name FROM note_ids n JOIN members m ON m.workspace_id = n.workspace_id AND m.user_id = ?
       JOIN workspaces w ON w.id = n.workspace_id WHERE n.id = ?`,
    )
    .bind(userId, noteId)
    .first<{ id: string; name: string }>();
}

export async function createWorkspace(db: D1Database, owner: User, name: string, kind: "personal" | "team") {
  const id = newId();
  const now = Date.now();
  await db.batch([
    db.prepare("INSERT INTO workspaces(id, name, kind, owner_id, created_at) VALUES (?,?,?,?,?)").bind(id, name, kind, owner.id, now),
    db.prepare("INSERT INTO members(workspace_id, user_id, role, created_at) VALUES (?,?,?,?)").bind(id, owner.id, "owner", now),
  ]);
  return id;
}

export async function createInvite(db: D1Database, workspaceId: string, by: string, role: "editor" | "viewer") {
  const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const now = Date.now();
  await db
    .prepare("INSERT INTO invites(token, workspace_id, role, created_by, created_at, expires_at) VALUES (?,?,?,?,?,?)")
    .bind(token, workspaceId, role, by, now, now + 7 * 86400_000)
    .run();
  return token;
}

/** Join a workspace from an invite link. Returns the workspace id, or null if the link is bad or expired. */
export async function acceptInvite(db: D1Database, token: string, userId: string) {
  const inv = await db.prepare("SELECT workspace_id, role, expires_at FROM invites WHERE token = ?").bind(token).first<{ workspace_id: string; role: Role; expires_at: number }>();
  if (!inv || inv.expires_at < Date.now()) return null;
  await db
    .prepare("INSERT INTO members(workspace_id, user_id, role, created_at) VALUES (?,?,?,?) ON CONFLICT DO NOTHING")
    .bind(inv.workspace_id, userId, inv.role, Date.now())
    .run();
  return inv.workspace_id;
}
