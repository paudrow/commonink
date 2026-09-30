// The MCP tools, shared by the local stdio server (src/mcp.ts) and hosted workspaces (the remote
// /mcp endpoint), so an agent gets the same tools either way.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { QuireError } from "./paths.ts";
import { fmtBacklinks, fmtBoards, fmtChanges, fmtFavorites, fmtList, fmtRead, fmtSearch, fmtSmartFolders, fmtTags, fmtTasks, fmtToday, fmtWrite } from "./format.ts";
import { parseQuery } from "./query.ts";
import { TRASH_DAYS, type Quire } from "./quire.ts";
import { parseAuthorFilter } from "./actor.ts";
import { AGENTS_NOTE } from "./noteRoles.ts";
import { dayRange, fmtEvent, fmtEvents, type Calendar } from "./calendar.ts";
import { notePath } from "./ids.ts";

export interface ToolHost {
  quire: Quire;
  /** Whose favorites and own smart folders the tools read and change. */
  user: string;
  /** Who writes are attributed to, given the name the client connected with. */
  source(client: string | undefined): string;
  /**
   * Whether the caller may use an API route (online: their role in the workspace). Tools whose
   * route they may not use aren't offered. Unset locally, where everything is allowed.
   */
  may?(route: string): boolean;
  /** Whether the caller may make or change shared smart folders (online: editors and owners). Default yes. */
  canEditShared?: boolean;
  /**
   * Online: sharing notes and folders with people outside the workspace, or by link. Unset locally,
   * where there's no one else to share with, and then the sharing tools aren't offered.
   */
  sharing?: {
    list(target: { path?: string; folder?: string }): Promise<string>;
    share(o: { path?: string; folder?: string; email?: string; link?: boolean; role: "viewer" | "editor"; expiresInDays?: number }): Promise<string>;
    unshare(id: string): Promise<string>;
  };
  /** The workspace's calendars; with them, the event tools are offered. */
  calendar?: Calendar;
  /** Where the app is, for a meeting note's link written back to Google. */
  origin?: string;
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
  list_tags: "GET /tags",
  list_tasks: "GET /tasks",
  get_today: "GET /today",
  backlinks: "GET /backlinks",
  recent_changes: "GET /changes",
  read_board: "GET /note",
  list_smart_folders: "GET /smart-folders",
  create_note: "POST /note",
  edit_note: "PUT /note",
  append_to_note: "PUT /note",
  move_note: "POST /move",
  archive_note: "POST /archive",
  delete_note: "POST /delete",
  unarchive_note: "POST /unarchive",
  add_task: "POST /tasks/add",
  move_task: "POST /tasks/move",
  update_task: "POST /tasks/update",
  // A board is text in its note: changing a card changes the note.
  add_card: "PUT /note",
  move_card: "PUT /note",
  edit_card: "PUT /note",
  star_note: "POST /favorites/star",
  unstar_note: "POST /favorites/unstar",
  star_tag: "POST /favorites/star",
  unstar_tag: "POST /favorites/unstar",
  save_smart_folder: "POST /smart-folders",
  delete_smart_folder: "POST /smart-folders/delete",
  list_shares: "GET /shares",
  share_note: "POST /shares",
  unshare_note: "POST /shares/remove",
  list_events: "GET /calendar/events",
  get_event: "GET /calendar/event",
  create_meeting_note: "POST /calendar/meeting-note",
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

async function runAsync(fn: () => Promise<string>): Promise<Result> {
  try {
    return { content: [{ type: "text", text: await fn() }] };
  } catch (e) {
    return { content: [{ type: "text", text: (e as Error).message }], isError: true };
  }
}

const readOnly = { readOnlyHint: true, openWorldHint: false } as const;
const TAG = z.string().optional().describe("Only notes with this tag or a tag under it: work matches #work and #work/acme");
const writes = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;

export function createMcpServer(host: ToolHost): McpServer {
  const { quire, user } = host;
  const canEditShared = host.canEditShared ?? true;
  const agentsMd = quire.files.read(AGENTS_NOTE) ?? "";
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
        tag: TAG,
      },
      annotations: readOnly,
    },
    ({ query, limit, include_archived, tag }) =>
      run(() => {
        quire.sync();
        return fmtSearch(query, quire.search(query, limit ?? 10, include_archived ? "all" : "active", tag));
      }),
  );

  server.registerTool(
    "list_tags",
    {
      title: "List tags",
      description:
        "Every tag in the vault as a tree (tags nest with /), with how many notes, tasks and assets carry each one or a tag under it. " +
        "Tags the user added by name before using them are listed too. " +
        "Use the names with the `tag` filter of search_notes and list_notes.",
      inputSchema: {},
      annotations: readOnly,
    },
    () =>
      run(() => {
        quire.sync();
        return fmtTags(quire.tags());
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
        "List notes in the vault or a folder, the notes and assets with a tag, the most recently modified notes, or the user's " +
        "starred notes (favorites, in their order). Archived notes (under Archive/) are excluded unless requested.",
      inputSchema: {
        folder: z.string().optional(),
        tag: TAG,
        recent: z.number().int().min(1).max(100).optional().describe("If set, list this many most recently modified notes"),
        starred: z.boolean().optional().describe("If set, list the user's favorites instead"),
        smart_folder: z.string().optional().describe("If set, list the notes in this smart folder (name or ID) instead"),
        include_archived: z.boolean().optional(),
      },
      annotations: readOnly,
    },
    ({ folder, tag, recent, starred, smart_folder, include_archived }) =>
      run(() => {
        quire.sync();
        if (starred) return favorites();
        if (smart_folder) {
          const query = parseQuery(quire.findSmartFolder(user, smart_folder).query);
          return fmtList(quire.feed({ ...query, limit: Infinity }).items);
        }
        return fmtList(recent ? quire.recent(recent) : quire.list(folder, include_archived ? "all" : "active", tag));
      }),
  );

  server.registerTool(
    "list_tasks",
    {
      title: "List tasks",
      description:
        "Checkbox tasks across the vault (not archived notes), as their markdown lines with path:line. A task's metadata is tokens in " +
        "its text: due:YYYY-MM-DD, start:YYYY-MM-DD, rec:… (how it repeats), #tag, @person, !high or !low, and done:YYYY-MM-DD once ticked.",
      inputSchema: {
        status: z.enum(["open", "done", "all"]).optional().describe("Default open"),
        folder: z.string().optional(),
        note: z.string().optional().describe("Only this note's tasks"),
        tag: TAG,
        assignee: z.string().optional().describe("Only tasks with this @person"),
        due: z.string().optional().describe("A due date filter: <=today (overdue or due today), tomorrow, >=2026-10-01…"),
      },
      annotations: readOnly,
    },
    ({ status, ...filters }) =>
      run(() => {
        quire.sync();
        const want = status ?? "open";
        return fmtTasks(quire.tasks(filters).filter((t) => want === "all" || t.done === (want === "done")));
      }),
  );

  server.registerTool(
    "get_today",
    {
      title: "Get today",
      description:
        "The day at a glance: open tasks overdue, due today and starting today (repeating ones show their rec:), and whether today's " +
        "journal note (Journal/YYYY-MM-DD.md) exists. A good start for a morning brief.",
      inputSchema: { today: z.string().optional().describe("The day to read, YYYY-MM-DD; default the machine's today") },
      annotations: readOnly,
    },
    ({ today }) =>
      run(() => {
        quire.sync();
        return fmtToday(quire.today(today));
      }),
  );

  server.registerTool(
    "add_task",
    {
      title: "Add task",
      description:
        "Add a task written the way you'd say it: dates and repeats in words become tokens (\"Pay rent every month on the 1st #home\" → " +
        "due:… rec:1st #home; \"call mom tomorrow\", \"next fri\", \"oct 3\", \"in 2 weeks\", \"every other week\", \"last friday of the month\", " +
        "\"every 3 days after done\"). Tokens (due:, !high, @person, #tag) pass through. It goes under ## Tasks in today's daily note " +
        "(Journal/YYYY-MM-DD.md, created if needed), or into the note named with → [[Note]].",
      inputSchema: { text: z.string().describe("The task, e.g. \"Review the PR next fri → [[Launch]] @sam\"") },
      annotations: writes,
    },
    ({ text }) =>
      run(() => {
        const r = quire.addTask(text, source());
        return `Added "- [ ] ${r.text}" to ${r.path}:${r.line}`;
      }),
  );

  server.registerTool(
    "move_task",
    {
      title: "Move task",
      description: "Move a task (and the lines nested under it) to another note, by the path:line and text list_tasks gave. It goes at the end of that note's Tasks section, or of the note.",
      inputSchema: {
        path: z.string(),
        line: z.number().int().min(1),
        text: z.string().describe("The task's text after the checkbox, as list_tasks showed it"),
        to: z.string().describe("The note to move it to"),
      },
      annotations: writes,
    },
    ({ path, line, text, to }) =>
      run(() => {
        const r = quire.moveTask(path, line, text, to, source());
        return `Moved "${r.text}" to ${r.path}:${r.line}`;
      }),
  );

  server.registerTool(
    "update_task",
    {
      title: "Update task",
      description:
        "Tick, untick or change the metadata of one task, by the path:line and text list_tasks gave. Only the fields you pass change: " +
        "a value sets that token, null (or [] for lists) removes it, and the rest of the line stays as the user wrote it. Ticking adds done: with today's date; " +
        "ticking a repeating task (rec:) also adds its next occurrence on the line below, and unticking it straight after takes that back.",
      inputSchema: {
        path: z.string(),
        line: z.number().int().min(1),
        text: z.string().describe("The task's text after the checkbox, as list_tasks showed it (guards against the note having changed)"),
        done: z.boolean().optional().describe("Tick (true) or untick (false)"),
        due: z.string().nullable().optional().describe("YYYY-MM-DD or YYYY-MM-DDTHH:MM"),
        start: z.string().nullable().optional().describe("Hide until this date"),
        rec: z
          .string()
          .nullable()
          .optional()
          .describe(
            "How it repeats, from the due date: daily, weekly, monthly, yearly, 3d, 2w, mon,thu, 2w-mon,thu, 6th, last-day, 1st-tue,3rd-tue, last-fri, mar-1, 1st-mon-mar, day-50; " +
              "a gap after it's done: after-1m, after-10d; or RRULE:FREQ=…;BYDAY=… (COUNT and UNTIL too)",
          ),
        until: z.string().nullable().optional().describe("The repeat's last day, YYYY-MM-DD: no occurrence after it"),
        times: z.number().int().min(1).nullable().optional().describe("How many times the repeat is left to happen, this one included; each tick counts one down"),
        skip: z.boolean().optional().describe("Move a repeating task to its next date without ticking it (on its own: other fields are ignored)"),
        priority: z.enum(["high", "low"]).nullable().optional(),
        assignees: z.array(z.string()).optional().describe("People, without @"),
        tags: z.array(z.string()).optional().describe("Tags, without #"),
      },
      annotations: writes,
    },
    ({ path, line, text, done, skip, ...patch }) =>
      run(() => {
        const r = skip ? quire.skipTask(path, line, text, source()) : quire.updateTask(path, line, text, done === undefined ? patch : { ...patch, checked: done }, source());
        return fmtWrite(r, r.change ? "Updated" : "No change to");
      }),
  );

  const BOARD_HELP =
    "A board is a :::kanban block in a note (closed by :::): its ## headings are columns and its list items are cards, " +
    "with task tokens like tasks. Moving a card into the column named Done ticks it. read_board also lists lines that aren't part of the board (problems): leave them unless the user asks.";
  const CARD = z.string().describe("The card's line number from read_board, or words from its text that only that card has");

  server.registerTool(
    "read_board",
    {
      title: "Read board",
      description: `The Kanban boards in a note, column by column, each card with its line number. ${BOARD_HELP}`,
      inputSchema: { path: z.string() },
      annotations: readOnly,
    },
    ({ path }) =>
      run(() => {
        const { note, boards, unclosed } = quire.boards(path);
        return fmtBoards(note.path, boards, unclosed);
      }),
  );

  server.registerTool(
    "add_card",
    {
      title: "Add card",
      description:
        "Add a card to a column of a Kanban board in a note. The text is the card's line (tokens like due:2026-10-01 @jane #tag, or a [[Note]] link); " +
        "more lines nest under it as details.",
      inputSchema: {
        path: z.string(),
        column: z.string().describe("The column's name, or its number from 1"),
        text: z.string(),
        board: z.number().int().min(1).optional().describe("Which board (from 1), when the note has several with this column"),
        position: z.number().int().min(1).optional().describe("Where in the column (from 1); default last"),
      },
      annotations: writes,
    },
    ({ path, column, text, board, position }) => run(() => fmtWrite(quire.addCard(path, column, text, source(), { board, position }), "Added a card to")),
  );

  server.registerTool(
    "move_card",
    {
      title: "Move card",
      description: "Move a card to another column of its board, or to another place in its column. Moving it into the done column ticks it; out of it, unticks it.",
      inputSchema: {
        path: z.string(),
        card: CARD,
        to_column: z.string().describe("The column's name, or its number from 1"),
        position: z.number().int().min(1).optional().describe("Where in the column (from 1); default last"),
      },
      annotations: writes,
    },
    ({ path, card, to_column, position }) => run(() => fmtWrite(quire.moveCard(path, card, to_column, source(), { position }), "Moved a card in")),
  );

  server.registerTool(
    "edit_card",
    {
      title: "Edit card",
      description:
        "Change a card's text or tick it. The new text replaces the card's line after its checkbox (keep any tokens you want to keep); more lines replace the details nested under it.",
      inputSchema: {
        path: z.string(),
        card: CARD,
        text: z.string().optional(),
        done: z.boolean().optional().describe("Tick (true) or untick (false). Ticking a repeating card (rec:) adds its next one after it, as update_task does."),
      },
      annotations: writes,
    },
    ({ path, card, text, done }) => run(() => fmtWrite(quire.editCard(path, card, { text, done }, source()), "Edited a card in")),
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
    "delete_note",
    {
      title: "Delete note",
      description:
        `Delete notes or assets the user asked to delete: each goes to Trash, where the user can restore it for ${TRASH_DAYS} days. ` +
        "Notes that link to it show the link as missing meanwhile. Prefer archive_note for something that's just done. " +
        "Agents can't delete anything for good.",
      inputSchema: { paths: z.array(z.string()).min(1) },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    ({ paths }) => run(() => quire.delete(paths, source()).map((d) => `Moved ${d.path} to Trash`).join("\n")),
  );

  const sharing = host.sharing;
  if (sharing) {
    const TARGET = {
      path: z.string().optional().describe("The note (path, name or ID)"),
      folder: z.string().optional().describe("Or a folder: the share covers everything in it"),
    };
    server.registerTool(
      "list_shares",
      {
        title: "List shares",
        description: "Who a note or folder is shared with outside the workspace (people and links, with roles and expiry), or everything the workspace shares.",
        inputSchema: TARGET,
        annotations: readOnly,
      },
      ({ path, folder }) => runAsync(() => sharing.list({ path, folder })),
    );
    server.registerTool(
      "share_note",
      {
        title: "Share note",
        description:
          "Share a note or folder with someone outside the workspace by email (people without an account get it when they sign in " +
          "with that email), or with anyone who has the link. Only share what the user asked to share, with whom they said.",
        inputSchema: {
          ...TARGET,
          email: z.string().optional().describe("The person's email address"),
          link: z.boolean().optional().describe("Share with anyone who has the link instead"),
          role: z.enum(["viewer", "editor"]),
          expires_in_days: z.number().int().min(1).max(365).optional().describe("Stop sharing after this many days"),
        },
        annotations: { ...writes, openWorldHint: true },
      },
      ({ path, folder, email, link, role, expires_in_days }) => runAsync(() => sharing.share({ path, folder, email, link, role, expiresInDays: expires_in_days })),
    );
    server.registerTool(
      "unshare_note",
      {
        title: "Stop sharing",
        description: "Stop one share (its id from list_shares): that person, or the link, loses access at once.",
        inputSchema: { id: z.string() },
        annotations: { ...writes, destructiveHint: true },
      },
      ({ id }) => runAsync(() => sharing.unshare(id)),
    );
  }

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
    "star_tag",
    {
      title: "Star tag",
      description:
        "Add tags to the user's favorites, beside their starred notes; clicking one in the app shows every note with that tag " +
        "(or a tag under it). A starred tag follows renames and merges. Only star tags the user asked for.",
      inputSchema: { tags: z.array(z.string()).min(1).describe("Tags, with or without #") },
      annotations: writes,
    },
    ({ tags }) => run(() => (tags.forEach((t) => quire.starTag(user, t)), favorites())),
  );

  server.registerTool(
    "unstar_tag",
    {
      title: "Unstar tag",
      description: "Take tags out of the user's favorites. The tags and their notes don't change.",
      inputSchema: { tags: z.array(z.string()).min(1) },
      annotations: writes,
    },
    ({ tags }) => run(() => (tags.forEach((t) => quire.unstarTag(user, t)), favorites())),
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
    "list_smart_folders",
    {
      title: "List smart folders",
      description:
        "The user's smart folders: saved note queries in the sidebar, each with its query and how many notes match now. " +
        "list_notes with smart_folder lists one's notes.",
      inputSchema: {},
      annotations: readOnly,
    },
    () =>
      run(() => {
        quire.sync();
        return fmtSmartFolders(quire.smartFolders(user));
      }),
  );

  server.registerTool(
    "save_smart_folder",
    {
      title: "Save smart folder",
      description:
        "Create a smart folder (a saved note query in the sidebar), or change one by id. The query uses ::query's keys: " +
        'q="words" folder=Projects tag=work sort=title limit=10 (all optional; a tag includes the tags under it). Only save one the user asked for.',
      inputSchema: {
        name: z.string(),
        query: z.string(),
        just_me: z.boolean().optional().describe("Keep it the user's own instead of sharing it with the workspace"),
        id: z.string().optional().describe("Change this smart folder instead of creating one"),
      },
      annotations: writes,
    },
    ({ name, query, just_me, id }) =>
      run(() => {
        quire.saveSmartFolder(user, { id, name, query, shared: !just_me }, canEditShared);
        return fmtSmartFolders(quire.smartFolders(user));
      }),
  );

  server.registerTool(
    "delete_smart_folder",
    {
      title: "Delete smart folder",
      description: "Delete a smart folder by name or ID. The notes in it don't change.",
      inputSchema: { smart_folder: z.string() },
      annotations: { ...writes, destructiveHint: true },
    },
    ({ smart_folder }) => run(() => fmtSmartFolders(quire.deleteSmartFolder(user, smart_folder, canEditShared))),
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
        "`path` (a path, ID or note URL) narrows it to one note, including its history under earlier names. " +
        "`by` narrows it to people's own changes (`people`), any agent's (`ai`), or one agent's (its name).",
      inputSchema: {
        since: z.string().optional(),
        path: z.string().optional(),
        limit: z.number().int().min(1).max(200).optional(),
        by: z.string().optional().describe('"people", "ai", or an agent\'s name'),
      },
      annotations: readOnly,
    },
    ({ since, path, limit, by }) => run(() => fmtChanges(quire.changes({ since, path, limit: limit ?? 30, by: parseAuthorFilter(by) }), quire)),
  );

  if (host.calendar) calendarTools(server, host.calendar, host, source);
  return mcp;
}

