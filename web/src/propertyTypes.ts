// The workspace's declared property types (`properties:` in Config/Settings.md), kept here so every
// note's properties table, completions and checks read the same ones. Loaded at start and again
// whenever the settings file changes, here or anywhere; picking a type in a table writes it there.
import { api } from "./api.ts";
import { readPropertyTypes, SETTINGS_NOTE, type PropertyTypes } from "../../src/core/schema.ts";

let current: PropertyTypes = {};
const listeners = new Set<() => void>();

/** The declared types now. */
export const propertyTypes = (): PropertyTypes => current;

/** Call `fn` when the declared types change (to draw open notes again). */
export function onPropertyTypes(fn: () => void): void {
  listeners.add(fn);
}

function apply(next: PropertyTypes) {
  if (JSON.stringify(next) === JSON.stringify(current)) return;
  current = next;
  for (const fn of listeners) fn();
}

/** Read them from the settings file. */
export async function loadPropertyTypes(): Promise<void> {
  const file = await api.note(SETTINGS_NOTE).catch(() => null);
  apply(readPropertyTypes(file?.content ?? ""));
}

/** Declare `name` as `type` for every note (or "auto": guess it again). Shown at once; the server writes the settings file. */
export async function setPropertyType(name: string, type: string): Promise<void> {
  const before = current;
  const next = { ...current };
  if (type === "auto") delete next[name];
  else next[name] = type as PropertyTypes[string];
  apply(next);
  try {
    await api.setPropertyType(name, type);
  } catch (e) {
    apply(before);
    throw e;
  }
}
