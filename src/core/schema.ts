// What front matter means to Common Ink, in one place: each property the app reads, its type, its
// allowed values and a line on what it does. The editor's completions, hover help and error
// squiggles (web/src/editor/properties.ts), the problems agents are told about after a write
// (commands/notes.ts) and the workspace's settings file (Config/Settings.md) all come from here, so
// a new property is added once. The schemas are JSON Schema, so other editors can use them too.
//
// Notes may carry any property of their own: only the ones listed are checked. The settings file is
// stricter, since a misspelled setting would silently do nothing. No Node imports: the web app uses it too.
import { frontmatterEntries, frontmatterText } from "./frontmatter.ts";
import { PRESETS, type PresetId } from "./presets.ts";

/** The folder that holds the workspace's own configuration. */
export const CONFIG = "Config";
/** The workspace's settings: the front matter of this note. */
export const SETTINGS_NOTE = `${CONFIG}/Settings.md`;

export interface PropSchema {
  type: "string" | "boolean" | "array";
  description: string;
  enum?: string[];
  /** "date": YYYY-MM-DD, the form the app sorts by. "person": a link to their contact, "[[People/Sam Lee]]". */
  format?: "date" | "person";
  items?: { type: "string"; enum?: string[]; format?: "person" };
  default?: unknown;
  /** Shown in completions as what a typical value looks like. */
  examples?: string[];
}

export interface ObjectSchema {
  $schema: string;
  $id: string;
  title: string;
  description: string;
  type: "object";
  properties: Record<string, PropSchema>;
  /** false: a key that isn't listed is a problem (the settings file). */
  additionalProperties: boolean;
}

const JSON_SCHEMA = "https://json-schema.org/draft/2020-12/schema";

const TITLE: PropSchema = { type: "string", description: "The note's title, shown instead of its first heading or file name." };
const TAGS: PropSchema = { type: "array", items: { type: "string" }, description: "The note's tags, the same as #tags in its text. Write them as [idea, work/acme] or one `- tag` per line.", examples: ["[idea, work]"] };
const DATE = (what: string): PropSchema => ({ type: "string", format: "date", description: `${what} Written YYYY-MM-DD; notes sorted by date use it.`, examples: ["2026-10-02"] });

const NOTE_PROPS: Record<string, PropSchema> = {
  title: TITLE,
  tags: TAGS,
  date: DATE("The note's date."),
  created: DATE("When the note was first written."),
  published: DATE("When the note was published."),
  people: {
    type: "array",
    items: { type: "string", format: "person" },
    description: "Who the note is about or with, as links to their contacts. The note shows on each of their contacts.",
    examples: ['["[[People/Sam Lee]]"]'],
  },
};

export const NOTE_SCHEMA: ObjectSchema = {
  $schema: JSON_SCHEMA,
  $id: "commonink:note",
  title: "Note properties",
  description: "The properties Common Ink reads from a note's front matter. Any other property is the note's own.",
  type: "object",
  properties: NOTE_PROPS,
  additionalProperties: true,
};

export const TEMPLATE_SCHEMA: ObjectSchema = {
  ...NOTE_SCHEMA,
  $id: "commonink:template",
  title: "Template properties",
  description: "A template's own properties, which say how notes are made from it. They aren't copied into the new note.",
  properties: {
    ...NOTE_PROPS,
    title: { type: "string", description: "The new note's title. Placeholders work: \"{{date}} {{ask:Client}} meeting\". Default: the template's name.", examples: ['"{{date}} meeting"'] },
    folder: { type: "string", description: "The folder new notes made from this template go in. Default: where you are.", examples: ["Meetings"] },
    applies_to: { type: "string", description: "New note in this folder, or under it, starts from this template.", examples: ["Meetings/"] },
  },
};

const LIST = (description: string, example: string): PropSchema => ({ type: "array", items: { type: "string" }, description, examples: [example] });

export const PERSON_SCHEMA: ObjectSchema = {
  ...NOTE_SCHEMA,
  $id: "commonink:person",
  title: "Contact properties",
  description: "What Contacts reads from a person's note in People/.",
  properties: {
    ...NOTE_PROPS,
    email: LIST("Their email addresses.", "sam@example.com"),
    phone: LIST("Their phone numbers.", '"+1 555 0100"'),
    company: { type: "string", description: "Where they work." },
    role: { type: "string", description: "What they do there." },
    links: LIST("Links about them: a profile, a site.", "https://example.com"),
    aliases: LIST("Other names they go by, so @mentions and links find them.", "[Sam, Sammy]"),
    check_in: { type: "string", description: "How often to be in touch: weekly, every 2 weeks, monthly, 3m. Contacts shows who's due.", examples: ["every 2 weeks", "monthly"] },
  },
};

