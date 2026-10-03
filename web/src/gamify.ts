// Whether this workspace is gamified: the parts of the app that unlock or appear as you use it, and
// the small rewards along the way. On (the default), the sidebar grows as Contacts, Calendar, Assets
// and Smart folders come into use, inks are earned, shortcut tips teach a button's keys, and clearing
// Today gets a small celebration. Off, everything is there from the start: the whole sidebar, every
// ink, and no tips, unlocks or celebrations. It's the workspace's, so everyone in it gets the same:
// it's kept in the workspace's settings file, Config/Settings.md (`gamified: false`), which anyone who
// can edit notes can change, there or in Settings. Before there was a file, an owner's choice was kept
// by the server (cloud/src/admin.ts, or .commonink/settings.json beside a local vault); a workspace
// whose file doesn't say still uses that.
//
// A feature that unlocks, nudges or celebrates asks `gamified()` before it does, and one that has
// already drawn something listens with `onGamified` to redraw when an owner flips it in this tab.
import { api } from "./api.ts";
import { readSettings, SETTINGS_NOTE, withSetting } from "../../src/core/schema.ts";

let on = true;
const listeners = new Set<(on: boolean) => void>();

/** Is this workspace gamified? True until the server says otherwise. */
export const gamified = () => on;

/** Call `fn` whenever it changes in this tab. Returns a function that stops listening. */
export function onGamified(fn: (on: boolean) => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

function apply(next: boolean) {
  if (next === on) return;
  on = next;
  for (const fn of listeners) fn(on);
}

/** The settings file (schema.ts), or null if this workspace has none yet (or it can't be read). */
const settingsFile = () => api.note(SETTINGS_NOTE).catch(() => null);

/**
 * Read it once the workspace is picked, and again whenever Config/Settings.md changes: the file's
 * `gamified:` wins, and a workspace whose file doesn't say uses what the server kept before there was
 * a file. If neither can say, the app stays gamified, as it was before this setting.
 */
export async function loadGamified(): Promise<boolean> {
  const [file, saved] = await Promise.all([settingsFile(), api.workspaceSettings().catch(() => null)]);
  const fromFile = file ? readSettings(file.content).gamified : undefined;
  if (fromFile !== undefined) apply(fromFile);
  else if (saved) apply(saved.gamified !== false);
  return on;
}

/** A change from Settings: written into Config/Settings.md (made if there's none), keeping the rest of it, then applied here. Others see it when they next load the app. */
export async function setGamified(next: boolean): Promise<void> {
  const file = await settingsFile();
  const text = withSetting(file?.content ?? "", "gamified", next);
  if (file) await api.save(SETTINGS_NOTE, text, file.version);
  else await api.create(SETTINGS_NOTE, text);
  apply(next);
}
