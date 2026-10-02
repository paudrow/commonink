// Whether this workspace is gamified: the parts of the app that unlock or appear as you use it, and
// the small rewards along the way. On (the default), the sidebar grows as Contacts, Calendar, Assets
// and Smart folders come into use, inks are earned, shortcut tips teach a button's keys, and clearing
// Today gets a small celebration. Off, everything is there from the start: the whole sidebar, every
// ink, and no tips, unlocks or celebrations. It's the workspace's, so everyone in it gets the same:
// an owner changes it (online, in Settings or the workspace's settings; locally, the vault's person
// does), and the server keeps it (cloud/src/admin.ts, or .commonink/settings.json beside a local vault).
//
// A feature that unlocks, nudges or celebrates asks `gamified()` before it does, and one that has
// already drawn something listens with `onGamified` to redraw when an owner flips it in this tab.
import { api } from "./api.ts";

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

/** Ask the server, once the workspace is picked. If it can't say, the app stays gamified, as it was before this setting. */
export async function loadGamified(): Promise<boolean> {
  const s = await api.workspaceSettings().catch(() => null);
  if (s) apply(s.gamified !== false);
  return on;
}

/** An owner's change: saved for the whole workspace, then applied here. Others see it when they next load the app. */
export async function setGamified(next: boolean): Promise<void> {
  const s = await api.setWorkspaceSettings({ gamified: next });
  apply(s.gamified !== false);
}
