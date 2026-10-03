import "./dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { appCommands, matchCommands, shortcutSheet, type App, type Command } from "../web/src/commands.ts";
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
    tabs: 1,
    pinned: false,
    closedTabs: 0,
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
    tag: null,
    notesFiltered: false,
    renames: null,
    folder: null,
    showHidden: false,
    account: [],
    newNote: run("newNote"),
    newFromTemplate: run("newFromTemplate"),
    newBoard: run("newBoard"),
    newFolder: run("newFolder"),
    toggleHideFolder: run("toggleHideFolder"),
    toggleHiddenFolders: run("toggleHiddenFolders"),
    newTag: run("newTag"),
    newSmartFolder: run("newSmartFolder"),
    saveFilters: run("saveFilters"),
    starTag: run("starTag"),
    renameTag: run("renameTag"),
    newContact: run("newContact"),
    importContacts: run("importContacts"),
    restoreVersion: run("restoreVersion"),
    go: (page) => void ran.push(`go:${page}`),
    filterNotes: run("filterNotes"),
    advancedSearch: run("advancedSearch"),
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
    newTab: run("newTab"),
    closeTab: run("closeTab"),
    reopenTab: run("reopenTab"),
    closeOtherTabs: run("closeOtherTabs"),
    closeTabsToRight: run("closeTabsToRight"),
    togglePin: run("togglePin"),
    stepTab: run("stepTab"),
    moveTab: run("moveTab"),
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
    userSettingsFile: run("userSettingsFile"),
    workspaceSettingsFile: run("workspaceSettingsFile"),
    agentInstructions: run("agentInstructions"),
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
  assert.deepEqual(titles("preferences", app()), ["Open settings", "Open your settings file", "Open workspace settings file"]);
  assert.deepEqual(titles("settings", app()).slice(0, 1), ["Open settings"]);
  assert.deepEqual(titles("connect", app()), ["Agents"]);
  assert.deepEqual(titles("mcp", app()), ["Agents"]);
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
  // "Subscribe to a calendar…" spells s-t-a-r too, after any star command. A tag can always be starred.
  assert.deepEqual(titles("star", app()), ["Star or unstar a tag…", "Subscribe to a calendar…"], "no note to star");
  assert.deepEqual(titles("star", app({ note: { kind: "md", starred: true, archived: false } })).slice(0, 2), ["Star or unstar a tag…", "Unstar note"]);
  assert.deepEqual(titles("html", app({ note: { kind: "html", starred: false, archived: false }, htmlMode: "preview" })), ["Show HTML source", "Share…"]);
  assert.deepEqual(titles("go back", app()), [], "nowhere to go back to");
  assert.deepEqual(titles("rename", app()), ["Rename a tag…", "Go to Tags"], "nothing showing to rename, but a tag can be picked");
  assert.deepEqual(titles("rename", app({ renames: "note", canDelete: false })), ["Go to Tags"], "a viewer can't rename");
  const rename = matchCommands("rename", appCommands(app({ renames: "note" })));
  assert.deepEqual(rename.map((c) => c.title), ["Rename note…", "Rename a tag…", "Go to Tags"]);
  assert.deepEqual(rename[0].keys, ["F2"]);
  rename[0].ask!();
  assert.equal(ran.at(-1), "rename");
  // One Rename… for whatever is showing: Notes narrowed to a folder renames the folder, and so on.
  for (const what of ["folder", "tag", "view", "file"] as const) assert.ok(titles("rename", app({ renames: what })).includes(`Rename ${what}…`));
  const moving = appCommands(app({ canBack: true, canForward: true, onLink: true, note: { kind: "md", starred: false, archived: false } })).filter((c) => ["back", "forward", "follow-link"].includes(c.id));
  assert.deepEqual(moving.map((c) => [c.title, c.keys?.[0]]), [["Go back", "Mod-["], ["Go forward", "Mod-]"], ["Follow link", undefined]]);
  moving.forEach((c) => c.run!());
  assert.deepEqual(ran.slice(-3), ["back", "forward", "followLink"]);
  const md = { kind: "md" as const, starred: false, archived: false };
  assert.deepEqual(titles("fold all", app({ note: md })), [], "no sections: nothing to fold");
  const folding = appCommands(app({ note: md, folds: 2 })).filter((c) => c.id.endsWith("fold-all"));
  assert.deepEqual(folding.map((c) => c.title), ["Fold all sections", "Unfold all sections"]);
  folding.forEach((c) => c.run!());
  assert.deepEqual(ran.slice(-2), ["foldAll:false", "foldAll:true"]);
  assert.deepEqual(titles("getting", app()), []);
  assert.deepEqual(titles("getting", app({ hasStart: true })), ["Open Getting started"]);
  const account = [
    { label: "Me (you)", icon: "file", run: () => {}, workspace: true, current: true },
    { label: "Acme", icon: "feed", run: () => {}, workspace: true },
    { label: "Agents…", icon: "bot", run: () => {} },
  ];
  assert.deepEqual(titles("", app({ account })).slice(-2), ["Switch to Acme", "Agents…"]);
});

