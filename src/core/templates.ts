// Templates: notes in Templates/ with {{placeholders}}, filled in when a note is made from one or
// a template is inserted into a note. The journal (Templates/Journal.md) uses the same engine.
//
//   {{date}} {{date:dddd, MMMM D}} {{date+1d}} {{date-1w:YYYY-MM-DD}}   the creator's day (Moment-style formats)
//   {{time}} {{time:h:mm A}}                                             their time
//   {{title}}                                                            the new note's title
//   {{cursor}}                                                           where the cursor goes
//   {{ask:Attendees}} {{ask:Client|Acme}}                                asked for first (with a default)
//   {{clipboard}}                                                        what's on the clipboard, in the app
//   \{{date}}                                                            stays as written
//
// A template's frontmatter can also say how notes are made from it; those keys aren't copied:
//
//   title: "{{date}} {{ask:Client}} meeting"   the new note's title (default: the template's name)
//   folder: Meetings                           where it goes (default: where you are)
//   applies_to: Meetings/                      New note in this folder (or under it) starts from it
//
// Text only: nothing in a template runs, since agents and teammates can write them. No Node
// imports: the web app uses it too.
import { frontmatterEntries, frontmatterText, listOf, scalarOf } from "./frontmatter.ts";

export const TEMPLATES = "Templates";
/** The journal's template (Today, quick-add, capture, the calendar), and the name it had before (still read when there's no Journal.md). */
export const JOURNAL_TEMPLATES = [`${TEMPLATES}/Journal.md`, `${TEMPLATES}/Daily note.md`] as const;
/** The frontmatter keys that are the template's own. */
const OWN_KEYS = ["title", "folder", "applies_to"];

/** What kind of answer a question takes: see parseAsk. */
export type AskType = "text" | "people" | "date" | "choice";

export interface Ask {
  label: string;
  /** What it is if left blank ("" for none). */
  fallback: string;
  type: AskType;
  /** A choice's options, in order. */
  choices: string[];
}

/** Someone picked for a `people` question: `handle` goes on task lines (@Sam), `link` or `name` elsewhere. */
export interface PersonPick {
  name: string;
  handle: string;
  /** How a note links to them, if they have a contact note ([[People/Name]]). */
  link?: string;
}

/**
 * A question's parts, from what follows `ask:`:
 *
 *   Attendees                      text
 *   Client|Acme                    text, "Acme" if left blank
 *   Attendees|people               people (a picker: @handles on a task line, names elsewhere)
 *   Due|date                       a date (YYYY-MM-DD)
 *   Priority|choice:low,med,high   one of those
 *   …|type|default                 any type, with a default ("Who|text|people" is text defaulting to "people")
 */
export function parseAsk(body: string): Ask {
  const [label, ...rest] = body.split("|").map((s) => s.trim());
  const typed = rest[0]?.match(/^(text|people|date|choice:(.*))$/);
  if (!typed) return { label, fallback: rest.join("|").trim(), type: "text", choices: [] };
  const type = (typed[2] !== undefined ? "choice" : typed[1]) as AskType;
  const choices = typed[2] !== undefined ? typed[2].split(",").map((c) => c.trim()).filter(Boolean) : [];
  return { label, fallback: rest.slice(1).join("|").trim(), type, choices };
}

export interface TemplateInfo {
  path: string;
  /** Its file name: what the pickers show. */
  name: string;
  /** The new note's title, with placeholders; null to use `name`. */
  title: string | null;
  /** Where new notes go, with placeholders; null for wherever you are. */
  folder: string | null;
  /** Folders whose new notes start from it. */
  appliesTo: string[];
  /** What it asks for, in order. */
  asks: Ask[];
  /** Whether it uses {{clipboard}} (the app reads the clipboard only then). */
  clipboard: boolean;
}

export interface FillOptions {
  /** The creator's own day and time, YYYY-MM-DDTHH:mm (default: now, on the machine's clock). */
  at?: string;
  title?: string;
  /** Answers to {{ask:…}}, by label. */
  answers?: Record<string, string>;
  clipboard?: string;
  /** Named values for {{name}}, checked first: a calendar event's when, where, attendees… (calendar.ts). */
  vars?: Record<string, string>;
  /** People picked for `people` questions, by label (answers, given as text, are written as they are). */
  picks?: Record<string, PersonPick[]>;
}

/** {{…}} with no `\` before it: its insides are group 2. */
const PLACEHOLDER = /(\\?)\{\{([^{}\n]+)\}\}/g;

