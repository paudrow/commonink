// Who may use which route online. The Worker checks this before it forwards a request to a
// workspace, and the workspace checks it again. A route missing from here is refused, so a new API
// route stays unreachable online until it's given a role. No Workers imports, so tests can load it.

export type Role = "owner" | "editor" | "viewer";

const RANK: Record<Role, number> = { viewer: 0, editor: 1, owner: 2 };

/**
 * Workspace routes (after /api/w/<id>) and the least role that may use each. Reads are open to
 * viewers. So are writes to what's each person's own (their favorites).
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
  "GET /diffs": "viewer",
  "GET /diff": "viewer",
  "GET /tasks": "viewer",
  "GET /favorites": "viewer",
  "GET /files/*": "viewer",
  "GET /file-resolve": "viewer",
  "GET /live": "viewer",
  "POST /favorites/star": "viewer",
  "POST /favorites/unstar": "viewer",
  "PUT /favorites": "viewer",
  "PUT /note": "editor",
  "POST /note": "editor",
  "POST /tasks/set": "editor",
  "POST /move": "editor",
  "POST /restore": "editor",
  "POST /archive": "editor",
  "POST /unarchive": "editor",
  "POST /upload": "editor",
  "POST /invites": "owner",
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
