// Who may use which route online. The Worker checks this before it forwards a request to a
// workspace, and the workspace checks it again. A route missing from here is refused, so a new API
// route stays unreachable online until it's given a role. No Workers imports, so tests can load it.

export type Role = "owner" | "editor" | "viewer";

const RANK: Record<Role, number> = { viewer: 0, editor: 1, owner: 2 };

/**
 * Workspace routes (after /api/w/<id>) and the least role that may use each. Reads are open to
 * viewers. So are writes to what can be each person's own: their favorites (notes and tags), and
 * their smart folders. The workspace checks that a viewer's smart folders stay theirs
 * (`canEditShared` in src/core/api.ts).
 */
export const WORKSPACE_ROUTES = {
  "GET /info": "viewer",
  "GET /notes": "viewer",
  "GET /note": "viewer",
  "GET /resolve": "viewer",
  "GET /search": "viewer",
  "GET /feed": "viewer",
  "GET /backlinks": "viewer",
  "GET /changes": "viewer",
  "GET /changes/agents": "viewer",
  "GET /diffs": "viewer",
  "GET /diffstats": "viewer",
  "GET /diff": "viewer",
  "GET /tasks": "viewer",
  "GET /tasks/count": "viewer",
  "GET /favorites": "viewer",
  "GET /smart-folders": "viewer",
  "GET /tags": "viewer",
  "GET /asset-tags": "viewer",
  "GET /today": "viewer",
  "GET /guide": "viewer",
  "GET /templates": "viewer",
  // Filling a template in only reads it; inserting the text is an edit to the note.
  "POST /templates/render": "viewer",
  "GET /files/*": "viewer",
  "GET /file-resolve": "viewer",
  "GET /live": "viewer",
  "POST /favorites/star": "viewer",
  "POST /favorites/unstar": "viewer",
  "PUT /favorites": "viewer",
  "POST /smart-folders": "viewer",
  "POST /smart-folders/delete": "viewer",
  "PUT /note": "editor",
  "POST /note": "editor",
  "POST /tasks/set": "editor",
  "POST /tasks/update": "editor",
  "POST /tasks/add": "editor",
  "POST /tasks/remove": "editor",
  "POST /tasks/move": "editor",
  "POST /today/journal": "editor",
  "POST /tags/rename": "editor",
  "PUT /asset-tags": "editor",
  "POST /move": "editor",
  "POST /restore": "editor",
  "POST /guide": "editor",
  "POST /notes/from-template": "editor",
  "POST /archive": "editor",
  "POST /unarchive": "editor",
  // Trash: editors delete and restore, and only they see what's in it; deleting for good is the owner's.
  "GET /delete-check": "editor",
  "POST /delete": "editor",
  "POST /delete-folder": "editor",
  "GET /trash": "editor",
  "POST /trash/restore": "editor",
  "POST /trash/delete": "owner",
  "POST /trash/empty": "owner",
  "POST /upload": "editor",
  // Calendars (src/core/calendar.ts). Everyone sees the workspace's calendars and may read them again
  // (at most once a minute each); subscribing, changing and making meeting notes are editors'. A
// person's own calendars are theirs to change whatever their role (checked in the calendar itself).
  "GET /calendar/sources": "viewer",
  "GET /calendar/events": "viewer",
  "GET /calendar/event": "viewer",
  "POST /calendar/refresh": "viewer",
  // A person's own Google calendar, which only they see: anyone may add theirs (see connections.ts),
  // and change or remove it. The calendar itself checks that a viewer only changes their own.
  "POST /calendar/google": "viewer",
  "POST /calendar/sources/update": "viewer",
  "POST /calendar/sources/remove": "viewer",
  "POST /calendar/sources": "editor",
  "POST /calendar/meeting-note": "editor",
  // The workspace's settings (cloud/src/admin.ts). Everyone sees who's in it and may leave; the rest is the owner's.
  "GET /members": "viewer",
  "POST /leave": "viewer",
  "POST /members/role": "owner",
  "POST /members/remove": "owner",
  "POST /invites": "owner",
  "GET /invites": "owner",
  "POST /invites/revoke": "owner",
  "GET /workspace/log": "owner",
  "POST /workspace/rename": "owner",
  "POST /workspace/delete": "owner",
} as const satisfies Record<string, Role>;

/** Routes for whoever is signed in, whatever workspace they're in. */
export const ACCOUNT_ROUTES = [
  "GET /api/me",
  "POST /api/workspaces",
  "GET /api/unfurl",
  "GET /api/note-ids/*",
  "POST /api/sign-out-everywhere",
  "GET /api/agents",
  "POST /api/agents/revoke",
  "GET /api/google",
  "GET /api/google/calendars",
  "POST /api/google/disconnect",
] as const;
export type AccountRoute = (typeof ACCOUNT_ROUTES)[number];

/** "GET /files/a/b.png" → "GET /files/*". HEAD is a GET. */
export function routeKey(method: string, path: string): string {
  const m = method === "HEAD" ? "GET" : method;
  if (path.startsWith("/files/")) return `${m} /files/*`;
  if (path.startsWith("/api/note-ids/")) return `${m} /api/note-ids/*`;
  return `${m} ${path}`;
}

export function isAccountRoute(key: string): key is AccountRoute {
  return (ACCOUNT_ROUTES as readonly string[]).includes(key);
}

/** Whether `role` may use a workspace route: "unknown" if the route isn't one. */
export function access(role: Role | null, method: string, path: string): "allowed" | "forbidden" | "unknown" {
  const need = (WORKSPACE_ROUTES as Record<string, Role>)[routeKey(method, path)];
  if (!need) return "unknown";
  return role && RANK[role] >= RANK[need] ? "allowed" : "forbidden";
}

/** A role from a header or a row, or null if it isn't one. */
export const asRole = (s: string | null | undefined): Role | null => (s && Object.hasOwn(RANK, s) ? (s as Role) : null);
