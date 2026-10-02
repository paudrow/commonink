import "./dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { appCommands, matchCommands, shortcutSheet, type App } from "../web/src/commands.ts";
import { Palette, scopeOf, type PaletteScopes } from "../web/src/palette.ts";
import { toggleShortcuts } from "../web/src/shortcuts.ts";
import type { NoteMeta } from "../web/src/api.ts";

const ran: string[] = [];
const app = (over: Partial<App> = {}): App => {
  const run = (name: string) => () => void ran.push(name);
  return {
    note: null,
    vim: false,
    vimDisplayLines: false,
    lineNumbers: false,
    split: false,
    focusMode: false,
    htmlMode: "preview",
    hasStart: false,
    canBack: false,
    canForward: false,
    onLink: false,
    canDelete: true,
    online: false,
    canSubscribe: true,
    canConnectGoogle: false,
    folds: 0,
    renames: null,
    account: [],
    newNote: run("newNote"),
    newFromTemplate: run("newFromTemplate"),
    newBoard: run("newBoard"),
    newFolder: run("newFolder"),
    newTag: run("newTag"),
    newSmartFolder: run("newSmartFolder"),
    go: (page) => void ran.push(`go:${page}`),
    filterNotes: run("filterNotes"),
    quickAdd: run("quickAdd"),
    subscribeCalendar: run("subscribeCalendar"),
    refreshCalendars: run("refreshCalendars"),
    connectGoogle: run("connectGoogle"),
    newEvent: run("newEvent"),
    toggleTheme: run("toggleTheme"),
    toggleVim: run("toggleVim"),
    toggleVimDisplayLines: run("toggleVimDisplayLines"),
    toggleLineNumbers: run("toggleLineNumbers"),
    togglePanel: run("togglePanel"),
    toggleFocus: run("toggleFocus"),
    toggleSplit: run("toggleSplit"),
    toggleHtml: run("toggleHtml"),
    star: run("star"),
    archive: run("archive"),
    delete: run("delete"),
    shareWithPeople: run("shareWithPeople"),
    move: run("move"),
    rename: run("rename"),
    noteHistory: run("noteHistory"),
    labelVersion: run("labelVersion"),
    noteLabels: run("noteLabels"),
    gettingStarted: run("gettingStarted"),
    shortcuts: run("shortcuts"),
    share: run("share"),
    copyLink: run("copyLink"),
    copyBlockLink: (embed) => void ran.push(embed ? "copyBlockEmbed" : "copyBlockLink"),
    replaceAcross: run("replaceAcross"),
    exportAs: (how) => void ran.push(`export:${how}`),
    saveToDrive: run("saveToDrive"),
    exportWorkspace: run("exportWorkspace"),
    importNotes: run("importNotes"),
    settings: run("settings"),
    connectAgent: run("connectAgent"),
    back: run("back"),
    forward: run("forward"),
    followLink: run("followLink"),
    foldAll: (open) => void ran.push(`foldAll:${open}`),
    ...over,
  };
};
const titles = (q: string, a: App) => matchCommands(q, appCommands(a)).map((c) => c.title);
test("commands match fuzzily, by name or by what they're about, and none alone lists every command on offer", () => {
  assert.deepEqual(titles("tgthm", app()), ["Toggle theme"]);
  assert.deepEqual(titles("dark", app()), ["Toggle theme"]);
  assert.deepEqual(titles("archive", app({ note: { kind: "md", starred: false, archived: false } })).slice(0, 2), ["Archive note", "Go to Archive"]);
  assert.deepEqual(titles("zzz", app()), []);
  assert.deepEqual(titles("kanban", app()), ["New board"]);
  assert.deepEqual(titles("preferences", app()), ["Open settings"]);
  assert.deepEqual(titles("settings", app()).slice(0, 1), ["Open settings"]);
  assert.deepEqual(titles("connect", app()), ["Connect an agent"]);
  assert.deepEqual(titles("mcp", app()), ["Connect an agent"]);
  const all = titles("", app());
  assert.equal(all[0], "New note");
  assert.ok(all.includes("Keyboard shortcuts"));
  assert.ok(!all.includes("Star note"), "no note is open");
});

