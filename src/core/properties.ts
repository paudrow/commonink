// Property types for the whole workspace: what notes' properties are, and declaring one. The types
// live in the workspace settings (Config/Settings.md) as `properties: { due: date, … }`; the app's
// properties table, the CLI and agents all read and write them there, through these.
import { VaultError } from "./paths.ts";
import { CONFIG, isPropertyType, PROPERTY_TYPES, readPropertyTypes, scanFrontmatter, SETTINGS_NOTE, typeInfo, typeSettable, withPropertyType, type PropertyType, type PropertyTypes, type TypeInfo } from "./schema.ts";
import type { Vault } from "./vault.ts";

/** The property types the workspace declares. */
export const propertyTypes = (vault: Vault): PropertyTypes => readPropertyTypes(vault.files.read(SETTINGS_NOTE) ?? "");

export interface PropertyUse extends TypeInfo {
  name: string;
  /** How many notes have it. */
  notes: number;
}

/** A property of one note: its type and why, and its value as written. */
export interface NoteProperty extends TypeInfo {
  name: string;
  value: string;
}

/** Every property the workspace's notes have, or declares a type for, with its type and how many notes have it. Settings files aren't counted. */
export function propertiesInUse(vault: Vault): PropertyUse[] {
  const types = propertyTypes(vault);
  const found = new Map<string, { notes: number; guesses: Map<string, number>; info: TypeInfo }>();
  for (const n of vault.list()) {
    if (n.kind !== "md" || n.path.startsWith(`${CONFIG}/`)) continue;
    const md = vault.files.read(n.path);
    const scan = md && scanFrontmatter(md);
    if (!scan) continue;
    const seen = new Set<string>();
    for (const f of scan.fields) {
      if (seen.has(f.key)) continue;
      seen.add(f.key);
      const info = typeInfo(n.path, f.key, f.value, types);
      let p = found.get(f.key);
      if (!p) found.set(f.key, (p = { notes: 0, guesses: new Map(), info }));
      p.notes++;
      if (info.source === "guessed") p.guesses.set(info.type, (p.guesses.get(info.type) ?? 0) + 1);
      else if (p.info.source === "guessed") p.info = info;
    }
  }
  const out: PropertyUse[] = [...found].map(([name, p]) => {
    // A guess is what most of its notes' values look like.
    const guess = [...p.guesses].sort((a, b) => b[1] - a[1])[0]?.[0];
    return { name, notes: p.notes, ...(p.info.source === "guessed" && guess ? { type: guess, source: "guessed" as const } : p.info) };
  });
  for (const [name, type] of Object.entries(types)) if (!found.has(name)) out.push({ name, notes: 0, type, source: "declared" });
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** One note's properties, each with its type. */
export function noteProperties(vault: Vault, target: string): { path: string; properties: NoteProperty[] } {
  const note = vault.read(target);
  const types = propertyTypes(vault);
  const scan = scanFrontmatter(note.content);
  const seen = new Set<string>();
  const properties: NoteProperty[] = [];
  for (const f of scan?.fields ?? []) {
    if (seen.has(f.key)) continue;
    seen.add(f.key);
    properties.push({ name: f.key, value: note.content.slice(f.value.from, f.value.to).trim(), ...typeInfo(note.path, f.key, f.value, types) });
  }
  return { path: note.path, properties };
}

/** "auto": not declared, so it's guessed from each note's value again. */
export const TYPE_CHOICES = [...PROPERTY_TYPES, "auto"] as const;

/**
 * Declare `name` as `type` for every note in the workspace (or, with "auto", stop declaring it), in
 * Config/Settings.md. Returns the settings note's write, or null when nothing changed.
 */
export function setPropertyType(vault: Vault, name: string, type: string, source: string) {
  const key = name.trim().replace(/:$/, "");
  if (!key || /^[-#]|[:\n]/.test(key)) throw new VaultError(`${JSON.stringify(name)} isn't a property name`);
  if (type !== "auto" && !isPropertyType(type)) throw new VaultError(`A property's type is one of ${TYPE_CHOICES.join(", ")}, not ${JSON.stringify(type)}`);
  if (!typeSettable("Note.md", key)) throw new VaultError(`${key} is one of Common Ink's own properties: its type is fixed`);
  const md = vault.files.read(SETTINGS_NOTE);
  const next = withPropertyType(md ?? "", key, type === "auto" ? null : (type as PropertyType));
  if (md === next) return null;
  return md === null ? vault.create(SETTINGS_NOTE, next, source) : vault.save(SETTINGS_NOTE, next, { source });
}

export function fmtProperties(list: PropertyUse[]): string {
  if (!list.length) return `No note has properties yet. Declare a type with commonink property-type set <name> <type>; types are kept in ${SETTINGS_NOTE}.`;
  return [
    `Properties and their types (declared ones are in ${SETTINGS_NOTE} under properties:; the rest are guessed from their values):`,
    ...list.map((p) => `- ${p.name}: ${p.type} (${p.source}), ${p.notes} note${p.notes === 1 ? "" : "s"}`),
  ].join("\n");
}

export function fmtNoteProperties(r: { path: string; properties: NoteProperty[] }): string {
  if (!r.properties.length) return `${r.path} has no properties.`;
  return [`${r.path}:`, ...r.properties.map((p) => `- ${p.name}: ${p.type} (${p.source}) = ${p.value || "(empty)"}`)].join("\n");
}
