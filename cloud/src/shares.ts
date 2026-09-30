// Per-note sharing in D1: a note or folder shared with a person, an email address (whoever signs in
// with it: someone without an account yet, say), or anyone with the link. A link's token is
// HMAC(SESSION_SECRET, share id): 256 bits no one can guess, which members can copy again later,
// and only its SHA-256 is stored.
import type { Grant, ShareRole } from "./grants.ts";
import { newId } from "./directory.ts";

export interface Share {
  id: string;
  note: string | null;
  folder: string | null;
  kind: "user" | "email" | "link";
  /** Who: a person's name and email, an email address (whoever signs in with it), or null for a link. */
  name: string | null;
  email: string | null;
  role: ShareRole;
  expiresAt: number | null;
  createdBy: string | null;
  createdAt: number;
}

export type Target = { note: string; folder?: undefined } | { folder: string; note?: undefined };

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const sha256 = async (s: string) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));

/** A link share's token, from its id. */
export async function linkToken(secret: string, shareId: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`share:${shareId}`)));
}

const live = "(expires_at IS NULL OR expires_at > ?)";

/** Shares made out to this person: by account, or by their (verified) email address. */
const toPerson = "((s.principal_type = 'user' AND s.principal = ?) OR (s.principal_type = 'email' AND s.principal = ?))";

/** Everything shared with this person in one workspace, as grants. */
export async function grantsFor(db: D1Database, workspaceId: string, user: { id: string; email: string }): Promise<Grant[]> {
  const { results } = await db
    .prepare(`SELECT s.note_id AS note, s.folder, s.role, s.expires_at AS expiresAt FROM shares s WHERE s.workspace_id = ? AND ${toPerson} AND ${live.replaceAll("expires_at", "s.expires_at")}`)
    .bind(workspaceId, user.id, user.email.toLowerCase(), Date.now())
    .all<Grant>();
  return results;
}

/** The share a link's token opens, if it's still good. Tokens are 64 hex characters; anything else is refused before any lookup. */
export async function linkShare(db: D1Database, token: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  return db
    .prepare(`SELECT id, workspace_id AS workspaceId, note_id AS note, folder, role, expires_at AS expiresAt FROM shares WHERE token_hash = ? AND ${live}`)
    .bind(await sha256(token), Date.now())
    .first<{ id: string; workspaceId: string; expiresAt: number | null } & Grant>();
}

/** Every workspace that shares something with this person, with its grants (for "Shared with me"). */
export async function sharedWith(db: D1Database, user: { id: string; email: string }) {
  const { results } = await db
    .prepare(
      `SELECT s.workspace_id AS workspaceId, w.name AS workspaceName, s.note_id AS note, s.folder, s.role FROM shares s JOIN workspaces w ON w.id = s.workspace_id
       WHERE ${toPerson} AND ${live.replaceAll("expires_at", "s.expires_at")}
       AND NOT EXISTS (SELECT 1 FROM members m WHERE m.workspace_id = s.workspace_id AND m.user_id = ?)`,
    )
    .bind(user.id, user.email.toLowerCase(), Date.now(), user.id)
    .all<{ workspaceId: string; workspaceName: string } & Grant>();
  const by = new Map<string, { workspace: { id: string; name: string }; grants: Grant[] }>();
  for (const r of results) {
    const entry = by.get(r.workspaceId) ?? { workspace: { id: r.workspaceId, name: r.workspaceName }, grants: [] };
    entry.grants.push({ note: r.note, folder: r.folder, role: r.role });
    by.set(r.workspaceId, entry);
  }
  return [...by.values()];
}

/** A workspace's shares, of one note or folder or all of them, newest first. */
export async function listShares(db: D1Database, workspaceId: string, target?: Target): Promise<Share[]> {
  const where = target ? (target.note ? "AND s.note_id = ?" : "AND s.folder = ?") : "";
  const { results } = await db
    .prepare(
      `SELECT s.id, s.note_id AS note, s.folder, s.principal_type AS kind, u.name, COALESCE(u.email, CASE WHEN s.principal_type = 'email' THEN s.principal END) AS email,
              s.role, s.expires_at AS expiresAt, c.name AS createdBy, s.created_at AS createdAt
       FROM shares s LEFT JOIN users u ON s.principal_type = 'user' AND u.id = s.principal LEFT JOIN users c ON c.id = s.created_by
       WHERE s.workspace_id = ? ${where} ORDER BY s.created_at DESC LIMIT 500`,
    )
    .bind(...(target ? [workspaceId, target.note ?? target.folder] : [workspaceId]))
    .all<Share>();
  return results;
}

/** Whether an owner lets agents share this workspace's notes by link or with editors (off by default). */
export async function agentLinksAllowed(db: D1Database, ws: string): Promise<boolean> {
  return (await db.prepare("SELECT agent_links FROM workspaces WHERE id = ?").bind(ws).first<{ agent_links: number }>())?.agent_links === 1;
}

/**
 * Share a note or folder with someone by email (a person, if they have an account; the address, if
 * not) or with anyone who has the link. Sharing again with the same person or link changes its role
 * and expiry. Returns the share and, for a link, its URL path.
 */
