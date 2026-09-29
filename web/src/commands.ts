// Everything you can do from ⌘K, and every keyboard shortcut: one registry that the palette's
// Commands section and the shortcut sheet (?) both read. main.ts supplies the state and the actions.
import { fuzzyScore } from "./fuzzy.ts";
import { IS_MAC } from "./panes.ts";

export type Area = "Global" | "Notes page" | "Editor" | "Vim" | "Tasks" | "Split view";
export const AREAS: Area[] = ["Global", "Notes page", "Editor", "Vim", "Tasks", "Split view"];

/** Keys as CodeMirror writes them ("Mod-Shift-e", "Mod-Alt-\\"), or typed literally ("q", "gd", ":w"). */
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

export type Page = "notes" | "tasks" | "tags" | "assets" | "history" | "archive";

/** What the registry needs from the app: a snapshot of its state, and the actions to run. */
export interface App {
  /** The note in the focused pane. */
  note: { kind: "md" | "html" | "asset"; starred: boolean; archived: boolean } | null;
  vim: boolean;
  split: boolean;
  focusMode: boolean;
  htmlMode: "preview" | "source";
  /** A note tagged `start` exists. */
  hasStart: boolean;
  /** Online, the account menu's actions; locally, none. */
  account: Array<{ label: string; icon: string; run: () => unknown; workspace?: boolean; current?: boolean }>;
  newNote(): void;
  newFolder(): void;
  go(page: Page): void;
  filterNotes(): void;
  quickAdd(): void;
  toggleTheme(): void;
  toggleVim(): void;
  togglePanel(): void;
  toggleFocus(): void;
  toggleSplit(): void;
  toggleHtml(): void;
  star(): void;
  archive(): void;
  move(): void;
  noteHistory(): void;
  gettingStarted(): void;
  shortcuts(): void;
}