/** What a template asks for: each {{ask:Label}} (or {{ask:Label|default}}) once, in order, not escaped. */
export function asksIn(text: string): Ask[] {
  const out: Ask[] = [];
  for (const m of text.matchAll(PLACEHOLDER)) {
    const body = !m[1] && m[2].match(/^\s*ask:\s*(.+)$/)?.[1];
    const ask = body ? parseAsk(body) : null;
    if (ask?.label && !out.some((a) => a.label === ask.label)) out.push(ask);
  }
  return out;
}

/**
 * The @handle for each of `names` (people picked together, or a workspace's members): the first
 * name when no one else in the list has it, else the full name with dashes ("Sam-Dev").
 */
export function handlesFor(names: string[]): string[] {
  const first = (n: string) => n.trim().split(/\s+/)[0];
  const count = new Map<string, number>();
  for (const n of names) count.set(first(n).toLowerCase(), (count.get(first(n).toLowerCase()) ?? 0) + 1);
  const clean = (s: string) => s.replace(/[^\p{L}\p{N}_.-]/gu, "");
  return names.map((n) => clean(count.get(first(n).toLowerCase()) === 1 ? first(n) : n.trim().replace(/\s+/g, "-")));
}

/** A task line (`- [ ] …`): people picked on it are written as @handles, which assign it. */
const TASK_LINE_START = /^\s*[-*+]\s+\[[ xX]\]\s/;