test("the sheet lists each area's shortcuts, the commands' included, whether or not they're on offer now", () => {
  const sheet = shortcutSheet(appCommands(app()));
  assert.deepEqual(sheet.map((s) => s.area), ["Global", "Notes page", "Calendar", "Editor", "Vim", "Tasks", "Tabs", "Split view"]);
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

function page(notes: NoteMeta[], onCreate: (name: string) => void = () => {}, commands: () => Command[] = () => appCommands(app())) {
  document.body.innerHTML = `
    <button id="before">before</button>
    <div id="palette" hidden><div class="palette-box" role="dialog" aria-modal="true">
      <input id="palette-input" role="combobox" /><div id="palette-results" role="listbox"></div>
      <div id="palette-hint"></div><kbd class="palette-side"></kbd>
    </div></div>`;
  const opened: string[] = [];
  const palette = new Palette(() => notes, (path) => void opened.push(path), onCreate, commands, scopes);
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

test("a command that needs something asks it in the palette: the field keeps focus, Escape steps back, and done hands focus back", async () => {
  const moved: string[] = [];
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const move: Command = {
    id: "move",
    title: "Move to folder…",
    ask: () => ({
      title: "Move Plan",
      icon: "move",
      placeholder: "To which folder?",
      choices: () => Promise.resolve([{ label: "Projects", value: "Projects" }, { label: "Recipes", value: "Recipes" }]),
      enter: (typed) => (typed ? `New folder “${typed}”` : null),
      submit: (folder, picked) =>
        folder === "Recipes"
          ? { error: "It's in Recipes already" }
          : {
              title: `Into ${folder}`,
              placeholder: "Why? (optional)",
              enter: (why) => (why ? `Move, because ${why}` : "Move"),
              submit: (why) => void moved.push(`${folder}${picked ? "" : " (new)"}${why ? `: ${why}` : ""}`),
            },
    }),
  };
  const p = page([], undefined, () => [move]);
  const chip = document.querySelector<HTMLElement>(".palette-step")!;
  const hint = document.querySelector<HTMLElement>("#palette-hint")!;
  p.type(">move");
  p.press("Enter");
  assert.equal(p.palette.isOpen, true, "it stays open");
  assert.equal(document.activeElement, p.input, "and the field keeps focus");
  assert.equal(chip.hidden, false);
  assert.equal(chip.textContent, "Move Plan");
  assert.equal(p.input.placeholder, "To which folder?");
  await tick();
  assert.deepEqual(p.options(), ["Projects", "Recipes"]);
  p.type("recipes");
  assert.deepEqual(p.options(), ["Recipes"], "typing filters the choices");
  p.press("Enter");
  await tick();
  assert.equal(hint.textContent, "It's in Recipes already", "an error keeps the step");
  assert.equal(chip.textContent, "Move Plan");
  p.type("Archive");
  assert.deepEqual(p.options(), ["New folder “Archive”Enter"]);
  p.press("Enter");
  await tick();
  assert.equal(chip.textContent, "Into Archive", "on to the next step");
  assert.equal(p.input.value, "");
  p.press("Backspace");
  assert.equal(chip.textContent, "Move Plan", "Backspace in an empty field steps back");
  assert.equal(p.input.value, "Archive", "with what was typed there");
  p.press("Escape");
  assert.equal(chip.hidden, true, "Escape steps back to the commands");
  assert.equal(p.input.value, ">move");
  assert.equal(p.palette.isOpen, true);
  p.press("Enter");
  await tick();
  p.press("Enter"); // Projects
  await tick();
  p.type("tidy");
  p.press("Enter");
  await tick();
  assert.deepEqual(moved, ["Projects: tidy"]);
  assert.equal(p.palette.isOpen, false);
  assert.equal(document.activeElement?.id, "before", "focus goes back where it was");
  p.palette.open();
  assert.equal(chip.hidden, true, "it opens to search again");
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
  assert.deepEqual(p.sections(), ["Folders", "Views"]);
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
  for (const c of appCommands(app()).filter((c) => c.id.includes("calendar"))) c.run!();
  assert.deepEqual(ran.slice(-3), ["go:calendar", "subscribeCalendar", "refreshCalendars"]);
  const keys = shortcutSheet(appCommands(app())).find((s) => s.area === "Calendar")!.shortcuts.map((s) => s.keys.join(" "));
  assert.deepEqual(keys.slice(0, 4), ["t", "j n", "k p", "m w d a"]);
});

test("Today is a page to go to, from the palette or :today", () => {
  assert.equal(titles("today", app())[0], "Go to Today");
  appCommands(app()).find((c) => c.id === "go:today")!.run!();
  assert.equal(ran.at(-1), "go:today");
  assert.ok(shortcutSheet(appCommands(app())).find((s) => s.area === "Vim")!.shortcuts.some((s) => s.keys.includes(":today")));
});

test("Advanced search is a command, with its keys on the sheet", () => {
  assert.equal(titles("advanced", app())[0], "Advanced search…");
  appCommands(app()).find((c) => c.id === "advanced-search")!.run!();
  assert.equal(ran.at(-1), "advancedSearch");
  const global = shortcutSheet(appCommands(app())).find((s) => s.area === "Global")!.shortcuts;
  assert.ok(global.some((s) => s.keys.includes("Mod-Alt-f") && s.label === "Advanced search…"));
});

test("the block commands are worded plainly, and the note's web address says it's one", () => {
  const md = appCommands(app({ note: { kind: "md", starred: false, archived: false } }));
  const title = (id: string) => md.find((c) => c.id === id)!.title;
  assert.equal(title("copy-link"), "Copy web address of this note");
  assert.equal(title("copy-block-link"), "Copy link to this paragraph or selection");
  assert.equal(title("copy-block-embed"), "Copy embed of this paragraph or selection");
  md.find((c) => c.id === "copy-block-embed")!.run!();
  assert.equal(ran.at(-1), "copyBlockEmbed");
});

test("the tag in view can be starred and renamed from the palette, or a tag picked when none is", () => {
  assert.deepEqual(titles("star tag", app()).slice(0, 1), ["Star or unstar a tag…"]);
  assert.deepEqual(titles("star", app({ tag: { name: "work", starred: false } })).filter((t) => t.includes("#")), ["Star #work"]);
  assert.deepEqual(titles("unstar", app({ tag: { name: "work", starred: true } })).slice(0, 1), ["Unstar #work"]);
  // With a tag in view, Rename… renames it; Rename tag… (pick one) steps aside.
  assert.deepEqual(titles("rename", app({ tag: { name: "work", starred: false }, renames: "tag" })).filter((t) => t.startsWith("Rename")), ["Rename tag…"]);
  assert.equal(matchCommands("rename", appCommands(app({ tag: { name: "work", starred: false }, renames: "tag" }))).find((c) => c.title === "Rename tag…")!.id, "rename");
  assert.deepEqual(titles("rename tag", app({ canDelete: false })).filter((t) => t.startsWith("Rename")), []);
});

test("saving filters as a view is offered only when Notes has filters on", () => {
  assert.deepEqual(titles("save filters", app()).filter((t) => t.startsWith("Save these")), []);
  assert.deepEqual(titles("save filters", app({ notesFiltered: true })).slice(0, 1), ["Save these filters as a view"]);
});

test("one short field or one pick is asked in the palette; a form of several fields opens its dialog", () => {
  const cmds = appCommands(app({ notesFiltered: true, note: { kind: "md", starred: false, archived: false } }));
  const by = (id: string) => cmds.find((c) => c.id === id)!;
  for (const id of ["new-smart-folder", "save-filters", "new-contact"]) assert.ok(by(id).run && !by(id).ask, `${id} opens its dialog`);
  for (const id of ["new-folder", "new-tag", "star-tag", "rename-tag", "move", "label-version", "restore-version", "new-from-template"]) assert.ok(by(id)?.ask, `${id} asks in the palette`);
});

test("a note can go back to a labeled version, and archive turns into unarchive on an archived note", () => {
  const note = { kind: "md" as const, starred: false, archived: true };
  assert.deepEqual(titles("restore version", app({ note })).slice(0, 1), ["Restore to a named version…"]);
  assert.deepEqual(titles("restore version", app({ note, canDelete: false })).filter((t) => t.startsWith("Restore")), []);
  assert.deepEqual(titles("unarchive", app({ note })).slice(0, 1), ["Unarchive note"]);
});

// Every CLI command (and so every MCP tool) is something the palette can do, or says here why it
// isn't a verb there. A new command fails the test below until it's one or the other, so the two
// lists can't drift apart unnoticed.
const IN_PALETTE: Record<string, string> = {
  ls: "go:notes",
  backlinks: "panel",
  create: "new-note",
  import: "import-notes",
  mv: "move",
  archive: "archive",
  unarchive: "archive",
  delete: "delete",
  templates: "new-from-template",
  new: "new-from-template",
  export: "export-workspace",
  changes: "go:history",
  diff: "note-history",
  restore: "note-history",
  trash: "go:trash",
  "trash restore": "go:trash",
  tasks: "go:tasks",
  "task add": "quick-add",
  today: "go:today",
  journal: "go:today",
  contacts: "go:contacts",
  contact: "go:contacts",
  "contact add": "new-contact",
  "contacts import": "import-contacts",
  tags: "go:tags",
  "tag rename": "rename-tag",
  "folder rename": "rename",
  replace: "replace-across",
  checkup: "go:checkup",
  "save-to-drive": "save-to-drive",
  "smart-save": "save-filters",
  star: "star",
  unstar: "star",
  "star-tag": "star-tag",
  "unstar-tag": "star-tag",
  label: "label-version",
  labels: "note-labels",
  "label-diff": "note-labels",
  "label-restore": "restore-version",
  events: "go:calendar",
  event: "go:calendar",
  calendars: "go:calendar",
  "calendars add": "subscribe-calendar",
  "calendars refresh": "refresh-calendars",
  shares: "share-people",
  share: "share-people",
  unshare: "share-people",
};
const SETTINGS = "a workspace setting, in the account menu's Workspace settings (online, ⌘K lists the menu's actions)";
const NOT_A_VERB: Record<string, string> = {
  search: "⌘K itself searches notes as you type",
  read: "reading a note is opening it, from ⌘K",
  "missing-links": "the editor marks a link to a note that doesn't exist, and clicking it makes the note",
  edit: "editing is typing in the editor",
  append: "editing is typing in the editor",
  write: "editing is typing in the editor",
  folders: "the sidebar's Folders section lists them",
  "folder delete": "a folder's own menu in the sidebar",
  upload: "drop files on a note or on Assets",
  download: "an asset's own Download button",
  "task update": "a task's chips and ⚙ menu change it where it is",
  "task move": "a task's ⚙ menu has Move to…, and the palette has no task in focus to move",
  "task remove": "a task's ⚙ menu, or deleting its line",
  "contact update": "a contact's page edits its fields in place",
  "contacts merge": "a contact's page has Merge…",
  board: "a board is read by opening its note",
  "card add": "cards are added on the board itself",
  "card move": "cards are dragged on the board itself",
  "card edit": "cards are edited on the board itself",
  "tag asset": "an asset's tag chips on Assets",
  "contacts google": "the Google bar on Contacts, and Settings → Integrations, show whether Google Contacts is connected",
  "contacts sync": "the Google bar on Contacts syncs, and Settings → Integrations",
  properties: "a note's property table lists them, and suggests keys and values as you add one",
  "property type": "a property's type menu in a note's property table",
  smart: "the sidebar's Smart folders section lists them",
  "smart-rm": "a smart folder's own menu in the sidebar",
  "decision ask": "agents ask; people answer a decision where it's shown, on Today",
  decisions: "Today lists the decisions waiting on you",
  "decision answer": "a decision's own buttons on Today",
  "decision withdraw": "agents withdraw the questions they asked",
  "smart-star": "a smart folder's own star, on its sidebar row or beside the Notes filters showing it",
  "smart-unstar": "a smart folder's own star, on its sidebar row or in Starred",
  "starred order": "favorites are dragged into order in the sidebar",
  "label-rename": "a label's own buttons in History",
  "label-rm": "a label's own buttons in History",
  "meeting-note": "an event's Meeting note button on the Calendar page",
  "calendars remove": "the Calendars dialog on the Calendar page",
  members: SETTINGS,
  "member role": SETTINGS,
  "member remove": SETTINGS,
  leave: SETTINGS,
  invite: SETTINGS,
  invites: SETTINGS,
  "invites revoke": SETTINGS,
  "workspace rename": SETTINGS,
  "workspace log": SETTINGS,
};

test("every CLI command and MCP tool is a palette command, or is listed with why it isn't one", async () => {
  const { COMMANDS } = await import("../src/core/commands/index.ts");
  const ids = new Set(appCommands(app()).map((c) => c.id));
  const cli = COMMANDS.map((c) => c.cli);
  assert.deepEqual(cli.filter((c) => !(c in IN_PALETTE) && !(c in NOT_A_VERB)), [], "add each to IN_PALETTE (with its palette command's id) or NOT_A_VERB (with why)");
  assert.deepEqual(cli.filter((c) => c in IN_PALETTE && c in NOT_A_VERB), [], "a command is in one list, not both");
  assert.deepEqual([...Object.keys(IN_PALETTE), ...Object.keys(NOT_A_VERB)].filter((c) => !cli.includes(c)), [], "no longer a command");
  assert.deepEqual(Object.entries(IN_PALETTE).filter(([, id]) => !ids.has(id)), [], "no such palette command");
});
