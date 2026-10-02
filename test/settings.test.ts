import "./dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { appSettings, matchSettings, openSettings, type SettingsApp } from "../web/src/settings.ts";

(globalThis as any).matchMedia = () => ({ matches: false, addEventListener() {} });

/** An app whose settings are plain values, as main.ts's are, with a log of what changed. */
function fakeApp(over: Partial<SettingsApp> = {}) {
  const log: string[] = [];
  const app: SettingsApp = {
    theme: "system",
    setTheme: (t) => ((app.theme = t), log.push(`theme:${t}`)),
    ink: { current: "indigo", earned: ["indigo", "viridian"], stats: { guideFinished: false, notes: 12, ticked: 12, agentEdited: false, days: null } },
    setInk: (i) => ((app.ink.current = i), log.push(`ink:${i}`)),
    lineNumbers: false,
    setLineNumbers: (on) => ((app.lineNumbers = on), log.push(`lineNumbers:${on}`)),
    codeWrap: true,
    setCodeWrap: (on) => ((app.codeWrap = on), log.push(`codeWrap:${on}`)),
    htmlMode: "preview",
    setHtmlMode: (m) => ((app.htmlMode = m), log.push(`htmlMode:${m}`)),
    vim: false,
    setVim: (on) => ((app.vim = on), log.push(`vim:${on}`)),
    vimDisplayLines: false,
    setVimDisplayLines: (on) => ((app.vimDisplayLines = on), log.push(`vimDisplayLines:${on}`)),
    shortcutTips: true,
    setShortcutTips: (on) => ((app.shortcutTips = on), log.push(`shortcutTips:${on}`)),
    sidebarPinned: {},
    setSidebarPinned: (item, on) => ((app.sidebarPinned = { ...app.sidebarPinned, [item]: on }), log.push(`sidebar:${item}:${on}`)),
    gamified: { on: true, canChange: true },
    setGamified: (on) => ((app.gamified = { ...app.gamified, on }), log.push(`gamified:${on}`)),
    openSettingsFile: () => log.push("openSettingsFile"),
    showConfig: false,
    setShowConfig: (on) => ((app.showConfig = on), log.push(`showConfig:${on}`)),
    localVault: { projectRoot: "/code/commonink", vault: "/notes" },
    shortcuts: () => log.push("shortcuts"),
    connectAgent: () => log.push("connectAgent"),
    ...over,
  };
  return { app, log };
}

const titles = (q: string, app: SettingsApp) => matchSettings(q, appSettings(app)).map((s) => s.title);

test("search finds settings by every word, across title, description, section and keywords", () => {
  const { app } = fakeApp();
  assert.deepEqual(titles("", app), ["Theme", "Ink", "Always show Contacts", "Always show Calendar", "Always show Assets", "Always show Smart folders", "Show the Config folder", "Line numbers", "Wrap code", "HTML notes", "Vim keys", "Vim: j and k by screen line", "Keyboard shortcuts", "Shortcut tips", "Connect an agent", "Unlock as you go", "Settings file"]);
  assert.deepEqual(titles("dark", app), ["Theme"]);
  assert.deepEqual(titles("VIM", app), ["Line numbers", "Vim keys", "Vim: j and k by screen line"]);
  assert.deepEqual(titles("vim gj", app), ["Vim: j and k by screen line"]);
  assert.deepEqual(titles("wrap", app), ["Wrap code", "Vim: j and k by screen line"]);
  assert.deepEqual(titles("mcp", app), ["Connect an agent"]);
  assert.deepEqual(titles("sidebar events", app), ["Always show Calendar"]);
  assert.deepEqual(titles("editor", app), ["Line numbers", "Wrap code", "HTML notes"]);
  assert.deepEqual(titles("yaml", app), ["Show the Config folder", "Settings file"]);
  assert.deepEqual(titles("zzz", app), []);
});

test("online, Agents opens the Connected agents dialog; Vim's j and k wait for Vim keys", () => {
  const online = appSettings(fakeApp({ localVault: null }).app).find((s) => s.id === "connect-agent")!;
  assert.equal(online.title, "Connected agents");
  assert.equal(online.control.kind, "button");
  const jk = (vim: boolean) => appSettings(fakeApp({ vim }).app).find((s) => s.id === "vim-display-lines")!.disabled;
  assert.equal(jk(false), true);
  assert.equal(jk(true), false);
});

test("a workspace that isn't gamified has nothing to pin or earn and no tips; a viewer can't turn it back on", () => {
  const { app, log } = fakeApp({ gamified: { on: false, canChange: true } });
  assert.deepEqual(titles("", app), ["Theme", "Ink", "Show the Config folder", "Line numbers", "Wrap code", "HTML notes", "Vim keys", "Vim: j and k by screen line", "Keyboard shortcuts", "Connect an agent", "Unlock as you go", "Settings file"]);
  assert.deepEqual(titles("gamification", app), ["Unlock as you go"]);
  assert.deepEqual(titles("progressive disclosure", app), ["Unlock as you go"]);
  const setting = appSettings(app).find((s) => s.id === "gamified")!;
  assert.equal(setting.disabled, false);
  if (setting.control.kind === "toggle") setting.control.set(true);
  assert.deepEqual(log, ["gamified:true"]);
  const member = appSettings(fakeApp({ gamified: { on: true, canChange: false } }).app).find((s) => s.id === "gamified")!;
  assert.equal(member.disabled, true);
  assert.match(member.description, /You can view this workspace but not change it/);
});

