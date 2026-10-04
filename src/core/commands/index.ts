// Every command, in the order `commonink help` lists them. The CLI (src/cli.ts) and the MCP server
// (src/core/tools.ts) are both made from this list, so a feature is reachable from both or it says
// why not (`mcp: { none }`); test/parity.test.ts fails otherwise.
//
// Names follow one grammar, which the same test checks: `<noun> <verb>` on the CLI (`task add`; a verb
// alone is the note's, `edit`) and `<verb>_<noun>` over MCP (`add_task`, `edit_note`), with the nouns
// the app uses (NOUNS) and a fixed set of verbs (VERBS). A command that's renamed keeps its old names
// in `was`, so scripts and agents that call them still work.
//
// A feature adds its commands as a group of its own (like `contacts` below) and one line here. A
// command that hands back a file (export) returns it as Output.save. Fields a task can carry are in
// TASK_FIELDS (tasks.ts).
import { files, history, trash } from "./history.ts";
import { labels } from "./labels.ts";
import { contacts } from "./contacts.ts";
import { notes } from "./notes.ts";
import { properties } from "./properties.ts";
import { boards, favorites, folders, smartFolders, tags } from "./organize.ts";
import { settings } from "./settings.ts";
import { sharing } from "./sharing.ts";
import { tasks } from "./tasks.ts";
import { templates } from "./templates.ts";
import { calendar } from "./calendar.ts";
import { decisions } from "./decisions.ts";
import type { Command } from "./types.ts";

export const GROUPS: ReadonlyArray<{ title: string; commands: Command[] }> = [
  { title: "Notes", commands: notes },
  { title: "Templates", commands: templates },
  { title: "Folders and assets", commands: [...folders, ...files] },
  { title: "Tasks and today", commands: tasks },
  { title: "Decisions", commands: decisions },
  { title: "Contacts", commands: contacts },
  { title: "Boards", commands: boards },
  { title: "Tags", commands: tags },
  { title: "Properties", commands: properties },
  { title: "Views", commands: smartFolders },
  { title: "Starred", commands: favorites },
  { title: "History and Trash", commands: [...history, ...trash] },
  { title: "Versions", commands: labels },
  { title: "Calendar", commands: calendar },
  { title: "Sharing (hosted)", commands: sharing },
  { title: "Workspace settings (hosted)", commands: settings },
];

export const COMMANDS: readonly Command[] = GROUPS.flatMap((g) => g.commands);

/**
 * The app's API routes that no command stands for, and why. Every other route has a command, so the
 * CLI and agents can do what the app does; test/parity.test.ts checks the two lists cover them all.
 */
export const APP_ONLY: Readonly<Record<string, string>> = {
  "GET /info": "the app's own start-up",
  "GET /resolve": "every command resolves a note's name itself",
  "GET /file-resolve": "the app's way to show an embedded file",
  "GET /feed": "the Notes page's paging; list and search list notes",
  "GET /properties": "a view's settings suggest the properties notes have; get_note shows a note's",
  "GET /diffs": "History's side-by-side view; change get shows a change",
  "GET /diffstats": "History's line counts; change list shows them",
  "GET /changes/agents": "History's filter chips; change list --by takes an agent's name",
  "GET /changes/away": "the While you were away line on Notes and Today; change list --by ai --since lists the same changes",
  "GET /tasks/count": "the sidebar's badge; task list lists them",
  "GET /mentions": "the side panel's Unlinked mentions; search finds where a name is written",
  "POST /mentions/link": "the side panel's Link button; edit_note writes any link",
  "POST /templates/render": "the editor's Insert template; template use (use_template) makes a note from one",
  "POST /tags": "the Tags page's adding a tag before any note has it; a tag is made by writing #tag in a note",
  "POST /tags/delete": "the Tags page; tag rename changes a tag everywhere",
  "POST /calendar/google": "connecting a Google calendar signs in to Google, in the app",
  "POST /calendar/events": "making, changing and deleting events is the Calendar page's, for now",
  "POST /calendar/events/update": "making, changing and deleting events is the Calendar page's, for now",
  "POST /calendar/events/delete": "making, changing and deleting events is the Calendar page's, for now",
  "POST /calendar/sources/update": "a calendar's name and color are the Calendar page's",
  "GET /asset-tags": "tag list and list --tag show what an asset is tagged with",
  "GET /favorites": "list --starred (commonink starred) lists them",
  "GET /guide": "the welcome guide in the app",
  "POST /guide": "the welcome guide in the app",
  "GET /live": "the app's live connection",
  "POST /tasks/set": "task update --done ticks a task",
  "GET /delete-check": "the app's confirm before a delete",
  "POST /trash/delete": "deleting for good is only in the app: a command can't tell a person from an agent (#74)",
  "POST /trash/empty": "deleting for good is only in the app: a command can't tell a person from an agent (#74)",
  "POST /shares/update": "changing a share's role or expiry is the share dialog's; unshare and share again",
  // Whether agents may share by link or with editors: an agent (or a command, which can't tell a person from one) can't widen its own reach.
  "GET /workspace/settings": "whether agents may share by link, and whether the app is gamified, are the owner's call, in the app's workspace settings",
  "POST /workspace/settings": "whether agents may share by link, and whether the app is gamified, are the owner's call, in the app's workspace settings",
  "POST /workspace/delete": "deleting a whole workspace for good is only in the app, where you type its name to confirm",
};

/** The MCP tool's name, or null if the command isn't a tool. */
export const toolName = (c: Command): string | null => (typeof c.mcp === "string" ? c.mcp : null);

/** The verbs every kind of thing shares, then the ones only some have. */
export const VERBS: readonly string[] = [
  "list", "get", "create", "update", "delete",
  "add", "answer", "append", "archive", "ask", "check", "compare", "download", "edit", "export", "import", "leave", "merge", "move", "name", "open", "order",
  "refresh", "remove", "rename", "replace", "restore", "revoke", "save", "search", "set", "share", "star", "subscribe", "sync", "tag", "unarchive", "unshare",
  "unstar", "unsubscribe", "upload", "use", "withdraw", "write",
];
/** What commands act on, by the app's names for them. A CLI command with no noun acts on a note. */
export const NOUNS: readonly string[] = [
  "note", "backlink", "missing-link", "checkup", "template", "folder", "asset", "drive", "task", "today", "journal", "decision", "contact", "google-contacts",
  "board", "card", "tag", "property", "property-type", "view", "starred", "change", "trash", "version", "event", "meeting-note", "calendar", "share", "member",
  "member-role", "invite", "workspace", "log",
];

const BY_CLI = new Map(COMMANDS.flatMap((c) => [c.cli, ...(c.was?.cli ?? [])].map((words) => [words, c] as const)));
/** The command CLI words name, by its name now or one it had before (an older CLI sends those to a hosted workspace). */
export const commandByCli = (words: string): Command | undefined => BY_CLI.get(words);

/** Each MCP tool name from before a rename, and the tool's name now. */
export const RENAMED_TOOLS: Readonly<Record<string, string>> = Object.fromEntries(COMMANDS.flatMap((c) => (toolName(c) ? (c.was?.mcp ?? []).map((old) => [old, toolName(c)!]) : [])));

export * from "./types.ts";