export const SETTINGS_SCHEMA: ObjectSchema = {
  $schema: JSON_SCHEMA,
  $id: "commonink:settings",
  title: "Workspace settings",
  description: "Settings for everyone in this workspace. Settings (⌘,) changes the same values.",
  type: "object",
  properties: {
    title: TITLE,
    tags: TAGS,
    gamified: {
      type: "boolean",
      default: true,
      description:
        "Unlock as you go, for everyone here. true: the sidebar grows as you use it, inks are earned, tips teach shortcuts and clearing Today gets a small celebration. false: everything is there from the start.",
    },
    organizing: {
      type: "string",
      enum: PRESETS.map((p) => p.id),
      description: `How this vault is organized, which agents follow: ${PRESETS.map((p) => `${p.id} (${p.name})`).join(", ")}. Changing it in Settings rewrites the Organizing section of Config/AGENTS.md.`,
    },
  },
  additionalProperties: false,
};

/** Where each person's own settings file is: Config/Users/<their name>.md. */
export const USERS = `${CONFIG}/Users`;
export const userSettingsPath = (name: string) => `${USERS}/${name.replace(/[\\/:*?"<>|#^[\]]/g, "").trim() || "Me"}.md`;

const BOOL = (description: string, dflt: boolean): PropSchema => ({ type: "boolean", default: dflt, description });

/** One person's settings: how the app looks and behaves for them. Settings → User changes the same values. */
export const USER_SCHEMA: ObjectSchema = {
  $schema: JSON_SCHEMA,
  $id: "commonink:user",
  title: "Your settings",
  description: "How the app looks and behaves for you. Settings (⌘,) → User changes the same values.",
  type: "object",
  properties: {
    title: TITLE,
    tags: TAGS,
    theme: { type: "string", enum: ["system", "light", "dark"], default: "system", description: "Light, dark, or whichever your system uses." },
    ink: { type: "string", enum: ["indigo", "sepia", "viridian", "vermilion", "cobalt", "iron-gall"], default: "indigo", description: "The color of links, ticks and highlights. With Unlock as you go on, an ink is yours once you've earned it." },
    vim: BOOL("Vim keys in the editor.", false),
    vim_display_lines: BOOL("With Vim keys, j and k move by the line on screen (gj, gk), not the line in the file.", false),
    line_numbers: BOOL("Number the lines beside a note's text.", false),
    wrap_code: BOOL("Long lines in code blocks wrap; false: they scroll. A block can say otherwise (```ts nowrap).", true),
    html_notes: { type: "string", enum: ["preview", "source"], default: "preview", description: "Open HTML notes as the page they make, or as their source." },
    shortcut_tips: BOOL("The third click on a button with a shortcut says, once, which keys do it.", true),
    show_config_folder: BOOL("Show Config among the sidebar's folders.", false),
    always_show: {
      type: "array",
      items: { type: "string", enum: ["contacts", "calendar", "assets", "smart"] },
      description: "Sidebar items to show even before they're in use (with Unlock as you go on): contacts, calendar, assets, smart (Smart folders).",
      examples: ["[calendar, contacts]"],
    },
  },
  additionalProperties: false,
};

/** The schema for the note at `path`: the settings file's, a template's, a contact's, or any note's. */
export function schemaFor(path: string): ObjectSchema {
  if (path === SETTINGS_NOTE) return SETTINGS_SCHEMA;
  if (path.startsWith(`${USERS}/`)) return USER_SCHEMA;
  if (path.startsWith("Templates/")) return TEMPLATE_SCHEMA;
  if (path.startsWith("People/")) return PERSON_SCHEMA;
  return NOTE_SCHEMA;
}

// ------------------------------------------------------------------ reading front matter with positions

export interface Item {
  text: string;
  from: number;
  to: number;
}

export type Value =
  | ({ kind: "scalar"; quoted: boolean } & Item)
  /** `key: |` or `key: >`, with the text on the lines under it. */
  | { kind: "block"; from: number; to: number }
  | { kind: "list"; items: Item[]; from: number; to: number }
  | { kind: "map"; from: number; to: number }
  | { kind: "empty"; from: number; to: number };

