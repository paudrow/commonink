// What someone outside a workspace may see in it: the shares that reach them, as grants. A grant is
// a note (by its stable ID, so renames and moves keep it) or a folder (by path, covering everything
// beneath it). The effective role on a note is the highest that applies. No Workers imports, so the
// workspace and tests can both use it.
import { AGENTS_NOTE } from "../../src/core/noteRoles.ts";
import { kindOf } from "../../src/core/paths.ts";

export type ShareRole = "viewer" | "editor";

export interface Grant {
  note: string | null;
  folder: string | null;
  role: ShareRole;
  /** When the share runs out, if it does: an open live connection closes then. */
  expiresAt?: number | null;
}

/**
 * Who a request into the workspace's shared routes is: a member (their workspace role decides), or
 * someone the grants reach. `write` is false for anyone not signed in (a link visitor).
 */
export type SharedAccess = { member: ShareRole } | { grants: Grant[]; write: boolean };

const RANK: Record<ShareRole, number> = { viewer: 0, editor: 1 };

/** The role these grants give on a note, or null if none reaches it. */
export function roleOn(grants: Grant[], note: { id: string | null; path: string }): ShareRole | null {
  let best: ShareRole | null = null;
  for (const g of grants) {
    const hit = g.note ? g.note === note.id : note.path.startsWith(`${g.folder}/`);
    if (hit && (!best || RANK[g.role] > RANK[best])) best = g.role;
  }
  return best;
}

/**
 * Whether someone outside the workspace may ever edit this path through a share, whatever the grant
 * says: markdown and HTML notes only (never an upload), and never AGENTS.md, which every member's
 * agent follows. Checked on every request, so moving a note there can't hand out edit access.
 */
export const editableThroughShare = (path: string) => path !== AGENTS_NOTE && (kindOf(path) === "md" || kindOf(path) === "html");

/** The role a request has on a note, member or not. Link visitors never write, and nor does anyone where editableThroughShare says no. */
export function accessOn(access: SharedAccess, note: { id: string | null; path: string }): ShareRole | null {
  if ("member" in access) return access.member;
  const role = roleOn(access.grants, note);
  return role === "editor" && (!access.write || !editableThroughShare(note.path)) ? "viewer" : role;
}

/** The workspace role a member's shared-route requests act with: owners and editors edit, viewers read. */
export const memberShareRole = (role: string): ShareRole => (role === "viewer" ? "viewer" : "editor");