/** A template note's settings: see the top of this file. */
export function templateInfo(path: string, md: string): TemplateInfo {
  const { entries } = frontmatterEntries(md);
  const get = (k: string) => entries.find((e) => e.key === k);
  return {
    path,
    name: path.split("/").pop()!.replace(/\.(md|markdown)$/i, ""),
    title: scalarOf(get("title")) || null,
    folder: scalarOf(get("folder")).replace(/^\/+|\/+$/g, "") || null,
    appliesTo: listOf(get("applies_to")).map((f) => f.replace(/^\/+|\/+$/g, "")).filter(Boolean),
    asks: asksIn(md),
    clipboard: [...md.matchAll(PLACEHOLDER)].some((m) => !m[1] && m[2].trim() === "clipboard"),
  };
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const ordinal = (n: number) => n + (n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th");
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** `d` in a Moment-style format: YYYY YY MMMM MMM MM M DD Do D dddd ddd HH H hh h mm m ss s A a, [literal]. */
export function formatDate(d: Date, format: string): string {
  const h12 = d.getHours() % 12 || 12;
  const tokens: Record<string, string> = {
    YYYY: String(d.getFullYear()),
    YY: String(d.getFullYear()).slice(-2),
    MMMM: MONTHS[d.getMonth()],
    MMM: MONTHS[d.getMonth()].slice(0, 3),
    MM: pad(d.getMonth() + 1),
    M: String(d.getMonth() + 1),
    DD: pad(d.getDate()),
    Do: ordinal(d.getDate()),
    D: String(d.getDate()),
    dddd: DAYS[d.getDay()],
    ddd: DAYS[d.getDay()].slice(0, 3),
    HH: pad(d.getHours()),
    H: String(d.getHours()),
    hh: pad(h12),
    h: String(h12),
    mm: pad(d.getMinutes()),
    m: String(d.getMinutes()),
    ss: pad(d.getSeconds()),
    s: String(d.getSeconds()),
    A: d.getHours() < 12 ? "AM" : "PM",
    a: d.getHours() < 12 ? "am" : "pm",
  };
  return format.replace(/\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|DD|Do|D|dddd|ddd|HH|H|hh|h|mm|m|ss|s|A|a/g, (t, literal?: string) => literal ?? tokens[t]);
}

/** Now as FillOptions.at: the wall clock in `timeZone`, or on this machine's clock when it's unset. */
export function localNow(ms = Date.now(), timeZone?: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(ms);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

/**
 * `text` with its placeholders filled. The template's own frontmatter keys (title, folder,
 * applies_to) go; the rest of its frontmatter stays. `cursor` is where {{cursor}} was (the first
 * one), and `unfilled` what's left as written: an unknown {{name}}, {{clipboard}} with no clipboard,
 * and {{ask:…}} with no answer and no default.
 */
export function fillTemplate(text: string, opts: FillOptions = {}): { text: string; cursor: number | null; unfilled: string[] } {
  const [day = "", time = "00:00"] = (opts.at ?? localNow()).split("T");
  const [y, mo, d] = day.split("-").map(Number);
  const [hh, mi] = time.split(":").map(Number);
  const when = new Date(y, mo - 1, d, hh || 0, mi || 0);
  const { entries, body, had } = frontmatterEntries(text);
  const own = had ? frontmatterText(entries.filter((e) => !OWN_KEYS.includes(e.key))) + body : text;
  const unfilled: string[] = [];
  const CURSOR = "\u0000";
  const out = own.replace(PLACEHOLDER, (whole, escaped: string, inner: string, offset: number, all: string) => {
    if (escaped) return whole.slice(1);
    const name = inner.trim();
    if (opts.vars && Object.hasOwn(opts.vars, name)) return opts.vars[name];
    const date = name.match(/^(date|time)(?:([+-]\d+)([dw]))?(?::(.+))?$/);
    if (date) {
      const at = new Date(when);
      if (date[2]) at.setDate(at.getDate() + Number(date[2]) * (date[3] === "w" ? 7 : 1));
      return formatDate(at, date[4] ?? (date[1] === "date" ? "YYYY-MM-DD" : "HH:mm"));
    }
    if (name === "title" && opts.title !== undefined) return opts.title;
    if (name === "cursor") return CURSOR;
    if (name === "clipboard" && opts.clipboard !== undefined) return opts.clipboard;
    const body = name.match(/^ask:\s*(.+)$/)?.[1];
    const ask = body ? parseAsk(body) : null;
    if (ask) {
      const picked = opts.picks?.[ask.label];
      if (picked?.length) {
        const line = all.slice(all.lastIndexOf("\n", offset - 1) + 1, offset);
        return TASK_LINE_START.test(line) ? picked.map((p) => `@${p.handle}`).join(" ") : picked.map((p) => p.link ?? p.name).join(", ");
      }
      const answer = opts.answers?.[ask.label]?.trim() || ask.fallback;
      if (answer) return answer;
    }
    const key = ask ? `ask:${ask.label}` : name;
    if (!unfilled.includes(key)) unfilled.push(key);
    return whole;
  });
  const at = out.indexOf(CURSOR);
  return { text: out.replaceAll(CURSOR, ""), cursor: at < 0 ? null : at, unfilled };
}

/** A note title from a filled title pattern: what's left unfilled goes, and what a file name can't hold. */
export function cleanTitle(s: string): string {
  return s
    .replace(PLACEHOLDER, "")
    .replace(/[\\/:*?"<>|#^[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

/** A placeholder, for the `{{` suggestions and the docs (docs/templates.md lists every one). */
export interface PlaceholderDoc {
  insert: string;
  info: string;
  /** Where it applies: every template, or only Templates/Meeting note.md (a calendar event's). */
  where: "any" | "meeting";
}

/** Every placeholder, in the order the `{{` menu offers them. */
export const PLACEHOLDERS: PlaceholderDoc[] = [
  { insert: "{{date}}", info: "Today's date, YYYY-MM-DD", where: "any" },
  { insert: "{{date:dddd, MMMM D}}", info: "Today in a format: Tuesday, September 29 (Moment-style tokens)", where: "any" },
  { insert: "{{date:YYYY-MM-DD}}", info: "Today in a format you choose: YYYY MM DD, MMMM MMM, dddd ddd…", where: "any" },
  { insert: "{{date+1d}}", info: "Tomorrow: an offset in days (d) or weeks (w), + or -", where: "any" },
  { insert: "{{date-1w:MMM D}}", info: "An offset and a format: a week ago, as Sep 22", where: "any" },
  { insert: "{{time}}", info: "The time now, HH:mm (24-hour)", where: "any" },
  { insert: "{{time:h:mm A}}", info: "The time in a format: 2:05 PM", where: "any" },
  { insert: "{{title}}", info: "The new note's title", where: "any" },
  { insert: "{{cursor}}", info: "Where the cursor lands when the note opens", where: "any" },
  { insert: "{{clipboard}}", info: "What's on the clipboard (in the app)", where: "any" },
  { insert: "{{ask:Question}}", info: "Asked in a form before the note is made", where: "any" },
  { insert: "{{ask:Question|Default}}", info: "Asked, with a default if left blank", where: "any" },
  { insert: "{{ask:Attendees|people}}", info: "A people picker: @handles on a task line, names elsewhere", where: "any" },
  { insert: "{{ask:Due|date}}", info: "A date picker: YYYY-MM-DD", where: "any" },
  { insert: "{{ask:Priority|choice:low,medium,high}}", info: "One of a list, picked from a menu", where: "any" },
  { insert: "{{when}}", info: "The event's day and time (meeting notes from the calendar)", where: "meeting" },
  { insert: "{{where}}", info: "The event's location (meeting notes)", where: "meeting" },
  { insert: "{{attendees}}", info: "Who's invited (meeting notes)", where: "meeting" },
  { insert: "{{agenda}}", info: "The event's description (meeting notes)", where: "meeting" },
  { insert: "{{event}}", info: "A link back to the calendar event (meeting notes)", where: "meeting" },
];