test("commands follow the app: vim's state, the open note, Getting started, and the account menu", () => {
  assert.deepEqual(titles("vim", app({ vim: true })), ["Vim: j and k move by line on screen (gj, gk)", "Turn vim keys off"]);
  assert.deepEqual(titles("vim", app({ vim: false })), ["Turn vim keys on"]);
  assert.deepEqual(titles("gj", app({ vim: true })), ["Vim: j and k move by line on screen (gj, gk)"]);
  assert.deepEqual(titles("gj", app({ vim: true, vimDisplayLines: true })), ["Vim: j and k move by line in the file"]);
  assert.deepEqual(titles("gj", app({ vim: false })), []);
  assert.deepEqual(titles("line numbers", app()).slice(0, 1), ["Show line numbers"]);
  assert.deepEqual(titles("line numbers", app({ lineNumbers: true })).slice(0, 1), ["Hide line numbers"]);
  // "Subscribe to a calendar…" spells s-t-a-r too, after any star command.
  assert.deepEqual(titles("star", app()), ["Subscribe to a calendar…"], "no note to star");
  assert.deepEqual(titles("star", app({ note: { kind: "md", starred: true, archived: false } })), ["Unstar note", "Subscribe to a calendar…"]);
  assert.deepEqual(titles("html", app({ note: { kind: "html", starred: false, archived: false }, htmlMode: "preview" })), ["Show HTML source", "Share…"]);
  assert.deepEqual(titles("go back", app()), [], "nowhere to go back to");
  assert.deepEqual(titles("rename", app()), ["Go to Tags"], "nothing to rename");
  assert.deepEqual(titles("rename", app({ renames: "note", canDelete: false })), ["Go to Tags"], "a viewer can't rename");
  const rename = matchCommands("rename", appCommands(app({ renames: "note" })));
  assert.deepEqual(rename.map((c) => c.title), ["Rename note…", "Go to Tags"]);
  assert.deepEqual(rename[0].keys, ["F2"]);
  rename[0].run();
  assert.equal(ran.at(-1), "rename");
  // One Rename… for whatever is showing: Notes narrowed to a folder renames the folder, and so on.
  for (const what of ["folder", "tag", "smart folder", "file"] as const) assert.equal(titles("rename", app({ renames: what }))[0], `Rename ${what}…`);
  const moving = appCommands(app({ canBack: true, canForward: true, onLink: true, note: { kind: "md", starred: false, archived: false } })).filter((c) => ["back", "forward", "follow-link"].includes(c.id));
  assert.deepEqual(moving.map((c) => [c.title, c.keys?.[0]]), [["Go back", "Mod-["], ["Go forward", "Mod-]"], ["Follow link", undefined]]);
  moving.forEach((c) => c.run());
  assert.deepEqual(ran.slice(-3), ["back", "forward", "followLink"]);
  const md = { kind: "md" as const, starred: false, archived: false };
  assert.deepEqual(titles("fold all", app({ note: md })), [], "no sections: nothing to fold");
  const folding = appCommands(app({ note: md, folds: 2 })).filter((c) => c.id.endsWith("fold-all"));
  assert.deepEqual(folding.map((c) => c.title), ["Fold all sections", "Unfold all sections"]);
  folding.forEach((c) => c.run());
  assert.deepEqual(ran.slice(-2), ["foldAll:false", "foldAll:true"]);
  assert.deepEqual(titles("getting", app()), []);
  assert.deepEqual(titles("getting", app({ hasStart: true })), ["Open Getting started"]);
  const account = [
    { label: "Me (you)", icon: "file", run: () => {}, workspace: true, current: true },
    { label: "Acme", icon: "feed", run: () => {}, workspace: true },
    { label: "Connected agents…", icon: "bot", run: () => {} },
  ];
  assert.deepEqual(titles("", app({ account })).slice(-2), ["Switch to Acme", "Connected agents…"]);
});