test("the dialog: labelled controls, search as you type, changes that apply at once, Esc to close", async () => {
  const { app, log } = fakeApp();
  const before = document.body.appendChild(document.createElement("button"));
  before.focus();
  openSettings(() => appSettings(app));
  const dialog = document.querySelector<HTMLElement>("#settings [role=dialog]")!;
  assert.equal(dialog.getAttribute("aria-modal"), "true");
  assert.equal(document.getElementById(dialog.getAttribute("aria-labelledby")!)?.textContent, "Settings");
  const search = dialog.querySelector<HTMLInputElement>("input[type=search]")!;
  assert.equal(document.activeElement, search);
  assert.equal(search.getAttribute("aria-label"), "Search settings");
  assert.deepEqual([...dialog.querySelectorAll("h3")].map((h) => h.textContent), ["Appearance", "Sidebar", "Editor", "Keyboard", "Agents", "Workspace"]);
  for (const control of dialog.querySelectorAll<HTMLElement>("input[type=checkbox], select")) {
    const label = dialog.querySelector(`label[for="${control.id}"]`);
    assert.ok(label?.textContent, `${control.id} has a label`);
    assert.ok(document.getElementById(control.getAttribute("aria-describedby")!)?.textContent, `${control.id} has a description`);
  }
  assert.ok(dialog.textContent!.includes("claude mcp add commonink -e COMMONINK_VAULT=/notes -- /code/commonink/bin/commonink mcp"));

  search.value = "line";
  search.dispatchEvent(new window.Event("input"));
  assert.deepEqual([...dialog.querySelectorAll(".st-title")].map((t) => t.textContent), ["Line numbers", "Wrap code", "Vim: j and k by screen line"]);
  assert.equal(dialog.querySelector(".st-found")?.textContent, "3 settings found");

  search.value = "vim";
  search.dispatchEvent(new window.Event("input"));
  const jk = () => dialog.querySelector<HTMLInputElement>("#st-vim-display-lines")!;
  assert.equal(jk().disabled, true);
  const vim = dialog.querySelector<HTMLInputElement>("#st-vim")!;
  vim.focus();
  vim.checked = true;
  vim.dispatchEvent(new window.Event("change", { bubbles: true }));
  await Promise.resolve();
  assert.deepEqual(log, ["vim:true"]);
  assert.equal(jk().disabled, false, "j and k come on with Vim keys");
  assert.equal(document.activeElement?.id, "st-vim", "the focus stays on the redrawn checkbox");

  search.value = "";
  search.dispatchEvent(new window.Event("input"));
  const contacts = dialog.querySelector<HTMLInputElement>("#st-sidebar-contacts")!;
  assert.equal(contacts.checked, false);
  contacts.checked = true;
  contacts.dispatchEvent(new window.Event("change", { bubbles: true }));
  await Promise.resolve();
  assert.equal(dialog.querySelector<HTMLInputElement>("#st-sidebar-contacts")!.checked, true, "the redrawn toggle stays on");
  const theme = dialog.querySelector<HTMLSelectElement>("#st-theme")!;
  theme.value = "dark";
  theme.dispatchEvent(new window.Event("change", { bubbles: true }));
  assert.deepEqual(log, ["vim:true", "sidebar:contacts:true", "theme:dark"]);

  document.activeElement!.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(document.querySelector("#settings"), null);
  assert.equal(document.activeElement, before, "the focus goes back where it was");
});

test("Ink: a radio group of swatches; locked ones say what earns them and can't be picked", () => {
  const { app, log } = fakeApp();
  openSettings(() => appSettings(app), { query: "ink" });
  const group = document.querySelector<HTMLElement>("#settings [role=radiogroup]")!;
  assert.equal(document.getElementById(group.getAttribute("aria-labelledby")!)?.textContent, "Ink");
  const radios = [...group.querySelectorAll<HTMLButtonElement>("[role=radio]")];
  assert.deepEqual(radios.map((r) => r.querySelector(".ink-name")!.textContent), ["Indigo", "Sepia", "Viridian", "Vermilion", "Cobalt", "Iron gall"]);
  assert.deepEqual(radios.map((r) => r.getAttribute("aria-checked")), ["true", "false", "false", "false", "false", "false"]);
  assert.deepEqual(radios.map((r) => r.tabIndex), [0, -1, -1, -1, -1, -1], "one stop in the tab order, on the ink in use");
  const vermilion = radios[3];
  assert.equal(vermilion.getAttribute("aria-disabled"), "true");
  const described = vermilion.getAttribute("aria-describedby")!.split(" ").map((id) => document.getElementById(id)?.textContent);
  assert.deepEqual(described, ["Tick 25 tasks", "12 of 25"]);
  assert.equal(vermilion.title, "Vermilion: Tick 25 tasks (12 of 25)");
  assert.equal(radios[1].querySelector(".ink-goal")?.textContent, "Finish Getting started", "a yes-or-no goal has no count");
  assert.equal(radios[5].querySelector(".ink-goal")?.textContent, "Write on 7 different days", "nor does one not counted yet");

  vermilion.click();
  assert.deepEqual(log, [], "a locked ink isn't picked");
  radios[0].focus();
  radios[0].dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  assert.equal(document.activeElement, radios[1], "the arrows reach a locked ink, to read its goal");
  assert.deepEqual(log, []);
  radios[1].dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  assert.deepEqual(log, ["ink:viridian"], "and pick an earned one");
  assert.deepEqual(radios.map((r) => r.getAttribute("aria-checked")), ["false", "false", "true", "false", "false", "false"]);
  radios[0].click();
  assert.deepEqual(log, ["ink:viridian", "ink:indigo"]);
  document.activeElement!.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
});
