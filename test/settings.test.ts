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
  assert.deepEqual(titles("", app), ["Theme", "Line numbers", "Wrap code", "HTML notes", "Vim keys", "Vim: j and k by screen line", "Keyboard shortcuts", "Connect an agent"]);
  assert.deepEqual(titles("dark", app), ["Theme"]);
  assert.deepEqual(titles("VIM", app), ["Line numbers", "Vim keys", "Vim: j and k by screen line"]);
  assert.deepEqual(titles("vim gj", app), ["Vim: j and k by screen line"]);
  assert.deepEqual(titles("wrap", app), ["Wrap code", "Vim: j and k by screen line"]);
  assert.deepEqual(titles("mcp", app), ["Connect an agent"]);
  assert.deepEqual(titles("editor", app), ["Line numbers", "Wrap code", "HTML notes"]);
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
  assert.deepEqual([...dialog.querySelectorAll("h3")].map((h) => h.textContent), ["Appearance", "Editor", "Keyboard", "Agents"]);
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
  const theme = dialog.querySelector<HTMLSelectElement>("#st-theme")!;
  theme.value = "dark";
  theme.dispatchEvent(new window.Event("change", { bubbles: true }));
  assert.deepEqual(log, ["vim:true", "theme:dark"]);

  document.activeElement!.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(document.querySelector("#settings"), null);
  assert.equal(document.activeElement, before, "the focus goes back where it was");
});

test("online, Integrations shows the Google account with what Calendar and Contacts may do, and its buttons", async () => {
  const log: string[] = [];
  let connection: { account: string; canWrite: boolean; contacts: "none" | "read" | "write" } | null = null;
  const { app } = fakeApp({
    localVault: null,
    integrations: {
      status: async () => ({ mode: "real", connection }),
      connectCalendar: () => log.push("calendar"),
      connectContacts: (write) => log.push(`contacts:${write}`),
      disconnect: async () => void log.push("disconnect"),
    },
  });
  assert.deepEqual(titles("contacts", app), ["Google"]);
  assert.deepEqual(titles("", fakeApp().app).includes("Google"), false); // locally there's none
  const render = async () => {
    const s = appSettings(app).find((x) => x.id === "google")!;
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
});
