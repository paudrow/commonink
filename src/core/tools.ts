// The MCP tools, shared by the local stdio server (src/mcp.ts) and hosted workspaces (the remote
// /mcp endpoint), so an agent gets the same tools either way.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { QuireError } from "./paths.ts";
import { fmtBacklinks, fmtChanges, fmtFavorites, fmtList, fmtRead, fmtSearch, fmtWrite } from "./format.ts";
import type { Quire } from "./quire.ts";

export interface ToolHost {
  quire: Quire;
  /** Whose favorites the tools read and change. */
  user: string;
  /** Who writes are attributed to, given the name the client connected with. */
  source(client: string | undefined): string;
  /**
   * Whether the caller may use an API route (online: their role in the workspace). Tools whose
   * route they may not use aren't offered. Unset locally, where everything is allowed.
   */
  may?(route: string): boolean;
}

/**
 * The API route each tool is equivalent to. Online, a tool is offered only to someone whose role
 * allows that route (cloud/src/access.ts), so MCP can't do more than the app. A tool missing here
 * fails at startup.
 */
export const TOOL_ROUTES: Record<string, string> = {
  search_notes: "GET /search",
  read_note: "GET /note",
  list_notes: "GET /notes",
  backlinks: "GET /backlinks",
  recent_changes: "GET /changes",
  create_note: "POST /note",
  edit_note: "PUT /note",
  append_to_note: "PUT /note",
  move_note: "POST /move",
  archive_note: "POST /archive",
  unarchive_note: "POST /unarchive",
  star_note: "POST /favorites/star",
  unstar_note: "POST /favorites/unstar",
};

type Result = { content: Array<{ type: "text"; text: string }>; isError?: boolean };
function run(fn: () => string): Result {
  try {
    return { content: [{ type: "text", text: fn() }] };
  } catch (e) {
    const msg = e instanceof QuireError ? e.message : `Unexpected error: ${(e as Error).message}`;
    return { content: [{ type: "text", text: msg }], isError: true };
  }
}

const readOnly = { readOnlyHint: true, openWorldHint: false } as const;
const writes = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;