test("the sheet lists each area's shortcuts, the commands' included, whether or not they're on offer now", () => {
  const sheet = shortcutSheet(appCommands(app()));
  assert.deepEqual(sheet.map((s) => s.area), ["Global", "Notes page", "Calendar", "Editor", "Vim", "Tasks", "Split view"]);
  const global = sheet.find((s) => s.area === "Global")!.shortcuts;
  assert.deepEqual(global.slice(0, 2).map((s) => s.keys), [["Mod-p", "Mod-k"], ["Mod-Shift-p"]]);
  assert.deepEqual(global.find((s) => s.label === "Archive note")?.keys, ["Mod-Shift-e"]);
  assert.deepEqual(sheet.find((s) => s.area === "Split view")!.shortcuts.find((s) => s.label === "Open split view")?.keys, ["Mod-Alt-\\"]);
});

// ------------------------------------------------------------------ the palette and the sheet, in a page

/** What a screen reader reads out: the text, less anything aria-hidden. */
const readOut = (n: Element) => {
  const copy = n.cloneNode(true) as Element;
  copy.querySelectorAll("[aria-hidden=true]").forEach((h) => h.remove());
  return copy.textContent;
};
const note = (title: string): NoteMeta => ({ id: title, path: `${title}.md`, kind: "md", title, version: "1", mtime: 1, size: 1 });

const went: string[] = [];
const scopes: PaletteScopes = {
  headings: () => [
    { level: 1, text: "Plan", line: 1 },
    { level: 2, text: "Budget", line: 4 },
  ],
  goToHeading: (line) => void went.push(`line ${line}`),
  tags: () => [
    { tag: "work", display: "work", notes: 3, tasks: 0, assets: 0 },
    { tag: "home", display: "home", notes: 1, tasks: 2, assets: 0 },
  ],
  openTag: (tag) => void went.push(`tag ${tag}`),
  folders: () => ["Projects", "Projects/Launch", "Recipes"],
  smartFolders: () => [{ name: "Launch notes", query: "q=launch" }],
  openFolder: (path) => void went.push(`folder ${path}`),
  openSmartFolder: (query) => void went.push(`smart ${query}`),
  openPerson: (p) => void went.push(`person ${p.name}`),
};

function page(notes: NoteMeta[], onCreate: (name: string) => void = () => {}) {
  document.body.innerHTML = `
    <button id="before">before</button>
    <div id="palette" hidden><div class="palette-box" role="dialog" aria-modal="true">
      <input id="palette-input" role="combobox" /><div id="palette-results" role="listbox"></div>
      <div id="palette-hint"></div><kbd class="palette-side"></kbd>
    </div></div>`;
  const opened: string[] = [];
  const palette = new Palette(() => notes, (path) => void opened.push(path), onCreate, () => appCommands(app()), scopes);
  const input = document.querySelector<HTMLInputElement>("#palette-input")!;
  const type = (text: string) => {
    input.value = text;
    input.dispatchEvent(new window.Event("input"));
  };
  const press = (key: string) => input.dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true }));
  const options = () => [...document.querySelectorAll<HTMLElement>("#palette-results [role=option]")].map(readOut);
  const sections = () => [...document.querySelectorAll("#palette-results [role=group] > .palette-section")].map((s) => s.textContent);
  document.querySelector<HTMLElement>("#before")!.focus();
  palette.open();
  return { palette, input, type, press, options, sections, opened };
}

test("quick open finds only notes; > (what ⌘⇧P types) switches to commands, and each toggles itself closed", () => {
  const p = page([note("Theme ideas")]);
  p.type("theme");
  assert.deepEqual(p.sections(), ["Notes"]);
  assert.deepEqual(p.options(), ["Theme ideasTheme ideas.md", "Create “theme”Shift Enter"]);
  p.palette.toggle(">");
  assert.equal(p.input.value, ">");
  assert.equal(p.input.selectionStart, 1, "typing goes after the >");
  assert.deepEqual(p.sections(), ["Commands"]);
  p.type(">theme");
  assert.deepEqual(p.options(), ["Toggle theme"]);
  p.palette.toggle("");
  assert.equal(p.input.value, "", "⌘P switches back to notes");
  p.palette.toggle("");
  assert.equal(p.palette.isOpen, false);
});

