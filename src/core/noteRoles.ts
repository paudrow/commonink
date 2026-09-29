// Notes the app sets apart from the rest. No Node imports: the web app uses this too.

/** The note agents read for the vault's conventions: the MCP server sends it as its instructions. */
export const AGENTS_NOTE = "AGENTS.md";

/** Notes tagged `start` (the Welcome note) lead the Notes feed until they're archived or lose the tag. */
export const START_TAG = "start";

/** `start`: a note to begin with, first in Notes. `agents`: the agents' instructions, after your own notes. */
export type NoteRole = "start" | "agents";
