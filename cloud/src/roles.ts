// What a workspace member's role lets them write. No Workers imports, so tests can load it.

/**
 * Writes a viewer may make: favorites and smart folders can be each person's own, so viewers can
 * star notes and keep smart folders too. The workspace checks that a viewer's smart folders stay
 * theirs (it gets the role as x-ci-role).
 */
const VIEWER_WRITES = new Set(["POST /favorites/star", "POST /favorites/unstar", "PUT /favorites", "POST /smart-folders", "POST /smart-folders/delete"]);

export const viewerMayWrite = (method: string, route: string) => VIEWER_WRITES.has(`${method} ${route}`);