test("⌘K is a labelled listbox whose active option the field points at; Enter runs a command and focus goes back", () => {
  ran.length = 0;
  const p = page([note("Groceries")]);
  p.type(">keyboard");
  const option = document.querySelector<HTMLElement>("#palette-results [role=option]")!;
  assert.equal(option.getAttribute("aria-selected"), "true");
  assert.equal(p.input.getAttribute("aria-activedescendant"), option.id);
  assert.equal(readOut(option), "Keyboard shortcutsQuestion Mark");
  p.press("Enter");
  assert.deepEqual(ran, ["shortcuts"]);
  assert.equal(p.palette.isOpen, false);
  assert.equal(document.activeElement?.id, "before");
});

test("after >, Shift+Enter makes no note and Escape closes, handing focus back", () => {
  const created: string[] = [];
  document.body.innerHTML = "";
  const p = page([], (name) => void created.push(name));
  p.type(">nothing like this");
  assert.deepEqual(p.options(), []);
  p.input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true }));
  assert.deepEqual(created, []);
  p.palette.open();
  p.press("Escape");
  assert.equal(p.palette.isOpen, false);
  assert.equal(document.activeElement?.id, "before");
});

test("quick open's prefixes: # headings, tag: tags, / or folder: folders and smart folders, @ people", () => {
  assert.deepEqual(scopeOf("#bud"), { scope: "headings", rest: "bud" });
  assert.deepEqual(scopeOf("@ ana"), { scope: "people", rest: "ana" });
  assert.deepEqual(scopeOf("Tag:#work"), { scope: "tags", rest: "work" });
  assert.deepEqual(scopeOf("/proj"), { scope: "folders", rest: "proj" });
  assert.deepEqual(scopeOf("folder:"), { scope: "folders", rest: "" });
  assert.equal(scopeOf("theme"), null);
  assert.equal(scopeOf("tags are fun"), null, "tag: needs its colon");

  went.length = 0;
  const created: string[] = [];
  const p = page([note("Budget")], (name) => void created.push(name));
  const hint = document.querySelector<HTMLElement>("#palette-hint")!;
  assert.equal(hint.hidden, false, "the empty palette says which prefixes there are");
  p.type("#");
  assert.equal(hint.hidden, true);
  assert.deepEqual(p.sections(), ["Headings in this note"]);
  assert.deepEqual(p.options(), ["Plan#", "Budget##"]);
  p.type("#budg");
  assert.deepEqual(p.options(), ["Budget##"]);
  p.press("Enter");
  assert.deepEqual(went, ["line 4"]);

  p.palette.open("tag:");
  assert.deepEqual(p.options(), ["work3", "home1"]);
  p.type("tag:ho");
  p.press("Enter");
  assert.equal(went.at(-1), "tag home");

  p.palette.open("/");
  assert.deepEqual(p.sections(), ["Folders", "Smart folders"]);
  p.type("folder:launch");
  assert.deepEqual(p.options(), ["LaunchProjects/Launch", "Launch notesq=launch"]);
  p.press("Enter");
  assert.equal(went.at(-1), "folder Projects/Launch");
  p.palette.open("/launch");
  p.press("ArrowDown");
  p.press("Enter");
  assert.equal(went.at(-1), "smart q=launch");

  p.palette.open("#nothing");
  assert.deepEqual(p.options(), []);
  p.input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true }));
  assert.deepEqual(created, [], "Shift+Enter doesn't make a note called #nothing");
});

test("the shortcut sheet is a labelled modal dialog: Ctrl off a Mac, vim folded while off, Tab stays inside, Esc closes", () => {
  document.body.innerHTML = `<button id="before">before</button>`;
  document.querySelector<HTMLElement>("#before")!.focus();
  toggleShortcuts(appCommands(app()), { vim: false, mac: false });
  const dialog = document.querySelector<HTMLElement>("[role=dialog]")!;
  assert.equal(dialog.getAttribute("aria-modal"), "true");
  assert.equal(document.getElementById(dialog.getAttribute("aria-labelledby")!)?.textContent, "Keyboard shortcuts");
  assert.equal(document.activeElement, dialog);
  assert.ok(dialog.textContent!.includes("Ctrl+Shift+E"));
  assert.ok(!dialog.textContent!.includes("⌘"));
  assert.equal(dialog.querySelector("details")?.open, false);
  assert.equal(dialog.querySelector("summary")?.textContent, "Vim (off)");
  const tab = (shiftKey = false) => document.activeElement!.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Tab", shiftKey, bubbles: true }));
  tab();
  assert.equal(document.activeElement?.getAttribute("aria-label"), "Close");
  tab();
  assert.equal(document.activeElement?.tagName, "SUMMARY");
  tab();
  assert.equal(document.activeElement?.getAttribute("aria-label"), "Close", "wraps around");
  document.activeElement!.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(document.querySelector("[role=dialog]"), null);
  assert.equal(document.activeElement?.id, "before");
});

