import "./dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { appSettings, matchSettings, openSettings, planText, type SettingsApp } from "../web/src/settings.ts";
import type { Billing } from "../web/src/api.ts";

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
    organizing: null,
    setOrganizing: (id) => ((app.organizing = id), log.push(`organizing:${id}`)),
    showHidden: false,
    setShowHidden: (on) => ((app.showHidden = on), log.push(`showHidden:${on}`)),
    hiddenFolders: { list: ["Config", "Templates"], canChange: true },
    setHiddenFolders: (list) => ((app.hiddenFolders = { ...app.hiddenFolders, list }), log.push(`hidden:${list.join("|")}`)),
    localVault: { projectRoot: "/code/commonink", vault: "/notes" },
    shortcuts: () => log.push("shortcuts"),
    connectAgent: () => log.push("connectAgent"),
    billing: null,
    subscribe: (i) => log.push(`subscribe:${i}`),
    manageBilling: () => log.push("manageBilling"),
    agentInstructions: () => log.push("agentInstructions"),
    deleteAccount: null,
    ...over,
  };
  return { app, log };
}

const titles = (q: string, app: SettingsApp) => matchSettings(q, appSettings(app)).map((s) => s.title);

test("search finds settings by every word, across title, description, section and keywords", () => {
  const { app } = fakeApp();
  assert.deepEqual(titles("", app), ["Theme", "Ink", "Always show Contacts", "Always show Calendar", "Always show Assets", "Always show Views", "Show hidden folders", "Line numbers", "Wrap code", "HTML notes", "Vim keys", "Vim: j and k by screen line", "Keyboard shortcuts", "Shortcut tips", "Connect an agent", "Agent instructions", "Unlock as you go", "Hidden folders", "Organizing style"]);
  assert.deepEqual(titles("dark", app), ["Theme"]);
  assert.deepEqual(titles("VIM", app), ["Line numbers", "Vim keys", "Vim: j and k by screen line"]);
  assert.deepEqual(titles("vim gj", app), ["Vim: j and k by screen line"]);
  assert.deepEqual(titles("wrap", app), ["Wrap code", "Vim: j and k by screen line"]);
  assert.deepEqual(titles("mcp", app), ["Connect an agent", "Agent instructions"]);
  assert.deepEqual(titles("agents.md", app), ["Agent instructions", "Organizing style"]);
  assert.deepEqual(titles("sidebar events", app), ["Always show Calendar"]);
  assert.deepEqual(titles("editor", app), ["Line numbers", "Wrap code", "HTML notes"]);
  assert.deepEqual(titles("yaml", app), ["Show hidden folders"]);
  assert.deepEqual(titles("templates", app), ["Show hidden folders", "Hidden folders"]);
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
  assert.deepEqual(titles("", app), ["Theme", "Ink", "Show hidden folders", "Line numbers", "Wrap code", "HTML notes", "Vim keys", "Vim: j and k by screen line", "Keyboard shortcuts", "Connect an agent", "Agent instructions", "Unlock as you go", "Hidden folders", "Organizing style"]);
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
  assert.deepEqual([...dialog.querySelectorAll("h3")].map((h) => h.textContent), ["Appearance", "Sidebar", "Editor", "Keyboard", "Agents"]);
  const tabs = [...dialog.querySelectorAll<HTMLElement>(".st-tab")];
  assert.deepEqual(tabs.map((t) => [t.textContent, t.getAttribute("aria-selected")]), [["User", "true"], ["Workspace", "false"]]);
  assert.equal(dialog.querySelector("#st-theme")?.closest(".st-row")?.querySelector(".st-key")?.textContent, "theme", "each setting names its key in the file");
  tabs[1].click();
  assert.deepEqual([...dialog.querySelectorAll("h3")].map((h) => h.textContent), ["Workspace"]);
  tabs[0].click();
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

test("online, Integrations shows the Google account with what Calendar and Contacts may do, and its buttons", async () => {
  const log: string[] = [];
  let connection: { account: string; canWrite: boolean; contacts: "none" | "read" | "write" } | null = null;
  let github: { mode: string; connection: { account: string } | null } | null = { mode: "real", connection: null };
  const { app } = fakeApp({
    localVault: null,
    integrations: {
      status: async () => ({ mode: "real", connection }),
      connectCalendar: () => log.push("calendar"),
      connectContacts: (write) => log.push(`contacts:${write}`),
      disconnect: async () => void log.push("disconnect"),
      github: { status: async () => github, connect: () => log.push("github"), disconnect: async () => void log.push("github:disconnect") },
    },
  });
  assert.deepEqual(titles("google contacts", app), ["Google"]);
  assert.deepEqual(titles("", fakeApp().app).includes("Google"), false); // locally there's none
  const render = async (id = "google") => {
    const s = appSettings(app).find((x) => x.id === id)!;
    const [box] = (s.control as { render(): HTMLElement[] }).render();
    await new Promise((r) => setTimeout(r, 0));
    return box;
  };
  let box = await render();
  assert.match(box.textContent!, /Not connected\./);
  [...box.querySelectorAll("button")].forEach((b) => b.click());
  assert.deepEqual(log, ["calendar", "contacts:false"]);

  connection = { account: "me@gmail.example", canWrite: false, contacts: "read" };
  box = await render();
  assert.match(box.textContent!, /Connected as me@gmail\.example\..*Syncs into People\/ \(read only\)/);
  assert.deepEqual([...box.querySelectorAll("button")].map((b) => b.textContent), ["Allow editing", "Disconnect Google"]);

  // GitHub, next to it: connect or disconnect, or why it can't be where the server has no OAuth app.
  assert.deepEqual(titles("github private", app), ["GitHub"]);
  box = await render("github");
  assert.match(box.textContent!, /Not connected\. Cards show public repositories only\./);
  box.querySelector("button")!.click();
  github = { mode: "real", connection: { account: "octocat" } };
  box = await render("github");
  assert.match(box.textContent!, /Connected as octocat\./);
  box.querySelector("button")!.click();
  assert.deepEqual(log.slice(2), ["github", "github:disconnect"]);
  github = { mode: "off", connection: null };
  box = await render("github");
  assert.match(box.textContent!, /isn't set up on this server.*GITHUB_CLIENT_ID.*public repositories still show as cards/);
  assert.equal(box.querySelector("button"), null);
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

const billing = (plan: Billing["plan"]): Billing => ({
  on: true,
  plans: { month: { label: "$8 a month", price: 8 }, year: { label: "$60 a year ($5 a month)", price: 60 } },
  graceDays: 7,
  plan,
});

test("Plan shows only where billing is set up: subscribe until you do, then manage it on Stripe", () => {
  const plan = (b: Billing | null) => {
    const { app, log } = fakeApp({ billing: b });
    return { log, settings: appSettings(app).filter((s) => s.section === "Plan") };
  };
  assert.deepEqual(plan(null).settings, []);
  assert.deepEqual(plan({ ...billing({ status: "free", canWrite: true }), on: false }).settings, []);

  const trial = plan(billing({ status: "trial", canWrite: true, trialEnds: Date.UTC(2026, 9, 17, 12) }));
  assert.deepEqual(trial.settings.map((s) => s.title), ["Your plan", "Yearly: $60 a year ($5 a month)", "Monthly: $8 a month"]);
  assert.match(trial.settings[0].description, /^Your free trial runs until October 17, 2026\./);
  for (const s of trial.settings) if (s.control.kind === "button") s.control.run();
  assert.deepEqual(trial.log, ["subscribe:year", "subscribe:month"]);

  const paying = plan(billing({ status: "active", canWrite: true, interval: "year", periodEnd: Date.UTC(2027, 9, 3, 12), customer: true }));
  assert.deepEqual(paying.settings.map((s) => s.title), ["Your plan", "Manage billing"]);
  assert.equal(paying.settings[0].description, "You subscribe at $60 a year ($5 a month), renewing October 3, 2027. Thank you.");
  const manage = paying.settings[1].control;
  assert.ok(manage.kind === "button");
  manage.run();
  assert.deepEqual(paying.log, ["manageBilling"]);
  // Search finds it by what people call it.
  const { app } = fakeApp({ billing: billing({ status: "trial", canWrite: true, trialEnds: Date.now() }) });
  assert.deepEqual(titles("subscription", app).slice(0, 1), ["Your plan"]);
});

test("each plan reads as a sentence: ending, a failed payment, lapsed", () => {
  const end = Date.UTC(2026, 10, 3, 12);
  assert.equal(planText(billing({ status: "active", canWrite: true, interval: "month", periodEnd: end, cancelling: true })), "You subscribe at $8 a month until November 3, 2026, when it ends. Resume it from Manage billing.");
  assert.equal(planText(billing({ status: "past_due", canWrite: true, graceEnds: end })), "Your last payment didn't go through. Update your card by November 3, 2026 to keep editing.");
  assert.match(planText(billing({ status: "lapsed", canWrite: false })), /read-only: everyone can still read and export them/);
});

test("Open settings file opens the file for the tab you're on, as VS Code's does", () => {
  const { app } = fakeApp();
  const opened: string[] = [];
  const open = (tab: number) => {
    openSettings(() => appSettings(app), { openFile: (scope) => opened.push(scope) });
    document.querySelectorAll<HTMLElement>("#settings .st-tab")[tab].click();
    document.querySelector<HTMLElement>("#settings .st-file")!.click();
    assert.equal(document.querySelector("#settings"), null, "Settings closes for the file");
  };
  open(0);
  open(1);
  assert.deepEqual(opened, ["user", "workspace"]);
});

test("the workspace's hidden folders are typed as a list, and only someone who can edit the workspace changes them", () => {
  const { app, log } = fakeApp();
  const setting = appSettings(app).find((s) => s.id === "hidden-folders")!;
  assert.equal(setting.section, "Workspace");
  assert.ok(setting.control.kind === "text");
  assert.equal(setting.control.value, "Config, Templates");
  setting.control.set(" Config, /Drafts/ ,, Config");
  assert.deepEqual(log, ["hidden:Config|Drafts"]);
  assert.equal(appSettings(fakeApp({ hiddenFolders: { list: [], canChange: false } }).app).find((s) => s.id === "hidden-folders")!.disabled, true);
});

test("online, Delete your account is in the Danger zone, last, and only opens the confirming dialog", () => {
  const { app, log } = fakeApp({ localVault: null, deleteAccount: () => log.push("deleteAccount") });
  const all = appSettings(app);
  const del = all.find((s) => s.id === "delete-account")!;
  assert.equal(del.section, "Danger zone");
  assert.equal(all.at(-1), del);
  assert.deepEqual(titles("delete account", app), ["Delete your account"]);
  assert.ok(del.control.kind === "button" && del.control.danger);
  if (del.control.kind === "button") del.control.run();
  assert.deepEqual(log, ["deleteAccount"]);
  // Locally there's no account to delete.
  assert.equal(appSettings(fakeApp().app).find((s) => s.id === "delete-account"), undefined);
});
