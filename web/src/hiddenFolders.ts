// Hidden folders: the ones the sidebar's Folders section leaves out (Config and Templates to start
// with). The list is the workspace's (`hidden_folders:` in Config/Settings.md); whether you see them
// anyway is yours (`show_hidden_folders:`). Hiding only touches the sidebar's tree: search, Notes,
// links and agents find what's in a hidden folder as before.
import { api } from "./api.ts";
import { readSettings, SETTINGS_NOTE, SETTINGS_SCHEMA, settingsNote, withSetting } from "../../src/core/schema.ts";

/** What a workspace hides until it says otherwise. */
export const DEFAULT_HIDDEN = SETTINGS_SCHEMA.properties.hidden_folders.default as string[];

/** A folder as the list holds it: no slashes at either end. */
export const cleanFolder = (folder: string) => folder.trim().replace(/^\/+|\/+$/g, "");

/** The listed folder that hides `folder`: itself, or the folder it's in. Null if it shows. */
export function hiddenBy(folder: string, hidden: string[]): string | null {
  return hidden.map(cleanFolder).find((h) => h && (folder === h || folder.startsWith(`${h}/`))) ?? null;
}

/** The listed folders that are there, for the sidebar's "Show hidden folders (N)". */
export const hiddenThere = (folders: string[], hidden: string[]) => folders.filter((f) => hidden.map(cleanFolder).includes(f));

/** The list with `folder` hidden (any folder listed inside it goes, since it's hidden with it) or shown. */
export function withFolderHidden(hidden: string[], folder: string, hide: boolean): string[] {
  const dir = cleanFolder(folder);
  const rest = hidden.map(cleanFolder).filter((h) => h && h !== dir && !(hide && h.startsWith(`${dir}/`)));
  return hide ? [...rest, dir] : rest;
}

/** The workspace's hidden folders: what Config/Settings.md lists, or the default if it says nothing. */
export async function loadHidden(): Promise<string[]> {
  const file = await api.note(SETTINGS_NOTE).catch(() => null);
  return (file && readSettings(file.content).hidden_folders) ?? DEFAULT_HIDDEN;
}

/** Save the list into Config/Settings.md (made if there's none), keeping the rest of it. */
export async function saveHidden(list: string[], gamified: boolean): Promise<void> {
  const file = await api.note(SETTINGS_NOTE).catch(() => null);
  if (file) await api.save(SETTINGS_NOTE, withSetting(file.content, "hidden_folders", list), file.version);
  else await api.create(SETTINGS_NOTE, settingsNote({ gamified, hidden_folders: list }));
}
