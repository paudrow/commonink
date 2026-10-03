// Your own settings as a file, as VS Code's user settings.json is to its Settings: Config/Users/<you>.md
// (schema.ts, USER_SCHEMA). Without the file, your choices stay in this browser as before. Once
// you've opened it (Settings → User → Open file), it wins: what it says applies when the app
// loads and whenever it changes, and every change in Settings is written into it too.
import { api } from "./api.ts";
import { readValues, USER_SCHEMA, userSettingsNote, withValue, type SettingValue } from "../../src/core/schema.ts";

/** A setting the file can hold: its key there, and how the app reads and changes it. */
export interface Personal {
  key: string;
  get(): SettingValue;
  set(value: SettingValue): void;
}

let path = "";
let entries: Personal[] = [];
/** Applying the file: the settings it changes aren't written back to it. */
let applying = false;
let writes: Promise<unknown> = Promise.resolve();

/** Where your file is, and the settings it can hold. */
export function setupUserSettings(at: string, list: Personal[]) {
  path = at;
  entries = list;
}

export const userSettingsFile = () => path;

/** Apply what your file says, if you have one. */
export async function applyUserFile(): Promise<void> {
  const file = path ? await api.note(path).catch(() => null) : null;
  if (!file) return;
  const values = readValues(file.content, USER_SCHEMA);
  applying = true;
  try {
    for (const e of entries) if (e.key in values && JSON.stringify(values[e.key]) !== JSON.stringify(e.get())) e.set(values[e.key]);
  } finally {
    applying = false;
  }
}

/** A change made in the app: into your file too, if you have one. One write at a time, so quick changes don't trip over each other. */
export function keepInFile(key: string, value: SettingValue) {
  if (applying || !path) return;
  writes = writes.then(async () => {
    const file = await api.note(path).catch(() => null);
    if (!file) return;
    const next = withValue(file.content, key, value);
    if (next !== file.content) await api.save(path, next, file.version);
  }).catch(() => {});
}

/** Your file, written with every setting's current value if you have none yet. Resolves to its path. */
export async function ensureUserFile(): Promise<string> {
  const file = await api.note(path).catch(() => null);
  if (!file) await api.create(path, userSettingsNote(Object.fromEntries(entries.map((e) => [e.key, e.get()]))));
  return path;
}