export function appCommands(app: App): Command[] {
  const note = app.note;
  const text = !!note && note.kind !== "asset";
  const go = (page: Page, title: string, icon: string, keywords = ""): Command => ({ id: `go:${page}`, title: `Go to ${title}`, keywords: `open show page ${keywords}`, icon, run: () => app.go(page) });
  return [
    { id: "new-note", title: "New note", keywords: "create add page", icon: "plus", run: app.newNote },
    { id: "new-folder", title: "New folder", keywords: "create add directory", icon: "folderPlus", run: app.newFolder },
    { id: "quick-add", title: "Add a task", keywords: "quick add todo new task", icon: "task", keys: ["Mod-Shift-."], area: "Tasks", run: app.quickAdd },
    go("notes", "Notes", "feed", "home all"),
    { id: "filter-notes", title: "Filter notes", keywords: "search find notes page", icon: "search", keys: ["Mod-Shift-f"], run: app.filterNotes },
    go("tasks", "Tasks", "task", "todo checklist"),
    go("tags", "Tags", "hash", "rename merge"),
    go("assets", "Assets", "grid", "files images uploads attachments"),
    go("history", "History", "history", "changes activity versions"),
    go("archive", "Archive", "archive", "archived"),
    { id: "theme", title: "Toggle theme", keywords: "dark light mode appearance colors", icon: "moon", run: app.toggleTheme },
    { id: "vim", title: app.vim ? "Turn vim keys off" : "Turn vim keys on", keywords: "vim keybindings modal editing toggle", icon: "code", run: app.toggleVim },
    { id: "panel", title: "Toggle side panel", keywords: "outline backlinks activity sidebar", icon: "panel", keys: ["Mod-\\"], run: app.togglePanel },
    { id: "focus", title: app.focusMode ? "Leave focus mode" : "Focus mode", keywords: "zen full screen distraction", icon: app.focusMode ? "unfocus" : "focus", keys: ["Mod-Shift-Enter"], available: text || app.focusMode, run: app.toggleFocus },
    { id: "split", title: app.split ? "Close this pane" : "Open to the side", keywords: "split view pane side by side", icon: "split", keys: ["Mod-Alt-\\"], area: "Split view", run: app.toggleSplit },
    { id: "star", title: note?.starred ? "Unstar note" : "Star note", keywords: "star favorite favourite", icon: note?.starred ? "starred" : "star", available: !!note, run: app.star },
    { id: "archive", title: note?.archived ? "Unarchive note" : "Archive note", keywords: "archive remove hide", icon: note?.archived ? "unarchive" : "archive", keys: ["Mod-Shift-e"], available: !!note, run: app.archive },
    { id: "move", title: "Move to folder…", keywords: "move note folder file", icon: "move", available: !!note, run: app.move },
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
  { keys: ["Mod-[", "Mod-]"], label: "Back / forward through the notes this pane showed", area: "Global" },
  { keys: ["j", "k"], label: "Next / previous note", area: "Notes page" },
  { keys: ["g", "G"], label: "First / last note", area: "Notes page" },
  { keys: ["Enter"], label: "Expand the note's preview", area: "Notes page" },
  { keys: ["o"], label: "Open the note", area: "Notes page" },
  { keys: ["s"], label: "Star or unstar", area: "Notes page" },
  { keys: ["e"], label: "Archive (the selected notes, or this one)", area: "Notes page" },
  { keys: ["x"], label: "Select", area: "Notes page" },
  { keys: ["/"], label: "Filter", area: "Notes page" },
  { keys: ["Escape"], label: "Clear the selection", area: "Notes page" },
  { keys: ["Mod-z"], label: "Undo", area: "Editor" },
  { keys: ["Mod-Shift-z"], label: "Redo", area: "Editor" },
  { keys: ["Mod-f"], label: "Find in the note", area: "Editor" },
  { keys: ["[["], label: "Link a note", area: "Editor" },
  { keys: ["Mod-Alt-Enter"], label: "Open the linked note to the side", area: "Editor" },
  { keys: ["Mod-."], label: "Open the task's ⚙ menu", area: "Editor" },
  { keys: ["Tab", "Shift-Tab"], label: "Indent / outdent", area: "Editor" },
  { keys: ["gd", "gf"], label: "Follow the link under the cursor", area: "Vim" },
  { keys: ["gs", "gD"], label: "Open the link to the side", area: "Vim" },
  { keys: ["Ctrl-o", "Ctrl-i"], label: "Back / forward through the notes this pane showed", area: "Vim" },
  { keys: [":w"], label: "Save", area: "Vim" },
  { keys: [":e name"], label: "Open a note (:e alone opens quick open)", area: "Vim" },
  { keys: [":star"], label: "Star or unstar the note", area: "Vim" },
  { keys: [":archive"], label: "Archive the note", area: "Vim" },
  { keys: [":notes"], label: "Go to Notes", area: "Vim" },
  { keys: [":focus"], label: "Focus mode", area: "Vim" },
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

const MAC_MOD: Record<string, string> = { Mod: "⌘", Ctrl: "⌃", Alt: "⌥", Shift: "⇧" };
const PC_MOD: Record<string, string> = { Mod: "Ctrl", Ctrl: "Ctrl", Alt: "Alt", Shift: "Shift" };
const KEY_NAMES: Record<string, string> = { Enter: "↵", Escape: "Esc", ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", click: "click" };

/** "Mod-Shift-e" → ⌘⇧E on a Mac and Ctrl+Shift+E elsewhere; a key typed as is ("gd", "q") stays as it is. */
export function formatKeys(keys: string, mac = IS_MAC): string {
  const parts = keys.length > 1 ? keys.split(/-(?=.)/) : [keys];
  const key = parts.pop()!;
  const mods = parts.filter((p) => p in MAC_MOD);
  if (mods.length !== parts.length) return keys;
  const name = KEY_NAMES[key] ?? (mods.length && key.length === 1 ? key.toUpperCase() : key);
  if (key === "click") return mac ? `${mods.map((m) => MAC_MOD[m]).join("")}-click` : `${mods.map((m) => PC_MOD[m]).join("+")}-click`;
  return mac ? mods.map((m) => MAC_MOD[m]).join("") + name : [...mods.map((m) => PC_MOD[m]), name].join("+");
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

/** What each physical key types in this keyboard layout, unshifted (Chrome and Edge can tell; see learnLayout). */
let layout: ReadonlyMap<string, string> | null = null;

/** Learn the keyboard layout, so a shortcut with ⇧ or ⌥ still finds the key its character is on. */
export async function learnLayout(keyboard: { getLayoutMap(): Promise<ReadonlyMap<string, string>> } | undefined = (navigator as any).keyboard) {
  layout = (await keyboard?.getLayoutMap().catch(() => null)) ?? null;
}

/** Where a browser that can't tell the layout finds keys that ⌥ turns into other characters on a Mac. */
const US_CODES: Record<string, string> = { BracketLeft: "[", BracketRight: "]", Backslash: "\\", Period: ".", Slash: "/" };

/**
 * Whether a key press is the shortcut `keys` ("Mod-Shift-p"). It goes by the character typed, not
 * the key's place, so it works on any layout (Dvorak too). Mod is ⌘ on a Mac and Ctrl elsewhere.
 */
export function matchKeys(e: Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">, keys: string, mac = IS_MAC): boolean {
  const parts = keys.split(/-(?=.)/);
  const want = parts.pop()!.toLowerCase();
  const has = (m: string) => parts.includes(m);
  if ((mac ? e.metaKey : e.ctrlKey) !== has("Mod") || (mac && e.ctrlKey) !== has("Ctrl") || e.altKey !== has("Alt") || e.shiftKey !== has("Shift")) return false;
  if (e.key.toLowerCase() === want) return true;
  // ⇧ and ⌥ change the character (⌥[ types “ on a Mac): ask the layout what the key types without them.
  if (!e.altKey && !e.shiftKey) return false;
  return (layout ? layout.get(e.code) : US_CODES[e.code]) === want;
}
