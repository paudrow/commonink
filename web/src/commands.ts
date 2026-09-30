// Everything you can do from ⌘K, and every keyboard shortcut: one registry that the palette's
// Commands section and the shortcut sheet (?) both read. main.ts supplies the state and the actions.
import { fuzzyScore } from "./fuzzy.ts";
import { CALENDAR_KEYS } from "./calendar/keys.ts";

export type Area = "Global" | "Notes page" | "Calendar" | "Editor" | "Vim" | "Tasks" | "Split view";
export const AREAS: Area[] = ["Global", "Notes page", "Calendar", "Editor", "Vim", "Tasks", "Split view"];

/** Keys as CodeMirror writes them ("Mod-Shift-e", "Mod-Alt-\\"), or typed literally ("?", "gd", ":w"). */
export interface Shortcut {
  keys: string[];
  label: string;
  area: Area;
}

export interface Command {
  id: string;
  title: string;
  /** More words it answers to. */
  keywords?: string;
  icon?: string;
  /** Its shortcuts (alternatives); the palette shows the first. */
  keys?: string[];
  /** Where the shortcut sheet lists it (Global by default). */
  area?: Area;
  /** Offered in ⌘K right now. Its shortcut stays on the sheet either way. */
  available?: boolean;
  run: () => unknown;
}

export type Page = "notes" | "tasks" | "calendar" | "tags" | "assets" | "history" | "archive" | "trash";

/** What the registry needs from the app: a snapshot of its state, and the actions to run. */
export interface App {
  /** The note in the focused pane. */
  note: { kind: "md" | "html" | "asset"; starred: boolean; archived: boolean } | null;
  vim: boolean;
  /** In vim, j and k move by the line on screen. */
  vimDisplayLines: boolean;
  lineNumbers: boolean;
  split: boolean;
  focusMode: boolean;
  htmlMode: "preview" | "source";
  /** A note tagged `start` exists. */
  hasStart: boolean;
  /** The focused pane has somewhere to go back / forward to. */
  canBack: boolean;
  canForward: boolean;
  /** The cursor is on a link (a [[link]] or a markdown link). */
  onLink: boolean;
  /** Can delete notes (not a viewer online). */
  canDelete: boolean;
  /** Can add calendars (not a viewer online). */
  canSubscribe: boolean;
  /** Google Calendar works on this server and isn't connected yet. */
  canConnectGoogle: boolean;
  /** How many collapsible sections the focused note has. */
  folds: number;
  /** Online, the account menu's actions; locally, none. */
  account: Array<{ label: string; icon: string; run: () => unknown; workspace?: boolean; current?: boolean }>;
  newNote(): void;
  /** Pick a template, answer its questions, and open the new note. */
  newFromTemplate(): void;
  /** A new note that holds a Kanban board. */
  newBoard(): void;
  newFolder(): void;
  newTag(): void;
  go(page: Page): void;
  filterNotes(): void;
  quickAdd(): void;
  /** The Calendar page, with the Calendars dialog open at its link field. */
  subscribeCalendar(): void;
  refreshCalendars(): void;
  connectGoogle(): void;
  toggleTheme(): void;
  toggleVim(): void;
  toggleVimDisplayLines(): void;
  toggleLineNumbers(): void;
  togglePanel(): void;
  toggleFocus(): void;
  toggleSplit(): void;
  toggleHtml(): void;
  star(): void;
  archive(): void;
  delete(): void;
  move(): void;
  /** Put the cursor on what names the note (its heading), or ask for a name. */
  rename(): void;
  noteHistory(): void;
  gettingStarted(): void;
  shortcuts(): void;
  /** Back or forward through what the focused pane has shown. */
  back(): void;
  forward(): void;
  /** Follow the link under the cursor. */
  followLink(): void;
  /** Open or close every collapsible section in the focused note. */
  foldAll(open: boolean): void;
}