const ZONE = z.string().optional().describe("IANA time zone to write times in, e.g. America/Los_Angeles (default: this server's)");

/** Calendar events: linked records from the workspace's calendar feeds (not notes). */
function calendarTools(server: Pick<McpServer, "registerTool">, cal: Calendar, host: ToolHost, source: () => string) {
  const viewer = { user: host.user, canEdit: host.canEditShared ?? true };
  const zoneOf = (z?: string) => z || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

  server.registerTool(
    "list_events",
    {
      title: "List calendar events",
      description:
        "Events from the calendars this workspace subscribes to (and the user's own), soonest first, for a range of days. Each has an id " +
        "for get_event and create_meeting_note, and the meeting note it's linked to, if any. Events are records, not notes.",
      inputSchema: {
        from: z.string().optional().describe("First day, YYYY-MM-DD (default: today)"),
        days: z.number().int().min(1).max(90).optional().describe("How many days (default 7)"),
        query: z.string().optional().describe("Only events whose title contains this"),
        time_zone: ZONE,
      },
      annotations: readOnly,
    },
    async ({ from, days, query, time_zone }) =>
      runAsync(async () => {
        const zone = zoneOf(time_zone);
        await cal.syncDue(); // anything that's come due since, so the list isn't stale
        const range = dayRange(from, days ?? 7, zone);
        return fmtEvents(cal.events(viewer, { ...range, zone, q: query }), cal.sources(viewer), zone, range);
      }),
  );

  server.registerTool(
    "get_event",
    {
      title: "Get calendar event",
      description: "One event in full: time, place, organizer, attendees, description, and its meeting note if it has one.",
      inputSchema: { id: z.string().describe("The event's id from list_events"), time_zone: ZONE },
      annotations: readOnly,
    },
    ({ id, time_zone }) =>
      run(() => {
        const ev = cal.event(id, viewer);
        if (!ev) throw new QuireError(`No event ${id}; list_events gives the ids`);
        return fmtEvent(ev, cal.sources(viewer), zoneOf(time_zone));
      }),
  );

  server.registerTool(
    "create_meeting_note",
    {
      title: "Create meeting note",
      description:
        "The event's meeting note: a new note in Meetings/ (from Templates/Meeting note.md if there is one) with its time, place, " +
        "attendees, agenda and a link back to the event, linked to the event. If the event already has one, returns that note instead.",
      inputSchema: { id: z.string().describe("The event's id from list_events"), time_zone: ZONE },
      annotations: writes,
    },
    async ({ id, time_zone }) =>
      runAsync(async () => {
        const r = cal.meetingNote(host.quire, id, viewer, { timeZone: zoneOf(time_zone), source: source() });
        if (!r.created) return `The event already has a meeting note: ${r.path}`;
        const linked = host.origin && r.noteId ? await cal.linkBack(id, viewer, `${host.origin}${notePath(host.quire.read(r.path).title, r.noteId)}`) : null;
        const back = !linked ? "" : linked.ok ? "; its link was added to the event in Google Calendar" : `; the link couldn't be added in Google Calendar (${linked.error})`;
        return `Created ${r.path}, linked to the event${back}`;
      }),
  );
}
