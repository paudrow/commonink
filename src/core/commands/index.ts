// Every command, in the order `quire help` lists them. The CLI (src/cli.ts) and the MCP server
// (src/core/tools.ts) are both made from this list, so a feature is reachable from both or it says
// why not (`mcp: { none }`); test/parity.test.ts fails otherwise.
//
// A feature adds its commands as a group of its own (like `contacts` below) and one line here. A
// command that hands back a file (export) returns it as Output.save. Fields a task can carry are in
// TASK_FIELDS (tasks.ts).
import { files, history, trash } from "./history.ts";
import { labels } from "./labels.ts";
import { contacts } from "./contacts.ts";
import { notes } from "./notes.ts";
import { boards, favorites, folders, smartFolders, tags } from "./organize.ts";
import { settings } from "./settings.ts";
import { tasks } from "./tasks.ts";
import { templates } from "./templates.ts";
import { calendar } from "./calendar.ts";
import type { Command } from "./types.ts";

export const GROUPS: ReadonlyArray<{ title: string; commands: Command[] }> = [
  { title: "Notes", commands: notes },
  { title: "Templates", commands: templates },
  { title: "Folders and files", commands: [...folders, ...files] },
  { title: "Tasks and today", commands: tasks },
  { title: "Contacts", commands: contacts },
  { title: "Boards", commands: boards },
  { title: "Tags", commands: tags },
  { title: "Smart folders", commands: smartFolders },
  { title: "Favorites", commands: favorites },
  { title: "History and Trash", commands: [...history, ...trash] },
  { title: "Labels", commands: labels },
  { title: "Calendar", commands: calendar },
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
  "GET /feed": "the Notes page's paging; ls and search list notes",
  "GET /diffs": "History's side-by-side view; diff shows a change",
  "GET /diffstats": "History's line counts; changes shows them",
  "GET /changes/agents": "History's filter chips; changes --by takes an agent's name",
  "GET /tasks/count": "the sidebar's badge; tasks lists them",
  "POST /templates/render": "the editor's Insert template; new (create_from_template) makes a note from one",
  "POST /tags": "the Tags page's adding a tag before any note has it; a tag is made by writing #tag in a note",
  "POST /tags/delete": "the Tags page; tag rename changes a tag everywhere",
  "POST /calendar/google": "connecting a Google calendar signs in to Google, in the app",
  "POST /calendar/events": "making, changing and deleting events is the Calendar page's, for now",
  "POST /calendar/events/update": "making, changing and deleting events is the Calendar page's, for now",
  "POST /calendar/events/delete": "making, changing and deleting events is the Calendar page's, for now",
  "POST /calendar/sources/update": "a calendar's name and color are the Calendar page's",
  "GET /asset-tags": "tags and ls --tag show what an asset is tagged with",
  "GET /favorites": "ls --starred (quire starred) lists them",
  "GET /guide": "the welcome guide in the app",
  "POST /guide": "the welcome guide in the app",
  "GET /live": "the app's live connection",
  "POST /tasks/set": "task update --done ticks a task",
  "GET /delete-check": "the app's confirm before a delete",
  "POST /trash/delete": "deleting for good is only in the app: a command can't tell a person from an agent (#74)",
  "POST /trash/empty": "deleting for good is only in the app: a command can't tell a person from an agent (#74)",
  "POST /workspace/delete": "deleting a whole workspace for good is only in the app, where you type its name to confirm",
};

/** The MCP tool's name, or null if the command isn't a tool. */
export const toolName = (c: Command): string | null => (typeof c.mcp === "string" ? c.mcp : null);

export * from "./types.ts";