export function appCommands(app: App): Command[] {
  const note = app.note;
  const text = !!note && note.kind !== "asset";
  const go = (page: Page, title: string, icon: string, keywords = ""): Command => ({ id: `go:${page}`, title: `Go to ${title}`, keywords: `open show page ${keywords}`, icon, run: () => app.go(page) });
  return [
    { id: "new-note", title: "New note", keywords: "create add page", icon: "plus", run: app.newNote },
    { id: "new-from-template", title: "New note from template…", keywords: "template meeting create add from boilerplate", icon: "file", available: app.canDelete, run: app.newFromTemplate },
    { id: "new-board", title: "New board", keywords: "create add kanban columns cards trello project", icon: "kanban", run: app.newBoard },
    { id: "new-folder", title: "New folder", keywords: "create add directory", icon: "folderPlus", run: app.newFolder },
    { id: "new-tag", title: "New tag", keywords: "create add label hashtag", icon: "hash", available: app.canDelete, run: app.newTag },
    { id: "quick-add", title: "Add a task", keywords: "quick add todo new task", icon: "task", keys: ["Mod-Shift-."], area: "Tasks", run: app.quickAdd },
    go("notes", "Notes", "feed", "home all"),
    { id: "filter-notes", title: "Filter notes", keywords: "search find notes page", icon: "search", keys: ["Mod-Shift-f"], run: app.filterNotes },
    go("tasks", "Tasks", "task", "todo checklist"),
    go("calendar", "Calendar", "calendar", "events meetings schedule agenda month week day"),
    { id: "subscribe-calendar", title: "Subscribe to a calendar…", keywords: "calendar add ics webcal ical feed google outlook subscribe", icon: "calendar", available: app.canSubscribe, run: app.subscribeCalendar },
    { id: "connect-google", title: "Connect Google Calendar", keywords: "google calendar gcal account events", icon: "calendar", available: app.canConnectGoogle, run: app.connectGoogle },
    { id: "refresh-calendars", title: "Refresh calendars", keywords: "calendar sync reload events update", icon: "reset", run: app.refreshCalendars },
    go("tags", "Tags", "hash", "rename merge"),
    go("assets", "Assets", "grid", "files images uploads attachments"),
    go("history", "History", "history", "changes activity versions"),
    go("archive", "Archive", "archive", "archived"),
    { ...go("trash", "Trash", "trash", "deleted restore bin recycle"), available: app.canDelete },
    { id: "theme", title: "Toggle theme", keywords: "dark light mode appearance colors", icon: "moon", run: app.toggleTheme },
    { id: "vim", title: app.vim ? "Turn vim keys off" : "Turn vim keys on", keywords: "vim keybindings modal editing toggle", icon: "code", run: app.toggleVim },
    {
      id: "vim-display-lines",
      title: app.vimDisplayLines ? "Vim: j and k move by line in the file" : "Vim: j and k move by line on screen (gj, gk)",
      keywords: "vim gj gk wrap wrapped visual display screen lines jk movement",
      icon: "code",
      available: app.vim,
      run: app.toggleVimDisplayLines,
    },
    { id: "line-numbers", title: app.lineNumbers ? "Hide line numbers" : "Show line numbers", keywords: "line numbers gutter nu number", icon: "list", run: app.toggleLineNumbers },
    { id: "panel", title: "Toggle side panel", keywords: "outline backlinks activity sidebar", icon: "panel", keys: ["Mod-\\"], run: app.togglePanel },
    { id: "focus", title: app.focusMode ? "Leave focus mode" : "Focus mode", keywords: "zen full screen distraction", icon: app.focusMode ? "unfocus" : "focus", keys: ["Mod-Shift-Enter"], available: text || app.focusMode, run: app.toggleFocus },
    { id: "split", title: app.split ? "Close this pane" : "Open to the side", keywords: "split view pane side by side", icon: "split", keys: ["Mod-Alt-\\"], area: "Split view", run: app.toggleSplit },
    { id: "star", title: note?.starred ? "Unstar note" : "Star note", keywords: "star favorite favourite", icon: note?.starred ? "starred" : "star", available: !!note, run: app.star },
    { id: "archive", title: note?.archived ? "Unarchive note" : "Archive note", keywords: "archive remove hide", icon: note?.archived ? "unarchive" : "archive", keys: ["Mod-Shift-e"], available: !!note, run: app.archive },
    { id: "delete", title: "Delete note", keywords: "delete remove trash bin", icon: "trash", available: !!note && app.canDelete, run: app.delete },
    { id: "move", title: "Move to folder…", keywords: "move note folder file", icon: "move", available: !!note, run: app.move },
    { id: "rename", title: "Rename note…", keywords: "rename name title heading file", icon: "edit", available: !!note && app.canDelete, run: app.rename },
    { id: "back", title: "Go back", keywords: "previous history return last note ctrl-o", icon: "back", keys: ["Mod-["], available: app.canBack, run: app.back },
    { id: "forward", title: "Go forward", keywords: "next history ctrl-i", icon: "chevron", keys: ["Mod-]"], available: app.canForward, run: app.forward },
    { id: "follow-link", title: "Follow link", keywords: "open link under the cursor gd go to", icon: "link", area: "Editor", available: app.onLink, run: app.followLink },
    { id: "fold-all", title: "Fold all sections", keywords: "collapse close details collapsible zM", icon: "chevron", available: text && app.folds > 0, run: () => app.foldAll(false) },
    { id: "unfold-all", title: "Unfold all sections", keywords: "expand open details collapsible zR", icon: "chevron", available: text && app.folds > 0, run: () => app.foldAll(true) },
    { id: "note-history", title: "History of this note", keywords: "versions changes diff restore", icon: "history", available: !!note, run: app.noteHistory },
    {
      id: "html-mode",
      title: app.htmlMode === "preview" ? "Show HTML source" : "Show HTML preview",
      keywords: "html source preview code",
      icon: "html",
      keys: ["Mod-e"],
      area: "Editor",
      available: note?.kind === "html",
      run: app.toggleHtml,
    },
    { id: "getting-started", title: "Open Getting started", keywords: "help start welcome guide tour", icon: "info", available: app.hasStart, run: app.gettingStarted },
    { id: "shortcuts", title: "Keyboard shortcuts", keywords: "keys keybindings help hotkeys cheat sheet", icon: "keyboard", keys: ["?"], run: app.shortcuts },
    ...app.account
      .filter((a) => !a.current)
      .map((a): Command => ({ id: `account:${a.label}`, title: a.workspace ? `Switch to ${a.label}` : a.label, keywords: "account workspace", icon: a.icon, run: a.run })),
  ];
}

