import "./dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { appCommands, formatKeys, matchCommands, shortcutSheet, type App } from "../web/src/commands.ts";
import { Palette } from "../web/src/palette.ts";
import { toggleShortcuts } from "../web/src/shortcuts.ts";
import type { NoteMeta } from "../web/src/api.ts";

const ran: string[] = [];
const app = (over: Partial<App> = {}): App => {
  const run = (name: string) => () => void ran.push(name);
  return {
    note: null,
    vim: false,
    split: false,
    focusMode: false,
    htmlMode: "preview",
    hasStart: false,
    account: [],
    newNote: run("newNote"),
    newFolder: run("newFolder"),
    go: (page) => void ran.push(`go:${page}`),
    filterNotes: run("filterNotes"),
    quickAdd: run("quickAdd"),
    toggleTheme: run("toggleTheme"),
    toggleVim: run("toggleVim"),
    togglePanel: run("togglePanel"),
    toggleFocus: run("toggleFocus"),
    toggleSplit: run("toggleSplit"),
    toggleHtml: run("toggleHtml"),
    star: run("star"),
    archive: run("archive"),
    move: run("move"),
    noteHistory: run("noteHistory"),
    gettingStarted: run("gettingStarted"),
    shortcuts: run("shortcuts"),
    ...over,
  };
};
const titles = (q: string, a: App, only = false) => matchCommands(q, appCommands(a), only).map((m) => m.command.title);

test("shortcuts read ⌘⇧E on a Mac and Ctrl+Shift+E elsewhere; keys typed as they are stay as they are", () => {
  const keys = ["Mod-Shift-e", "Mod-Alt-\\", "Mod-Enter", "Shift-Tab", "Mod-click", "q", "G", "gd", ":w", "?"];
  assert.deepEqual(
    keys.map((k) => formatKeys(k, true)),
    ["⌘⇧E", "⌘⌥\\", "⌘↵", "⇧Tab", "⌘-click", "q", "G", "gd", ":w", "?"],
  );
  assert.deepEqual(
    keys.map((k) => formatKeys(k, false)),
    ["Ctrl+Shift+E", "Ctrl+Alt+\\", "Ctrl+↵", "Shift+Tab", "Ctrl-click", "q", "G", "gd", ":w", "?"],
  );
});

test("a word finds its commands, whole words first; letters inside a word or a single letter find none", () => {
  assert.deepEqual(titles("theme", app()), ["Toggle theme"]);
  assert.deepEqual(titles("arch", app()), ["Go to Archive"]);
  assert.deepEqual(titles("archive", app({ note: { kind: "md", starred: false, archived: false } })), ["Archive note", "Go to Archive"]);
  assert.deepEqual(titles("dark", app()), ["Toggle theme"]);
  assert.deepEqual(titles("heme", app()), []);
  assert.deepEqual(titles("t", app()), []);
  assert.equal(matchCommands("theme", appCommands(app()))[0].exact, true);
  assert.equal(matchCommands("them", appCommands(app()))[0].exact, false);
});

test("after >, commands match fuzzily, and > alone lists every command on offer", () => {
  assert.deepEqual(titles("tgthm", app(), true), ["Toggle theme"]);
  const all = titles("", app(), true);
  assert.equal(all[0], "New note");
  assert.ok(all.includes("Keyboard shortcuts"));
  assert.ok(!all.includes("Star note"), "no note is open");
});

test("commands follow the app: vim's state, the open note, Getting started, and the account menu", () => {
  assert.deepEqual(titles("vim", app({ vim: true })), ["Turn vim keys off"]);
  assert.deepEqual(titles("vim", app({ vim: false })), ["Turn vim keys on"]);
  assert.deepEqual(titles("star", app()), []);
  assert.deepEqual(titles("star", app({ note: { kind: "md", starred: true, archived: false } })), ["Unstar note"]);
  assert.deepEqual(titles("html", app({ note: { kind: "html", starred: false, archived: false }, htmlMode: "preview" })), ["Show HTML source"]);
  assert.deepEqual(titles("getting", app()), []);
  assert.deepEqual(titles("getting", app({ hasStart: true })), ["Open Getting started"]);
  const account = [
    { label: "Me (you)", icon: "file", run: () => {}, workspace: true, current: true },
    { label: "Acme", icon: "feed", run: () => {}, workspace: true },
    { label: "Connected agents…", icon: "bot", run: () => {} },
  ];
  assert.deepEqual(titles("", app({ account }), true).slice(-2), ["Switch to Acme", "Connected agents…"]);
});

test("the sheet lists each area's shortcuts, the commands' included, whether or not they're on offer now", () => {
  const sheet = shortcutSheet(appCommands(app()));
  assert.deepEqual(sheet.map((s) => s.area), ["Global", "Notes page", "Editor", "Vim", "Tasks", "Split view"]);
  const global = sheet.find((s) => s.area === "Global")!.shortcuts;
  assert.deepEqual(global[0], { keys: ["Mod-k", "Mod-p"], label: "Search notes and commands", area: "Global" });
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

test("in ⌘K, a command's word leads with Commands; a note named like it keeps Notes first", () => {
  const plain = page([note("Groceries")]);
  plain.type("theme");
  assert.deepEqual(plain.sections(), ["Commands"]);
  assert.deepEqual(plain.options(), ["Toggle theme", "Create “theme”⇧↵"]);
  const named = page([note("Theme ideas")]);
  named.type("theme");
  assert.deepEqual(named.sections(), ["Notes", "Commands"]);
  assert.equal(named.options()[0], "Theme ideasTheme ideas.md");
  named.palette.close();
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