export interface Field {
  key: string;
  /** The key's own characters. */
  from: number;
  to: number;
  value: Value;
}

export interface Scan {
  fields: Field[];
  /** Lines that aren't `key: value`, a list item, a nested line or a comment. */
  stray: Item[];
  /** The YAML between the --- lines. */
  from: number;
  to: number;
}

const OPEN = /^---[ \t]*\r?\n/;

/**
 * A note's front matter, field by field with where each key and value is, or null without one. A
 * small reading of YAML, enough for front matter: `key: value`, `key: [a, b]`, a `- item` per line,
 * nested lines, `|` blocks and comments.
 */
export function scanFrontmatter(md: string): Scan | null {
  const open = md.match(OPEN);
  if (!open) return null;
  const from = open[0].length;
  const fields: Field[] = [];
  const stray: Item[] = [];
  let at = from;
  let to = -1;
  let last: Field | null = null;
  // A `|`/`>` block, a list, or a value's nested lines own the indented lines under them.
  while (at < md.length) {
    const nl = md.indexOf("\n", at);
    const end = nl < 0 ? md.length : nl;
    const line = md.slice(at, end).replace(/\r$/, "");
    if (/^(---|\.\.\.)\s*$/.test(line)) {
      to = at;
      break;
    }
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      // nothing to read
    } else if (/^\s/.test(line) || /^-(\s|$)/.test(line)) {
      const item = line.match(/^(\s*)-(?:\s+(.*))?$/);
      if (last && item && (last.value.kind === "empty" || last.value.kind === "list")) {
        const dash = line.indexOf("-");
        const rest = line.slice(dash + 1);
        const text = stripComment(rest);
        const start = at + dash + 1 + (rest.length - rest.trimStart().length);
        const items = last.value.kind === "list" ? last.value.items : [];
        items.push({ text: unquote(text), from: start, to: start + text.length });
        last.value = { kind: "list", items, from: last.value.from, to: at + line.length };
      } else if (last && last.value.kind === "empty" && /^\s/.test(line)) {
        last.value = { kind: "map", from: at + line.search(/\S/), to: at + line.length };
      } else if (last && (last.value.kind === "map" || last.value.kind === "block") && /^\s/.test(line)) {
        last.value.to = at + line.length;
      } else if (last && last.value.kind === "scalar" && !last.value.quoted && /^\s/.test(line)) {
        // a plain value carried onto the next line
        last.value.to = at + line.length;
      } else stray.push({ text: line, from: at + line.search(/\S/), to: at + line.length });
    } else {
      const m = line.match(/^([^:#]+?)\s*:(?=\s|$)[ \t]*(.*)$/);
      if (!m) {
        stray.push({ text: line, from: at, to: at + line.length });
        last = null;
      } else {
        const valueAt = at + line.length - m[2].length;
        const raw = stripComment(m[2]);
        let value: Value;
        if (!raw) value = { kind: "empty", from: valueAt, to: valueAt };
        else if (/^[|>][+-]?\d*$/.test(raw)) value = { kind: "block", from: valueAt, to: valueAt + raw.length };
        else if (raw.startsWith("[")) value = { kind: "list", items: inlineItems(raw, valueAt), from: valueAt, to: valueAt + raw.length };
        else if (raw.startsWith("{")) value = { kind: "map", from: valueAt, to: valueAt + raw.length };
        else value = { kind: "scalar", text: unquote(raw), quoted: /^["']/.test(raw), from: valueAt, to: valueAt + raw.length };
        last = { key: m[1], from: at, to: at + m[1].length, value };
        fields.push(last);
      }
    }
    at = end + 1;
  }
  // Not closed yet: it's not front matter (yet), and the note's text isn't properties.
  if (to < 0) return null;
  return { fields, stray, from, to };
}

/** A value without a trailing ` # comment` (outside quotes). */
function stripComment(s: string): string {
  const t = s.trim();
  if (/^["']/.test(t)) {
    const close = t.indexOf(t[0], 1);
    return close > 0 ? t.slice(0, close + 1) : t;
  }
  return t.replace(/\s+#.*$/, "").trim();
}

function unquote(s: string): string {
  const t = s.trim();
  if (/^".*"$/.test(t)) return t.slice(1, -1).replace(/\\(["\\])/g, "$1");
  if (/^'.*'$/.test(t)) return t.slice(1, -1).replace(/''/g, "'");
  return t;
}

/** `[a, "b, c", d]` at `at`: each item and where it is. */
function inlineItems(raw: string, at: number): Item[] {
  const out: Item[] = [];
  const inner = raw.replace(/\]\s*$/, "");
  let start = 1;
  let q: string | null = null;
  const push = (end: number) => {
    const piece = inner.slice(start, end);
    const lead = piece.length - piece.trimStart().length;
    const text = piece.trim();
    if (text) out.push({ text: unquote(text), from: at + start + lead, to: at + start + lead + text.length });
  };
  for (let i = 1; i < inner.length; i++) {
    const ch = inner[i];
    if (q) ch === q && (q = null);
    else if (ch === '"' || ch === "'") q = ch;
    else if (ch === ",") push(i), (start = i + 1);
  }
  push(inner.length);
  return out;
}

// ------------------------------------------------------------------ checking it

export interface Problem {
  from: number;
  to: number;
  severity: "error" | "warning";
  message: string;
  /** The property it's about, if any. */
  key?: string;
}

const YMD = /(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/;
const isDate = (s: string) => {
  const m = s.match(YMD);
  return !!m && +m[2] >= 1 && +m[2] <= 12 && +m[3] >= 1 && +m[3] <= 31;
};

/** What's wrong with the front matter of the note at `path`: wrong types and values, repeated keys, unreadable lines, and, in the settings file, unknown settings. */
export function frontmatterProblems(md: string, path: string): Problem[] {
  const scan = scanFrontmatter(md);
  if (!scan) return [];
  const schema = schemaFor(path);
  const template = schema === TEMPLATE_SCHEMA;
  const out: Problem[] = [];
  for (const s of scan.stray) out.push({ from: s.from, to: s.to, severity: "error", message: "Properties are written as key: value. This line isn't, so it's skipped." });
  const seen = new Set<string>();
  for (const f of scan.fields) {
    const at = { from: f.from, to: f.to, key: f.key };
    if (seen.has(f.key)) out.push({ ...at, severity: "error", message: `${f.key} is set twice here. Keep one.` });
    seen.add(f.key);
    const prop = schema.properties[f.key];
    if (!prop) {
      if (!schema.additionalProperties) {
        const near = closest(f.key, Object.keys(schema.properties));
        out.push({ ...at, severity: "warning", message: `There's no setting called ${f.key}, so it does nothing.${near ? ` Did you mean ${near}?` : ""}` });
      }
      continue;
    }
    const v = f.value;
    const there = { from: v.from, to: Math.max(v.to, v.from), key: f.key };
    // A template's values may be placeholders, filled in when a note is made from it.
    if (template && md.slice(v.from, v.to).includes("{{")) continue;
    const unlinked = (item: Item) =>
      linkTarget(item.text) ? null : { from: item.from, to: item.to, key: f.key, severity: "warning" as const, message: `${item.text} isn't linked to a contact, so this note won't show on theirs. Pick them from the list, or write "[[People/${item.text}]]".` };
    if (prop.type === "array") {
      if (v.kind === "map") out.push({ ...there, severity: "error", message: `${f.key} is a list: write [a, b] or one - item per line.` });
      if (prop.items?.format === "person" && v.kind === "list") for (const item of v.items) { const p = unlinked(item); if (p) out.push(p); }
      const allowed = prop.items?.enum;
      if (allowed && v.kind === "list")
        for (const item of v.items) if (!allowed.includes(item.text)) out.push({ from: item.from, to: item.to, key: f.key, severity: "error", message: `${f.key} can hold ${allowed.join(", ")}, not ${JSON.stringify(item.text)}.` });
      continue;
    }
    if (v.kind === "list" || v.kind === "map") {
      out.push({ ...there, severity: "error", message: `${f.key} is ${prop.type === "boolean" ? "true or false" : "one value"}, not a ${v.kind === "list" ? "list" : "set of keys"}.` });
      continue;
    }
    if (v.kind === "empty") {
      if (prop.type === "boolean" || prop.enum) out.push({ ...at, severity: "warning", message: `${f.key} has no value, so it stays ${JSON.stringify(prop.default ?? prop.enum?.[0])}.` });
      continue;
    }
    if (v.kind !== "scalar") continue;
    if (prop.type === "boolean" && (v.quoted || !/^(true|false)$/i.test(v.text)))
      out.push({ ...there, severity: "error", message: `${f.key} is true or false, not ${JSON.stringify(v.text)}.` });
    else if (prop.enum && !prop.enum.includes(v.text)) out.push({ ...there, severity: "error", message: `${f.key} is one of ${prop.enum.join(", ")}, not ${JSON.stringify(v.text)}.` });
    else if (prop.format === "person" && unlinked(v)) out.push(unlinked(v)!);
    else if (prop.format === "date" && !isDate(v.text)) out.push({ ...there, severity: "warning", message: `Dates are read as YYYY-MM-DD, like 2026-10-02, so this note won't sort by its ${f.key}.` });
  }
  return out.sort((a, b) => a.from - b.from);
}

/** The known key `key` was most likely meant to be: two edits away at most. */
function closest(key: string, known: string[]): string | null {
  let best: string | null = null;
  let score = 3;
  for (const k of known) {
    const d = distance(key.toLowerCase(), k.toLowerCase());
    if (d < score) (score = d), (best = k);
  }
  return best;
}

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const next = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = row[j];
      row[j] = next;
    }
  }
  return row[b.length];
}

/** Problems as lines for an agent: what's wrong and on which line, after a write. */
export function describeProblems(md: string, problems: Problem[]): string {
  if (!problems.length) return "";
  const lineOf = (pos: number) => md.slice(0, pos).split("\n").length;
  return `\n\nIts front matter (properties) has problems; fix them with edit_note:\n${problems.map((p) => `- line ${lineOf(p.from)}: ${p.message}`).join("\n")}`;
}

// ------------------------------------------------------------------ the settings files

export type SettingValue = boolean | string | string[];

/** The valid values a settings file sets for `schema`'s properties (the first, if one is set twice). Invalid ones are left out. */
export function readValues(md: string, schema: ObjectSchema): Record<string, SettingValue> {
  const out: Record<string, SettingValue> = {};
  for (const f of scanFrontmatter(md)?.fields ?? []) {
    const prop = schema.properties[f.key];
    if (!prop || f.key in out) continue;
    const v = f.value;
    if (prop.type === "array" && (v.kind === "list" || v.kind === "empty")) {
      const items = v.kind === "list" ? v.items.map((i) => i.text) : [];
      if (!prop.items?.enum || items.every((i) => prop.items!.enum!.includes(i))) out[f.key] = items;
    } else if (v.kind === "scalar" && prop.type === "boolean" && !v.quoted && /^(true|false)$/i.test(v.text)) out[f.key] = v.text.toLowerCase() === "true";
    else if (v.kind === "scalar" && prop.type === "string" && (!prop.enum || prop.enum.includes(v.text))) out[f.key] = v.text;
  }
  return out;
}

/** Text as a YAML value, quoted only when YAML would read it as something else. `inList`: an item of `[a, b]`, where commas and brackets count too. */
export function yamlText(s: string, inList = false): string {
  const plain = s === s.trim() && s !== "" && !/^[[\]{}&*!|>'"%@`#?:,-]/.test(s) && !/: |:$| #/.test(s) && !(inList && /[,[\]{}]/.test(s)) && !/^(true|false|null|~|yes|no)$/i.test(s);
  return plain ? s : JSON.stringify(s);
}

/** A value as YAML on a key's line. */
const yamlOf = (v: SettingValue) => (Array.isArray(v) ? `[${v.map((x) => yamlText(x, true)).join(", ")}]` : typeof v === "string" ? yamlText(v) : String(v));

/**
 * `md` with `key` set to `value`, every other line kept as it was; the front matter is made if
 * there's none. A list written one `- item` per line stays that way.
 */
export function withValue(md: string, key: string, value: SettingValue): string {
  const { entries, body, had } = frontmatterEntries(md);
  const i = entries.findIndex((e) => e.key === key);
  const indent = i >= 0 ? entries[i].lines.slice(1).find((l) => /^\s*-(\s|$)/.test(l))?.match(/^\s*/)?.[0] : undefined;
  const lines =
    Array.isArray(value) && indent !== undefined && value.length
      ? [`${key}:`, ...value.map((x) => `${indent}- ${yamlText(x)}`)]
      : [`${key}: ${yamlOf(value)}`.trimEnd()];
  if (i >= 0) entries[i] = { key, lines };
  else entries.push({ key, lines });
  return frontmatterText(entries) + (had ? body : md ? `\n${md}` : "");
}

/** `md` without `key` in its front matter, every other line kept as it was. */
export function withoutValue(md: string, key: string): string {
  const { entries, body, had } = frontmatterEntries(md);
  if (!had) return md;
  const kept = entries.filter((e) => e.key !== key);
  return kept.some((e) => e.key) ? frontmatterText(kept) + body : body.replace(/^\r?\n/, "");
}

/** How a property is edited in the properties table: what its schema says, else what its value looks like. */
export type PropKind = "boolean" | "enum" | "date" | "person" | "people" | "tags" | "choices" | "list" | "text" | "raw";

export function propKind(key: string, prop: PropSchema | undefined, value: Value): PropKind {
  if (value.kind === "map" || value.kind === "block") return "raw";
  if (prop) {
    if (key === "tags") return "tags";
    if (prop.type === "boolean") return "boolean";
    if (prop.type === "array") return prop.items?.format === "person" ? "people" : prop.items?.enum ? "choices" : "list";
    if (prop.enum) return "enum";
    if (prop.format === "date") return "date";
    if (prop.format === "person") return "person";
    return "text";
  }
  if (value.kind === "list") return "list";
  if (value.kind === "scalar" && !value.quoted && /^(true|false)$/i.test(value.text)) return "boolean";
  if (value.kind === "scalar" && /^\d{4}-\d{2}-\d{2}$/.test(value.text)) return "date";
  return "text";
}

/** `[[People/Sam Lee]]` → `People/Sam Lee`; null if `s` isn't a link. */
export const linkTarget = (s: string) => s.match(/^\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]$/)?.[1].trim() ?? null;

/** A new settings file for `schema`: every setting it has, with `values` (or its default), then a line on how to use it. */
export function settingsFileFor(schema: ObjectSchema, values: Record<string, SettingValue>, intro: string): string {
  const keys = Object.entries(schema.properties).filter(([k, p]) => k !== "title" && k !== "tags" && (k in values || p.default !== undefined));
  return [
    "---",
    ...keys.map(([k, p]) => `${k}: ${yamlOf(values[k] ?? (p.default as SettingValue))}`),
    "---",
    "",
    "# Settings",
    "",
    intro,
    "",
  ].join("\n");
}

export interface WorkspaceSettings {
  gamified?: boolean;
  organizing?: PresetId;
}

/** The settings `md` sets, leaving out any it doesn't or that aren't valid. */
export function readSettings(md: string): WorkspaceSettings {
  const out: WorkspaceSettings = {};
  for (const f of scanFrontmatter(md)?.fields ?? []) {
    const v = f.value;
    if (v.kind !== "scalar") continue;
    if (f.key === "gamified" && !v.quoted && /^(true|false)$/i.test(v.text) && out.gamified === undefined) out.gamified = v.text.toLowerCase() === "true";
    if (f.key === "organizing" && PRESETS.some((p) => p.id === v.text) && out.organizing === undefined) out.organizing = v.text as PresetId;
  }
  return out;
}

/** A new workspace settings file. */
export const settingsNote = (s: WorkspaceSettings = {}): string =>
  settingsFileFor(SETTINGS_SCHEMA, { ...s }, "This workspace's settings, for everyone in it and for your agents. Settings (⌘,) → Workspace changes the same values. Hover a setting to read what it does; on a new line in the properties, the ones you haven't set are suggested. Anything you write down here is yours.");

/** A new settings file of your own. */
export const userSettingsNote = (values: Record<string, SettingValue>): string =>
  settingsFileFor(USER_SCHEMA, values, "Your own settings: how Common Ink looks and behaves for you here. Settings (⌘,) → User changes the same values. Hover a setting to read what it does. Anything you write down here is yours.");

/** `md` with `key` set to `value`, every other line kept as it was. */
export function withSetting<K extends keyof WorkspaceSettings>(md: string, key: K, value: NonNullable<WorkspaceSettings[K]>): string {
  if (!md.trim()) return settingsNote({ [key]: value });
  const { entries, body, had } = frontmatterEntries(md);
  const line = `${key}: ${value}`;
  const i = entries.findIndex((e) => e.key === key);
  if (i >= 0) entries[i] = { key, lines: [line] };
  else entries.push({ key, lines: [line] });
  return frontmatterText(entries) + (had ? body : `\n${md}`);
}