export async function addShare(
  db: D1Database,
  secret: string,
  o: { workspaceId: string; by: string; target: Target; email?: string; link?: boolean; role: ShareRole; expiresAt?: number | null; viaAgent: boolean },
) {
  const email = o.email?.trim().toLowerCase();
  if (!o.link && !(email && /^[^\s@]+@[^\s@]+$/.test(email))) throw new ShareError("Give an email address, or share a link");
  // An agent can be steered by what it reads (AGENTS.md, a shared note), so it can't widen who sees or
  // changes notes (a link anyone can use, or another editor) unless an owner has allowed it.
  if (o.viaAgent && (o.link || o.role === "editor") && !(await agentLinksAllowed(db, o.workspaceId))) {
    throw new ShareError("Agents can't share by link or for editing in this workspace. An owner can allow it in the workspace's settings.", 403);
  }
  // One account with that address: theirs. None (or, on Previews, several dev accounts): the address's.
  const found = email ? (await db.prepare("SELECT id FROM users WHERE lower(email) = ? LIMIT 2").bind(email).all<{ id: string }>()).results : [];
  const user = found.length === 1 ? found[0] : null;
  const kind = o.link ? "link" : user ? "user" : "email";
  const principal = o.link ? null : (user?.id ?? email!);
  const targetCol = o.target.note ? "note_id" : "folder";
  const target = o.target.note ?? o.target.folder;
  const existing = await db
    .prepare(`SELECT id FROM shares WHERE workspace_id = ? AND ${targetCol} = ? AND principal_type = ? AND principal IS ?`)
    .bind(o.workspaceId, target, kind, principal)
    .first<{ id: string }>();
  const id = existing?.id ?? newId();
  if (existing) {
    await db.prepare("UPDATE shares SET role = ?, expires_at = ? WHERE id = ?").bind(o.role, o.expiresAt ?? null, id).run();
  } else {
    const token = o.link ? await sha256(await linkToken(secret, id)) : null;
    await db
      .prepare(`INSERT INTO shares(id, workspace_id, note_id, folder, principal_type, principal, role, token_hash, expires_at, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(id, o.workspaceId, o.target.note ?? null, o.target.folder ?? null, kind, principal, o.role, token, o.expiresAt ?? null, o.by, Date.now())
      .run();
  }
  return { id, kind, url: o.link ? `/s/${await linkToken(secret, id)}` : null };
}

/** Change a share's role or expiry (in this workspace only). */
export async function updateShare(db: D1Database, workspaceId: string, id: string, o: { role?: ShareRole; expiresAt?: number | null }) {
  const row = await db
    .prepare("UPDATE shares SET role = COALESCE(?1, role), expires_at = CASE WHEN ?2 THEN ?3 ELSE expires_at END WHERE id = ?4 AND workspace_id = ?5 RETURNING id")
    .bind(o.role ?? null, o.expiresAt !== undefined ? 1 : 0, o.expiresAt ?? null, id, workspaceId)
    .first();
  if (!row) throw new ShareError("That share isn't in this workspace", 404);
}

/** Stop sharing (in this workspace only). */
export async function removeShare(db: D1Database, workspaceId: string, id: string) {
  const row = await db.prepare("DELETE FROM shares WHERE id = ? AND workspace_id = ? RETURNING id").bind(id, workspaceId).first();
  if (!row) throw new ShareError("That share isn't in this workspace", 404);
}

/** Whether someone new has been shared something by email: a member vouched for them, so they may sign up. */
export async function hasPendingShare(db: D1Database, email: string) {
  return !!(await db.prepare(`SELECT 1 FROM shares WHERE principal_type = 'email' AND principal = ? AND ${live}`).bind(email.toLowerCase(), Date.now()).first());
}

/** A link visitor who signed in keeps the note: the link's share, as their own, until the link would have run out. */
export async function joinLink(db: D1Database, share: { id: string; workspaceId: string; expiresAt: number | null } & Grant, userId: string) {
  const col = share.note ? "note_id" : "folder";
  const target = share.note ?? share.folder;
  const mine = await db
    .prepare(`SELECT id, role FROM shares WHERE workspace_id = ? AND ${col} = ? AND principal_type = 'user' AND principal = ?`)
    .bind(share.workspaceId, target, userId)
    .first<{ id: string; role: ShareRole }>();
  if (mine && (mine.role === "editor" || share.role === "viewer")) return;
  if (mine) await db.prepare("UPDATE shares SET role = ?, expires_at = ? WHERE id = ?").bind(share.role, share.expiresAt, mine.id).run();
  else {
    const creator = await db.prepare("SELECT created_by FROM shares WHERE id = ?").bind(share.id).first<{ created_by: string }>();
    await db
      .prepare(`INSERT INTO shares(id, workspace_id, note_id, folder, principal_type, principal, role, token_hash, expires_at, created_by, created_at) VALUES (?,?,?,?,'user',?,?,NULL,?,?,?)`)
      .bind(newId(), share.workspaceId, share.note, share.folder, userId, share.role, share.expiresAt, creator!.created_by, Date.now())
      .run();
  }
}

/** A share request that can't be done, with the status to answer it with. */
export class ShareError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}