export function createMcpServer(host: ToolHost): McpServer {
  const { quire, user } = host;
  const agentsMd = quire.files.read("AGENTS.md") ?? "";
  const mcp = new McpServer(
    { name: "quire", version: "0.1.0" },
    {
      instructions: [
        "Quire is the user's markdown notes vault. Notes are plain .md files (some .html notes); paths are vault-relative.",
        "Find before you write: search_notes, then read_note. Change existing notes with edit_note (small exact replacements); create_note is for new notes.",
        "Link notes with [[Note name]] and embed with ![[Note name]]. The user may be editing at the same time; if an edit fails, re-read and retry.",
        agentsMd && `\nVault conventions (AGENTS.md):\n${agentsMd}`,
      ]
        .filter(Boolean)
        .join("\n"),
    },
  );

  /** Every write is attributed to the connected client so the UI can show who changed what. */
  const source = () => host.source(mcp.server.getClientVersion()?.name);
  const favorites = () => fmtFavorites(quire.favorites(user));

  // Registers only the tools this caller's role allows.
  const server = {
    registerTool: ((name: string, config: unknown, cb: unknown) => {
      const route = TOOL_ROUTES[name];
      if (!route) throw new Error(`MCP tool ${name} has no route in TOOL_ROUTES`);
      if (!host.may || host.may(route)) (mcp.registerTool as (n: string, c: unknown, f: unknown) => unknown)(name, config, cb);
    }) as McpServer["registerTool"],
  };

  server.registerTool(
    "search_notes",
    {
      title: "Search notes",
      description:
        "Full-text search across the vault (titles, paths, bodies; prefix matching). Returns paths with matching line numbers.",
      inputSchema: {
        query: z.string().describe("Words to search for"),
        limit: z.number().int().min(1).max(50).optional().describe("Max results (default 10)"),
        include_archived: z.boolean().optional().describe("Also search archived notes"),
      },
      annotations: readOnly,
    },
    ({ query, limit, include_archived }) =>
      run(() => {
        quire.sync();
        return fmtSearch(query, quire.search(query, limit ?? 10, include_archived ? "all" : "active"));
      }),
  );

  server.registerTool(
    "read_note",
    {
      title: "Read note",
      description:
        "Read a note with line numbers. `path` may be a vault path, a path without extension, or a [[wikilink]] name. " +
        "The returned version can be passed to edit_note as base_version.",
      inputSchema: {
        path: z.string(),
        offset: z.number().int().min(1).optional().describe("First line to return (1-based)"),
        limit: z.number().int().min(1).optional().describe("Number of lines to return"),
      },
      annotations: readOnly,
    },
    ({ path, offset, limit }) => run(() => fmtRead(quire.read(path), offset, limit)),
  );

  server.registerTool(
    "list_notes",
    {
      title: "List notes",
      description:
        "List notes in the vault or a folder, the most recently modified notes, or the user's starred notes (favorites, in their order). " +
        "Archived notes (under Archive/) are excluded unless requested.",
      inputSchema: {
        folder: z.string().optional(),
        recent: z.number().int().min(1).max(100).optional().describe("If set, list this many most recently modified notes"),
        starred: z.boolean().optional().describe("If set, list the user's favorites instead"),
        include_archived: z.boolean().optional(),
      },
      annotations: readOnly,
    },
    ({ folder, recent, starred, include_archived }) =>
      run(() => {
        quire.sync();
        if (starred) return favorites();
        return fmtList(recent ? quire.recent(recent) : quire.list(folder, include_archived ? "all" : "active"));
      }),
  );

  server.registerTool(
    "create_note",
    {
      title: "Create note",
      description: "Create a new note. `.md` is added if no extension is given. Fails if the note exists.",
      inputSchema: { path: z.string(), content: z.string() },
      annotations: writes,
    },
    ({ path, content }) => run(() => fmtWrite(quire.create(path, content, source()), "Created")),
  );

  server.registerTool(
    "edit_note",
    {
      title: "Edit note",
      description:
        "Replace an exact string in a note. old_string must match exactly once (include surrounding lines to disambiguate) " +
        "unless replace_all is set. Pass base_version from read_note to guard against concurrent edits.",
      inputSchema: {
        path: z.string(),
        old_string: z.string(),
        new_string: z.string(),
        replace_all: z.boolean().optional(),
        base_version: z.string().optional(),
      },
      annotations: writes,
    },
    (a) =>
      run(() =>
        fmtWrite(
          quire.edit(
            a.path,
            { oldString: a.old_string, newString: a.new_string, replaceAll: a.replace_all, baseVersion: a.base_version },
            source(),
          ),
          "Edited",
        ),
      ),
  );

  server.registerTool(
    "append_to_note",
    {
      title: "Append to note",
      description: "Append markdown to the end of a note (good for logs, journals, inboxes).",
      inputSchema: { path: z.string(), text: z.string() },
      annotations: writes,
    },
    ({ path, text }) => run(() => fmtWrite(quire.append(path, text, source()), "Appended to")),
  );

  server.registerTool(
    "move_note",
    {
      title: "Move / rename note",
      description: "Move or rename a note and rewrite every link and embed that points to it.",
      inputSchema: { from: z.string(), to: z.string() },
      annotations: writes,
    },
    ({ from, to }) =>
      run(() => {
        const r = quire.move(from, to, source());
        return `Moved to ${r.path}.${r.updated.length ? ` Updated links in: ${r.updated.join(", ")}` : ""}`;
      }),
  );

  server.registerTool(
    "archive_note",
    {
      title: "Archive note",
      description:
        "Archive notes that are done or no longer active: moves each under Archive/ (keeping its path) so it drops out of " +
        "search and listings. Links to it keep working, and unarchive_note reverses it.",
      inputSchema: { paths: z.array(z.string()).min(1) },
      annotations: writes,
    },
    ({ paths }) => run(() => paths.map((p) => `Archived → ${quire.archive(p, source()).path}`).join("\n")),
  );

  server.registerTool(
    "star_note",
    {
      title: "Star note",
      description:
        "Add notes to the user's favorites, which the app shows at the top of the sidebar. Stars follow a note through renames, " +
        "moves and archiving. Only star notes the user asked for.",
      inputSchema: { paths: z.array(z.string()).min(1) },
      annotations: writes,
    },
    ({ paths }) => run(() => (paths.forEach((p) => quire.star(user, p)), favorites())),
  );

  server.registerTool(
    "unstar_note",
    {
      title: "Unstar note",
      description: "Take notes out of the user's favorites. The notes themselves don't change.",
      inputSchema: { paths: z.array(z.string()).min(1) },
      annotations: writes,
    },
    ({ paths }) => run(() => (paths.forEach((p) => quire.unstar(user, p)), favorites())),
  );

  server.registerTool(
    "unarchive_note",
    {
      title: "Unarchive note",
      description: "Move archived notes back to where they were.",
      inputSchema: { paths: z.array(z.string()).min(1) },
      annotations: writes,
    },
    ({ paths }) => run(() => paths.map((p) => `Unarchived → ${quire.unarchive(p, source()).path}`).join("\n")),
  );

  server.registerTool(
    "backlinks",
    {
      title: "Backlinks",
      description: "List notes that link to or embed the given note, with the linking line.",
      inputSchema: { path: z.string() },
      annotations: readOnly,
    },
    ({ path }) =>
      run(() => {
        quire.sync();
        return fmtBacklinks(path, quire.backlinks(path));
      }),
  );

  server.registerTool(
    "recent_changes",
    {
      title: "Recent changes",
      description:
        "What changed in the vault and who changed it (you, the user, or other agents). " +
        "`since` is an ISO timestamp or a change id from a previous call — use it to catch up. " +
        "`path` (a path, ID or note URL) narrows it to one note, including its history under earlier names.",
      inputSchema: {
        since: z.string().optional(),
        path: z.string().optional(),
        limit: z.number().int().min(1).max(200).optional(),
      },
      annotations: readOnly,
    },
    ({ since, path, limit }) => run(() => fmtChanges(quire.changes({ since, path, limit: limit ?? 30 }))),
  );

  return mcp;
}