/** Shortcuts that belong to no command: moving around a page, the editor, vim. */
export const STATIC_SHORTCUTS: Shortcut[] = [
  { keys: ["Mod-p", "Mod-k"], label: "Quick open: find a note", area: "Global" },
  { keys: ["Mod-Shift-p"], label: "Commands", area: "Global" },
  { keys: [">"], label: "In quick open, switch to commands", area: "Global" },
  { keys: ["Mod-s"], label: "Save now", area: "Global" },
  { keys: ["j", "k"], label: "Next / previous note", area: "Notes page" },
  { keys: ["g", "G"], label: "First / last note", area: "Notes page" },
  { keys: ["Enter"], label: "Expand the note's preview", area: "Notes page" },
  { keys: ["o"], label: "Open the note", area: "Notes page" },
  { keys: ["s"], label: "Star or unstar", area: "Notes page" },
  { keys: ["e"], label: "Archive (the selected notes, or this one)", area: "Notes page" },
  { keys: ["x"], label: "Select", area: "Notes page" },
  { keys: ["Delete", "Backspace"], label: "Delete (the selected notes, or this one)", area: "Notes page" },
  { keys: ["/"], label: "Filter", area: "Notes page" },
  { keys: ["Escape"], label: "Clear the selection", area: "Notes page" },
  ...CALENDAR_KEYS.map(({ keys, label }): Shortcut => ({ keys, label, area: "Calendar" })),
  { keys: ["Mod-z"], label: "Undo", area: "Editor" },
  { keys: ["Mod-Shift-z"], label: "Redo", area: "Editor" },
  { keys: ["Mod-f"], label: "Find in the note", area: "Editor" },
  { keys: ["[["], label: "Link a note", area: "Editor" },
  { keys: ["Mod-Alt-Enter"], label: "Open the linked note to the side", area: "Editor" },
  { keys: ["Mod-."], label: "Open the task's ⚙ menu", area: "Editor" },
  { keys: ["Tab"], label: "Right after an underlined phrase on a task line (\"tomorrow\"), make it a token", area: "Editor" },
  { keys: ["Tab", "Shift-Tab"], label: "Indent / outdent", area: "Editor" },
  { keys: ["Mod-Alt-s"], label: "Wrap the selection in a collapsible section", area: "Editor" },
  { keys: ["Space"], label: "On a section's summary line: fold or unfold it", area: "Editor" },
  { keys: ["gd", "gf"], label: "Follow the link under the cursor", area: "Vim" },
  { keys: ["gs", "gD"], label: "Open the link to the side", area: "Vim" },
  { keys: ["Ctrl-o", "Ctrl-i"], label: "Back / forward through the notes this pane showed", area: "Vim" },
  { keys: ["za", "zo", "zc"], label: "Toggle / open / close the section under the cursor", area: "Vim" },
  { keys: ["zM", "zR"], label: "Fold / unfold every section", area: "Vim" },
  { keys: [":w"], label: "Save", area: "Vim" },
  { keys: [":e name"], label: "Open a note (:e alone opens quick open)", area: "Vim" },
  { keys: [":star"], label: "Star or unstar the note", area: "Vim" },
  { keys: [":rename"], label: "Rename the note (selects its heading)", area: "Vim" },
  { keys: [":archive"], label: "Archive the note", area: "Vim" },
  { keys: [":trash"], label: "Delete the note (to Trash)", area: "Vim" },
  { keys: [":notes"], label: "Go to Notes", area: "Vim" },
  { keys: [":calendar"], label: "Go to Calendar", area: "Vim" },
  { keys: [":focus"], label: "Focus mode", area: "Vim" },
  { keys: [":set nu", ":set nonu"], label: "Show / hide line numbers", area: "Vim" },
  { keys: [":vs name"], label: "Open a note to the side", area: "Vim" },
  { keys: [":only", ":close"], label: "Close the other pane / this pane", area: "Vim" },
  { keys: ["Tab"], label: "In quick-add, send it to the open note", area: "Tasks" },
  { keys: ["Space", "Enter"], label: "Tick the focused task", area: "Tasks" },
  { keys: ["Enter", "Escape"], label: "Save / cancel a task you're editing", area: "Tasks" },
  { keys: ["Mod-Alt-[", "Mod-Alt-]"], label: "Focus the left / right pane", area: "Split view" },
  { keys: ["Mod-Enter"], label: "In quick open, open the note to the side", area: "Split view" },
  { keys: ["Mod-click"], label: "Open a link, card or task to the side", area: "Split view" },
];

/** The shortcut sheet: the fixed shortcuts (quick open leads), then the commands', by area. */
export function shortcutSheet(commands: Command[]): Array<{ area: Area; shortcuts: Shortcut[] }> {
  const all = [...STATIC_SHORTCUTS, ...commands.filter((c) => c.keys).map((c): Shortcut => ({ keys: c.keys!, label: c.title, area: c.area ?? "Global" }))];
  return AREAS.map((area) => ({ area, shortcuts: all.filter((s) => s.area === area) })).filter((s) => s.shortcuts.length);
}

/** The commands on offer that a query (what follows `>`) finds, best first; all of them, in order, for none. */
export function matchCommands(query: string, commands: Command[]): Command[] {
  const q = query.trim();
  const offered = commands.filter((c) => c.available !== false);
  if (!q) return offered;
  return offered
    .map((command) => ({ command, score: Math.max(fuzzyScore(q, command.title), fuzzyScore(q, command.keywords ?? "") - 300) }))
    .filter((m) => m.score >= 0)
    .sort((a, b) => b.score - a.score)
    .map((m) => m.command);
}
