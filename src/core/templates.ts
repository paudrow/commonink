// Templates: notes in Templates/ with {{placeholders}}, filled in when a note is made from one or
// a template is inserted into a note. Daily notes (Templates/Daily note.md) use the same engine.
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
/** The daily note's template (Today, quick-add's journal, the calendar). */
export const DAILY_TEMPLATE = `${TEMPLATES}/Daily note.md`;
/** The frontmatter keys that are the template's own. */
const OWN_KEYS = ["title", "folder", "applies_to"];

export interface Ask {
  label: string;
  /** What it is if left blank ("" for none). */
  fallback: string;
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
}

/** {{…}} with no `\` before it: its insides are group 2. */
const PLACEHOLDER = /(\\?)\{\{([^{}\n]+)\}\}/g;

/** What a template asks for: each {{ask:Label}} (or {{ask:Label|default}}) once, in order, not escaped. */
export function asksIn(text: string): Ask[] {
  const out: Ask[] = [];
  for (const m of text.matchAll(PLACEHOLDER)) {
    const ask = !m[1] && m[2].match(/^\s*ask:\s*([^|]+?)\s*(?:\|(.*))?$/);
    if (ask && !out.some((a) => a.label === ask[1])) out.push({ label: ask[1], fallback: (ask[2] ?? "").trim() });
  }
  return out;
}

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
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** `d` in a Moment-style format: YYYY YY MMMM MMM MM M DD D dddd ddd HH H hh h mm m ss s A a, [literal]. */
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
  return format.replace(/\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|DD|D|dddd|ddd|HH|H|hh|h|mm|m|ss|s|A|a/g, (t, literal?: string) => literal ?? tokens[t]);
}

/** Now on this machine's clock, as FillOptions.at. */
export const localNow = (ms = Date.now()) => formatDate(new Date(ms), "YYYY-MM-DD[T]HH:mm");

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
  const out = own.replace(PLACEHOLDER, (whole, escaped: string, inner: string) => {
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
    const ask = name.match(/^ask:\s*([^|]+?)\s*(?:\|(.*))?$/);
    if (ask) {
      const answer = opts.answers?.[ask[1]]?.trim() || (ask[2] ?? "").trim();
      if (answer) return answer;
    }
    const key = ask ? `ask:${ask[1]}` : name;
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
