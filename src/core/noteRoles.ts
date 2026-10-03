// Notes the app sets apart from the rest. No Node imports: the web app uses this too.

/**
 * The note agents read for the vault's conventions: the MCP server sends it as its instructions.
 * It lives in Config/ beside the workspace's settings (schema.ts); vaults from before that keep it
 * at the root, which is read when Config/ has none.
 */
export const AGENTS_NOTE = "Config/AGENTS.md";
/** Where AGENTS.md was before Config/. */
export const ROOT_AGENTS_NOTE = "AGENTS.md";

/** Either place the agents' instructions can be: both are protected the same way. */
export const isAgentsNote = (path: string) => path === AGENTS_NOTE || path === ROOT_AGENTS_NOTE;

/** The agents' instructions in a vault: Config/AGENTS.md, else the root AGENTS.md; "" if neither. */
export function agentsText(read: (path: string) => string | null | undefined): string {
  return read(AGENTS_NOTE) ?? read(ROOT_AGENTS_NOTE) ?? "";
}

/** Notes tagged `start` (the Welcome note) lead the Notes feed until they're archived or lose the tag. */
export const START_TAG = "start";

/** `start`: a note to begin with, first in Notes. `agents`: the agents' instructions, after your own notes. */
export type NoteRole = "start" | "agents";
