// The directory in D1: people, workspaces, memberships, invites.
import type { Role } from "./access.ts";
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

/** Whether a Google (or dev) identity already has an account. */
export async function hasUser(db: D1Database, sub: string) {
  return !!(await db.prepare("SELECT 1 FROM users WHERE google_sub = ?").bind(sub).first());
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

/** Invites are stored by the SHA-256 of their token, like sessions: a leaked table lets no one in. */
const inviteKey = async (token: string) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)))].map((b) => b.toString(16).padStart(2, "0")).join("");

/** A new invite link's token. It works once, for 7 days. */
export async function createInvite(db: D1Database, workspaceId: string, by: string, role: "editor" | "viewer") {
  const token = [...crypto.getRandomValues(new Uint8Array(20))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const now = Date.now();
  await db
    .prepare("INSERT INTO invites(token, workspace_id, role, created_by, created_at, expires_at) VALUES (?,?,?,?,?,?)")
    .bind(await inviteKey(token), workspaceId, role, by, now, now + 7 * 86400_000)
    .run();
  return token;
}

/** Wrong sign-up codes entered for this identity since `since`. */
export async function failedSignups(db: D1Database, sub: string, since: number) {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM signup_attempts WHERE sub = ? AND at > ?").bind(sub, since).first<{ n: number }>();
  return row?.n ?? 0;
}

export async function recordFailedSignup(db: D1Database, sub: string) {
  await db.prepare("INSERT INTO signup_attempts(sub, at) VALUES (?, ?)").bind(sub, Date.now()).run();
}

/** Whether an invite link is still good, without using it. */
export async function inviteIsValid(db: D1Database, token: string) {
  return !!(await inviteInfo(db, token));
}

/** What an invite link is for, if it's still good: the workspace and the role it gives. */
export async function inviteInfo(db: D1Database, token: string) {
  return db
    .prepare(
      `SELECT i.workspace_id AS workspaceId, w.name AS workspaceName, i.role FROM invites i JOIN workspaces w ON w.id = i.workspace_id
       WHERE i.token = ? AND i.expires_at >= ?`,
    )
    .bind(await inviteKey(token), Date.now())
    .first<{ workspaceId: string; workspaceName: string; role: Role }>();
}

/**
 * Join a workspace from an invite link, which it uses up. Returns the workspace id, or null if the
 * link is bad, expired or used. Someone who's already a member keeps their role and the link.
 */
export async function acceptInvite(db: D1Database, token: string, userId: string) {
  const inv = await inviteInfo(db, token);
  if (!inv) return null;
  if (await membership(db, userId, inv.workspaceId)) return inv.workspaceId;
  const used = await db.prepare("DELETE FROM invites WHERE token = ? RETURNING workspace_id").bind(await inviteKey(token)).first();
  if (!used) return null; // someone else used it a moment ago
  await db.prepare("INSERT INTO members(workspace_id, user_id, role, created_at) VALUES (?,?,?,?) ON CONFLICT DO NOTHING").bind(inv.workspaceId, userId, inv.role, Date.now()).run();
  return inv.workspaceId;
}

// ------------------------------------------------------------------ sessions

/** `id` is the SHA-256 of the cookie's token; the token itself is never stored. */
export async function createSession(db: D1Database, id: string, userId: string, expiresAt: number, idleSince: number) {
  const now = Date.now();
  await db.batch([
    // Sign-in is a good moment to forget this person's sessions that have run out.
    db.prepare("DELETE FROM sessions WHERE user_id = ? AND (expires_at <= ? OR seen_at <= ?)").bind(userId, now, idleSince),
    db.prepare("INSERT INTO sessions(id, user_id, created_at, seen_at, expires_at) VALUES (?,?,?,?,?)").bind(id, userId, now, now, expiresAt),
  ]);
}

/** Who a session belongs to, if it hasn't expired or been idle since `idleSince`. */
export function sessionUser(db: D1Database, id: string, idleSince: number) {
  return db
    .prepare(
      `SELECT u.id, u.email, u.name, u.picture, s.seen_at AS seenAt, s.expires_at AS expiresAt FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.expires_at > ? AND s.seen_at > ?`,
    )
    .bind(id, Date.now(), idleSince)
    .first<User & { seenAt: number; expiresAt: number }>();
}

export async function touchSession(db: D1Database, id: string) {
  await db.prepare("UPDATE sessions SET seen_at = ? WHERE id = ?").bind(Date.now(), id).run();
}

export async function endSession(db: D1Database, id: string) {
  await db.prepare("DELETE FROM sessions WHERE id = ?").bind(id).run();
}

export async function endSessionsOf(db: D1Database, userId: string) {
  await db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId).run();
}
