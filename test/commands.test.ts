import "./dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { appCommands, matchCommands, shortcutSheet, type App } from "../web/src/commands.ts";
import { Palette } from "../web/src/palette.ts";
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
    folds: 0,
    account: [],
    newNote: run("newNote"),
    newFolder: run("newFolder"),
    go: (page) => void ran.push(`go:${page}`),
    filterNotes: run("filterNotes"),
    quickAdd: run("quickAdd"),
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
    move: run("move"),
    noteHistory: run("noteHistory"),
    gettingStarted: run("gettingStarted"),
    shortcuts: run("shortcuts"),
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
  assert.deepEqual(titles("star", app()), []);
  assert.deepEqual(titles("star", app({ note: { kind: "md", starred: true, archived: false } })), ["Unstar note"]);
  assert.deepEqual(titles("html", app({ note: { kind: "html", starred: false, archived: false }, htmlMode: "preview" })), ["Show HTML source"]);
  assert.deepEqual(titles("go back", app()), [], "nowhere to go back to");
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
  assert.deepEqual(sheet.map((s) => s.area), ["Global", "Notes page", "Editor", "Vim", "Tasks", "Split view"]);
  const global = sheet.find((s) => s.area === "Global")!.shortcuts;
  assert.deepEqual(global.slice(0, 2).map((s) => s.keys), [["Mod-p", "Mod-k"], ["Mod-Shift-p"]]);
  assert.deepEqual(global.find((s) => s.label === "Archive note")?.keys, ["Mod-Shift-e"]);
  assert.deepEqual(sheet.find((s) => s.area === "Split view")!.shortcuts.find((s) => s.label === "Open to the side")?.keys, ["Mod-Alt-\\"]);
});

// ------------------------------------------------------------------ the palette and the sheet, in a page

const note = (title: string): NoteMeta => ({ id: title, path: `${title}.md`, kind: "md", title, version: "1", mtime: 1, size: 1 });

function page(notes: NoteMeta[], onCreate: (name: string) => void = () => {}) {
  document.body.innerHTML = `
    <button id="before">before</button>
    <div id="palette" hidden><div class="palette-box" role="dialog" aria-modal="true">
      <input id="palette-input" role="combobox" /><div id="palette-results" role="listbox"></div>
      <kbd class="palette-side"></kbd>
    </div></div>`;
  const opened: string[] = [];
  const palette = new Palette(() => notes, (path) => void opened.push(path), onCreate, () => appCommands(app()));
  const input = document.querySelector<HTMLInputElement>("#palette-input")!;
  const type = (text: string) => {
    input.value = text;
    input.dispatchEvent(new window.Event("input"));
  };
  const press = (key: string) => input.dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true }));
  const options = () => [...document.querySelectorAll<HTMLElement>("#palette-results [role=option]")].map((o) => o.textContent);
  const sections = () => [...document.querySelectorAll("#palette-results [role=group] > .palette-section")].map((s) => s.textContent);
  document.querySelector<HTMLElement>("#before")!.focus();
  palette.open();
  return { palette, input, type, press, options, sections, opened };
}

test("quick open finds only notes; > (what ⌘⇧P types) switches to commands, and each toggles itself closed", () => {
  const p = page([note("Theme ideas")]);
  p.type("theme");
  assert.deepEqual(p.sections(), ["Notes"]);
  assert.deepEqual(p.options(), ["Theme ideasTheme ideas.md", "Create “theme”⇧↵"]);
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
  assert.equal(option.textContent, "Keyboard shortcuts?");
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

test("Delete and Trash are commands for whoever can delete, not viewers", () => {
  const note = { kind: "md" as const, starred: false, archived: false };
  assert.deepEqual(titles("trash", app({ note })).slice(0, 2), ["Go to Trash", "Delete note"]);
  assert.deepEqual(titles("trash", app({ note: null })), ["Go to Trash"]);
  assert.deepEqual(titles("trash", app({ note, canDelete: false })), []);
});