test("the sheet's keys are read out as words, not symbols: ⌘⇧P is Command Shift P", () => {
  toggleShortcuts(appCommands(app()), { vim: false, mac: true });
  const keys = [...document.querySelectorAll("#shortcuts kbd")];
  const said = keys.map(readOut);
  assert.ok(said.includes("Command Shift P"));
  assert.ok(said.includes("Command Option Backslash"));
  assert.deepEqual(said.filter((s) => /[⌘⌥⇧⌃↵↑↓←→]/.test(s!)), []);
  assert.ok(keys.some((k) => k.textContent === "⌘⇧PCommand Shift P"), "the symbols still show");
  document.activeElement!.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
});

test("Delete and Trash are commands for whoever can delete, not viewers", () => {
  const note = { kind: "md" as const, starred: false, archived: false };
  assert.deepEqual(titles("trash", app({ note })).slice(0, 2), ["Go to Trash", "Delete note"]);
  assert.deepEqual(titles("trash", app({ note: null })), ["Go to Trash"]);
  assert.deepEqual(titles("trash", app({ note, canDelete: false })), []);
});

test("Share with people… and Shared with me are commands online only", () => {
  const note = { kind: "md" as const, starred: false, archived: false };
  const sharing = (t: string) => /people|Shared with me/.test(t);
  assert.deepEqual(titles("share", app({ note, online: true })).filter(sharing), ["Share with people…", "Go to Shared with me"]);
  assert.deepEqual(titles("share", app({ note, online: false })).filter(sharing), []);
});

test("the calendar is a page to go to, a feed to subscribe to (not for viewers) and something to refresh; its keys are on the sheet", () => {
  assert.deepEqual(titles("calendar", app()), ["Go to Calendar", "Refresh calendars", "Subscribe to a calendar…", "New event…"]);
  assert.deepEqual(titles("webcal", app({ canSubscribe: false })), []);
  assert.deepEqual(titles("calendar", app({ canSubscribe: false })), ["Go to Calendar", "Refresh calendars", "New event…"]);
  assert.deepEqual(titles("new event", app()).slice(0, 1), ["New event…"]);
  for (const c of appCommands(app()).filter((c) => c.id.includes("calendar"))) c.run();
  assert.deepEqual(ran.slice(-3), ["go:calendar", "subscribeCalendar", "refreshCalendars"]);
  const keys = shortcutSheet(appCommands(app())).find((s) => s.area === "Calendar")!.shortcuts.map((s) => s.keys.join(" "));
  assert.deepEqual(keys.slice(0, 4), ["t", "j n", "k p", "m w d a"]);
});

test("Today is a page to go to, from the palette or :today", () => {
  assert.equal(titles("today", app())[0], "Go to Today");
  appCommands(app()).find((c) => c.id === "go:today")!.run();
  assert.equal(ran.at(-1), "go:today");
  assert.ok(shortcutSheet(appCommands(app())).find((s) => s.area === "Vim")!.shortcuts.some((s) => s.keys.includes(":today")));
});

test("the block commands say they copy [[links]], apart from Copy link to this note (the web address)", () => {
  const md = appCommands(app({ note: { kind: "md", starred: false, archived: false } }));
  const title = (id: string) => md.find((c) => c.id === id)!.title;
  assert.equal(title("copy-link"), "Copy link to this note");
  assert.equal(title("copy-block-link"), "Copy [[link]] to this paragraph");
  assert.equal(title("copy-block-embed"), "Copy ![[embed]] of this paragraph");
  md.find((c) => c.id === "copy-block-embed")!.run();
  assert.equal(ran.at(-1), "copyBlockEmbed");
});
