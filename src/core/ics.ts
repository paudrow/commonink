// Reads an iCalendar (RFC 5545) feed from a calendar subscription (Google, Outlook, iCloud, Fastmail,
// holiday feeds) and expands its events into the occurrences that overlap a window of time. The feed
// comes from the internet, so a malformed property or component is skipped rather than thrown on, and
// every loop is bounded. No Node imports: this runs in Workers too.
//
// Times are handled as "walls": a local date and time counted in milliseconds as if it were UTC. Rules
// expand in wall time (a 09:00 meeting stays at 09:00 across a DST change), and an event's clock (all-day,
// floating, or a zone) turns a wall into an instant only when it's compared, formatted or keyed.

export interface Person {
  name: string | null;
  email: string | null;
  /** PARTSTAT lowercased, e.g. "accepted". */
  status: string | null;
}

export interface Occurrence {
  uid: string;
  /** Which instance of a recurring event this is: the original start as UTC "20260929T160000Z", or "20260929" for all-day; null for a one-off. */
  recurrenceId: string | null;
  /** Absolute times as UTC ISO "2026-09-29T16:00:00Z"; all-day as "2026-09-29"; floating (no zone, no Z) as "2026-09-29T09:00:00". */
  start: string;
  /** Exclusive end, same format as start. All-day end is the day after the last day. */
  end: string;
  allDay: boolean;
  /** The event's own TZID if it named one (IANA after mapping), else null. */
  timeZone: string | null;
  title: string;
  location: string | null;
  description: string | null;
  url: string | null;
  organizer: Person | null;
  attendees: Person[];
  status: "confirmed" | "tentative" | "cancelled";
  /** Part of a recurring series (has RRULE/RDATE, or is an override). */
  recurring: boolean;
}

export interface IcsFeed {
  /** X-WR-CALNAME (or NAME). */
  name: string | null;
  /** X-WR-TIMEZONE, as an IANA zone; null if it names no zone we know. */
  timeZone: string | null;
}

const DAY = 86_400_000;
const CAP = { title: 500, location: 1000, description: 10_000, name: 500, email: 320, url: 2000, uid: 1000, attendees: 200, dates: 1000 };
/** Periods one rule may walk through, and periods one feed may walk through in all. */
const MAX_PERIODS = 50_000;
const FEED_BUDGET = 2_000_000;
/** The last wall time anything may reach (the end of year 9999), so every Date stays valid. */
const MAX_WALL = Date.UTC(9999, 11, 31, 23, 59, 59);

/** Parse and expand every event whose occurrence overlaps [from, to). Cancelled occurrences are left out. Sorted by start. */
export function readIcs(text: string, window: { from: Date; to: Date }, limits: { perEvent?: number; total?: number } = {}): { feed: IcsFeed; events: Occurrence[] } {
  const doc = lex(text);
  const zones = zoneBook(doc.timezones, doc.timeZone);
  const feed: IcsFeed = { name: doc.name, timeZone: zones.floating.name };
  const from = window.from.getTime();
  const to = window.to.getTime();
  if (!(from < to)) return { feed, events: [] };
  const ctx: Ctx = { from, to, floating: zones.floating, perEvent: limits.perEvent ?? 1000, total: limits.total ?? 20_000, budget: { left: FEED_BUDGET }, out: [] };
  const groups = new Map<string, EventDef[]>();
  for (const comp of doc.events) {
    const def = readEvent(comp, zones);
    if (!def) continue;
    const group = groups.get(def.uid);
    if (group) group.push(def);
    else groups.set(def.uid, [def]);
  }
  for (const group of groups.values()) {
    if (ctx.out.length >= ctx.total) break;
    try {
      expandSeries(group, ctx);
    } catch {
      // A series that still trips on something unforeseen is skipped, not the whole feed.
    }
  }
  ctx.out.sort((a, b) => a.at - b.at || a.endAt - b.endAt || (a.occ.uid < b.occ.uid ? -1 : a.occ.uid > b.occ.uid ? 1 : 0));
  return { feed, events: ctx.out.map((x) => x.occ) };
}

/** Quick sniff used before parsing: true if the text looks like an iCalendar (starts with BEGIN:VCALENDAR after optional BOM/whitespace). */
export function looksLikeIcs(text: string): boolean {
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  while (i < text.length && i < 4096 && " \t\r\n".includes(text[i])) i++;
  return text.slice(i, i + 15).toUpperCase() === "BEGIN:VCALENDAR";
}

// ------------------------------------------------------------------ content lines

interface Prop {
  name: string;
  params: Map<string, string>;
  value: string;
}

interface Component {
  name: string;
  props: Prop[];
  children: Component[];
}

interface Doc {
  name: string | null;
  timeZone: string | null;
  events: Component[];
  timezones: Component[];
}

/**
 * The feed's closed VEVENTs and VTIMEZONEs, and its name and zone. A component left open (a truncated
 * download) is dropped; one closed inside something left open still counts.
 */
function lex(text: string): Doc {
  const doc: Doc = { name: null, timeZone: null, events: [], timezones: [] };
  let altName: string | null = null;
  const root: Component = { name: "", props: [], children: [] };
  const stack = [root];
  // How many of each name are open, so an END for something that isn't open costs nothing.
  const open = new Map<string, number>();
  for (const line of unfold(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)) {
    const prop = readProp(line);
    if (!prop) continue;
    if (prop.name === "BEGIN") {
      const name = prop.value.trim().toUpperCase();
      stack.push({ name, props: [], children: [] });
      open.set(name, (open.get(name) ?? 0) + 1);
    } else if (prop.name === "END") {
      const name = prop.value.trim().toUpperCase();
      if (!open.get(name)) continue;
      for (;;) {
        const comp = stack.pop()!;
        open.set(comp.name, open.get(comp.name)! - 1);
        if (comp.name !== name) continue;
        if (comp.name === "VEVENT") doc.events.push(comp);
        else if (comp.name === "VTIMEZONE") doc.timezones.push(comp);
        else if (comp.name === "STANDARD" || comp.name === "DAYLIGHT") stack[stack.length - 1].children.push(comp);
        break;
      }
    } else {
      const top = stack[stack.length - 1];
      if (top === root) continue;
      top.props.push(prop);
      if (top.name !== "VCALENDAR") continue;
      if (prop.name === "X-WR-CALNAME") doc.name ??= textOf(prop, CAP.title);
      else if (prop.name === "NAME") altName ??= textOf(prop, CAP.title);
      else if (prop.name === "X-WR-TIMEZONE") doc.timeZone ??= prop.value.trim() || null;
    }
  }
  doc.name ??= altName;
  return doc;
}

/** Logical lines: a physical line that starts with a space or tab continues the one before it. */
function* unfold(text: string): Generator<string> {
  let parts: string[] = [];
  for (const raw of text.split(/\r\n|\n|\r/)) {
    if ((raw[0] === " " || raw[0] === "\t") && parts.length) parts.push(raw.slice(1));
    else {
      if (parts.length) yield parts.length === 1 ? parts[0] : parts.join("");
      parts = [raw];
    }
  }
  if (parts.length) yield parts.join("");
}

const isNameChar = (c: number) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 45;

/** `NAME;PARAM=a,"b;c":value`, or null if the line isn't one. */
function readProp(line: string): Prop | null {
  let i = 0;
  while (i < line.length && isNameChar(line.charCodeAt(i))) i++;
  if (i === 0) return null;
  const name = line.slice(0, i).toUpperCase();
  const params = new Map<string, string>();
  while (line[i] === ";") {
    const at = ++i;
    while (i < line.length && isNameChar(line.charCodeAt(i))) i++;
    if (i === at || line[i] !== "=") return null;
    const key = line.slice(at, i).toUpperCase();
    const values: string[] = [];
    for (;;) {
      i++;
      if (line[i] === '"') {
        const close = line.indexOf('"', i + 1);
        if (close < 0) return null;
        values.push(line.slice(i + 1, close));
        i = close + 1;
      } else {
        const begin = i;
        while (i < line.length && line[i] !== ";" && line[i] !== ":" && line[i] !== ",") i++;
        values.push(line.slice(begin, i));
      }
      if (line[i] !== ",") break;
    }
    if (!params.has(key)) params.set(key, caretDecode(values.join(",")));
  }
  if (line[i] !== ":") return null;
  return { name, params, value: line.slice(i + 1) };
}

/** RFC 6868 parameter escapes: ^n, ^' and ^^. */
function caretDecode(v: string): string {
  if (!v.includes("^")) return v;
  let out = "";
  for (let i = 0; i < v.length; i++) {
    const next = v[i + 1];
    if (v[i] === "^" && (next === "n" || next === "N" || next === "'" || next === "^")) {
      out += next === "^" ? "^" : next === "'" ? '"' : "\n";
      i++;
    } else out += v[i];
  }
  return out;
}

/** TEXT values: \n or \N is a newline, and \, \; \\ are the characters themselves. */
function unescapeText(v: string): string {
  if (!v.includes("\\")) return v;
  const out: string[] = [];
  let from = 0;
  for (let i = v.indexOf("\\"); i >= 0 && i < v.length - 1; i = v.indexOf("\\", from)) {
    out.push(v.slice(from, i));
    const c = v[i + 1];
    out.push(c === "n" || c === "N" ? "\n" : c);
    from = i + 2;
  }
  out.push(v.slice(from).replace(/\\$/, ""));
  return out.join("");
}

/** A string cut to `cap` characters without splitting a surrogate pair. */
function clip(s: string, cap: number): string {
  if (s.length <= cap) return s;
  const code = s.charCodeAt(cap - 1);
  return s.slice(0, code >= 0xd800 && code <= 0xdbff ? cap - 1 : cap);
}

function textOf(p: Prop | undefined, cap: number): string | null {
  if (!p) return null;
  return clip(unescapeText(p.value).trim(), cap).trim() || null;
}

// ------------------------------------------------------------------ dates and times

type Clock = { kind: "date" } | { kind: "floating" } | { kind: "zoned"; zone: Zone };

/** A DATE or DATE-TIME value: a wall time and the clock that reads it. */
interface Moment {
  wall: number;
  clock: Clock;
}

/** How long an event lasts: nominal days (which follow the wall clock) plus exact milliseconds. */
interface Span {
  days: number;
  ms: number;
}

const DATE: Clock = { kind: "date" };
const FLOATING: Clock = { kind: "floating" };

const floorDay = (wall: number) => Math.floor(wall / DAY) * DAY;
const dayNumber = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d) / DAY;
const partsOf = (day: number) => {
  const t = new Date(day * DAY);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
};
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
/** Monday = 0 … Sunday = 6. */
const weekday = (day: number) => (((day + 3) % 7) + 7) % 7;
const weekStart = (day: number, wkst: number) => day - ((weekday(day) - wkst + 7) % 7);

function digits(s: string, from: number, to: number): number {
  let n = 0;
  for (let i = from; i < to; i++) {
    const c = s.charCodeAt(i) - 48;
    if (c < 0 || c > 9) return NaN;
    n = n * 10 + c;
  }
  return n;
}

/** `20260929`, `20260929T090000` or `20260929T090000Z`. */
function readStamp(raw: string): { wall: number; date: boolean; utc: boolean } | null {
  const v = raw.trim();
  if (v.length !== 8 && v.length !== 15 && v.length !== 16) return null;
  const [y, m, d] = [digits(v, 0, 4), digits(v, 4, 6), digits(v, 6, 8)];
  if (!(y >= 1000) || !(m >= 1 && m <= 12) || !(d >= 1 && d <= daysIn(y, m))) return null;
  if (v.length === 8) return { wall: Date.UTC(y, m - 1, d), date: true, utc: false };
  if ((v[8] !== "T" && v[8] !== "t") || (v.length === 16 && v[15] !== "Z" && v[15] !== "z")) return null;
  const [h, mi, s] = [digits(v, 9, 11), digits(v, 11, 13), digits(v, 13, 15)];
  if (!(h <= 23) || !(mi <= 59) || !(s <= 60)) return null;
  return { wall: Date.UTC(y, m - 1, d, h, mi, Math.min(s, 59)), date: false, utc: v.length === 16 };
}

function momentOf(value: string, params: Map<string, string>, zones: ZoneBook | null): Moment | null {
  const s = readStamp(value);
  if (!s) return null;
  if (s.date || params.get("VALUE")?.toUpperCase() === "DATE") return { wall: floorDay(s.wall), clock: DATE };
  if (s.utc) return { wall: s.wall, clock: UTC_CLOCK };
  const tzid = params.get("TZID");
  return { wall: s.wall, clock: tzid && zones ? zones.clock(tzid) : FLOATING };
}

/** Every date in a comma list (RDATE, EXDATE), leaving out PERIOD values. */
function momentsOf(props: Prop[], zones: ZoneBook): Moment[] {
  const out: Moment[] = [];
  for (const p of props) {
    if (p.params.get("VALUE")?.toUpperCase() === "PERIOD") continue;
    for (const v of p.value.split(",")) {
      if (out.length >= CAP.dates) return out;
      const m = v.includes("/") ? null : momentOf(v, p.params, zones);
      if (m) out.push(m);
    }
  }
  return out;
}

/** `P1W`, `P1D`, `PT1H30M`, `P1DT2H`; null for a negative or malformed one. */
function readSpan(raw: string): Span | null {
  const s = raw.trim().toUpperCase();
  let i = s[0] === "+" ? 1 : 0;
  if (s[i++] !== "P") return null;
  let days = 0;
  let ms = 0;
  let time = false;
  let any = false;
  while (i < s.length) {
    if (s[i] === "T" && !time) {
      time = true;
      i++;
      continue;
    }
    let n = 0;
    let count = 0;
    for (; i < s.length && count < 7 && s[i] >= "0" && s[i] <= "9"; count++) n = n * 10 + (s.charCodeAt(i++) - 48);
    const unit = s[i++];
    if (!count) return null;
    if (!time && unit === "W") days += 7 * n;
    else if (!time && unit === "D") days += n;
    else if (time && unit === "H") ms += n * 3_600_000;
    else if (time && unit === "M") ms += n * 60_000;
    else if (time && unit === "S") ms += n * 1000;
    else return null;
    any = true;
  }
  if (!any || days > 36_600 || ms > 36_600 * DAY) return null;
  return { days, ms };
}

/** `+0530`, `-0800`, `+053000`, as milliseconds east of UTC. */
function readOffset(raw: string): number | null {
  const v = raw.trim();
  if ((v.length !== 5 && v.length !== 7) || (v[0] !== "+" && v[0] !== "-")) return null;
  const [h, m, s] = [digits(v, 1, 3), digits(v, 3, 5), v.length === 7 ? digits(v, 5, 7) : 0];
  if (!(h <= 23) || !(m <= 59) || !(s <= 59)) return null;
  return (v[0] === "-" ? -1 : 1) * ((h * 60 + m) * 60 + s) * 1000;
}

const iso = (ms: number) => new Date(ms).toISOString();
const compact = (ms: number) => iso(ms).slice(0, 19).replace(/[-:]/g, "");

// ------------------------------------------------------------------ time zones

interface Zone {
  /** The IANA name, or null for a zone only the feed defines (or the UTC we fall back to). */
  name: string | null;
  /** Milliseconds east of UTC at an instant. */
  offsetAt(utc: number): number;
}

const UTC: Zone = { name: null, offsetAt: () => 0 };
const UTC_CLOCK: Clock = { kind: "zoned", zone: UTC };

/**
 * A wall time in a zone as an instant. A wall time the zone skips (the spring gap) moves forward by
 * the gap; one it repeats (the fall overlap) is the earlier instant, as RFC 5545 says.
 */
function toUtc(zone: Zone, wall: number): number {
  if (zone === UTC) return wall;
  let days = steadyDays.get(zone);
  if (!days) steadyDays.set(zone, (days = new Map()));
  const day = Math.floor(wall / DAY);
  let steady = days.get(day);
  if (steady === undefined) {
    const offset = zone.offsetAt(day * DAY - DAY);
    steady = offset === zone.offsetAt(day * DAY + 2 * DAY) ? offset : null;
    if (days.size >= 100_000) days.clear();
    days.set(day, steady);
  }
  if (steady !== null) return wall - steady;
  const before = zone.offsetAt(wall - DAY);
  const after = zone.offsetAt(wall + DAY);
  if (before === after) return wall - before;
  const early = wall - before;
  const late = wall - after;
  const earlyOk = zone.offsetAt(early) === before;
  const lateOk = zone.offsetAt(late) === after;
  if (earlyOk && lateOk) return Math.min(early, late);
  if (lateOk) return late;
  return early;
}

/** Per zone, each wall-clock day's offset when no transition is near it (null when one is), so most conversions skip Intl. */
const steadyDays = new WeakMap<Zone, Map<number, number | null>>();

const toWall = (zone: Zone, utc: number) => utc + zone.offsetAt(utc);

const ianaZones = new Map<string, Zone>();

/** An IANA zone Intl knows, or null. Known zones are kept for later feeds; unknown names are not, so hostile TZIDs can't grow the cache. */
function ianaZone(raw: string): Zone | null {
  const key = raw.toLowerCase();
  const known = ianaZones.get(key);
  if (known) return known;
  if (!raw || raw.length > 64) return null;
  let format: Intl.DateTimeFormat;
  try {
    format = new Intl.DateTimeFormat("en-US", { timeZone: raw, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" });
  } catch {
    return null;
  }
  const canonical = format.resolvedOptions().timeZone;
  // Intl may canonicalize to an older alias (Asia/Kolkata to Asia/Calcutta); keep the name as written, fixing only its case.
  const name = canonical.toLowerCase() === key ? canonical : raw;
  const zone: Zone = {
    name,
    offsetAt(utc) {
      const t = Math.floor(utc / 1000) * 1000;
      let y = 0, mo = 0, d = 0, h = 0, mi = 0, s = 0;
      for (const part of format.formatToParts(t)) {
        const n = +part.value;
        if (part.type === "year") y = n;
        else if (part.type === "month") mo = n;
        else if (part.type === "day") d = n;
        else if (part.type === "hour") h = n;
        else if (part.type === "minute") mi = n;
        else if (part.type === "second") s = n;
      }
      return Date.UTC(y, mo - 1, d, h, mi, s) - t;
    },
  };
  ianaZones.set(key, zone);
  return zone;
}

/** Windows zone names (Outlook, Exchange) to IANA, from CLDR's windowsZones table. */
export const WINDOWS_ZONES: Record<string, string> = {
  "Dateline Standard Time": "Etc/GMT+12",
  "UTC-11": "Etc/GMT+11",
  "Aleutian Standard Time": "America/Adak",
  "Hawaiian Standard Time": "Pacific/Honolulu",
  "Marquesas Standard Time": "Pacific/Marquesas",
  "Alaskan Standard Time": "America/Anchorage",
  "UTC-09": "Etc/GMT+9",
  "Pacific Standard Time (Mexico)": "America/Tijuana",
  "UTC-08": "Etc/GMT+8",
  "Pacific Standard Time": "America/Los_Angeles",
  "US Mountain Standard Time": "America/Phoenix",
  "Mountain Standard Time (Mexico)": "America/Mazatlan",
  "Mountain Standard Time": "America/Denver",
  "Yukon Standard Time": "America/Whitehorse",
  "Central America Standard Time": "America/Guatemala",
  "Central Standard Time": "America/Chicago",
  "Easter Island Standard Time": "Pacific/Easter",
  "Central Standard Time (Mexico)": "America/Mexico_City",
  "Canada Central Standard Time": "America/Regina",
  "SA Pacific Standard Time": "America/Bogota",
  "Eastern Standard Time (Mexico)": "America/Cancun",
  "Eastern Standard Time": "America/New_York",
  "Haiti Standard Time": "America/Port-au-Prince",
  "Cuba Standard Time": "America/Havana",
  "US Eastern Standard Time": "America/Indiana/Indianapolis",
  "Turks And Caicos Standard Time": "America/Grand_Turk",
  "Paraguay Standard Time": "America/Asuncion",
  "Atlantic Standard Time": "America/Halifax",
  "Venezuela Standard Time": "America/Caracas",
  "Central Brazilian Standard Time": "America/Cuiaba",
  "SA Western Standard Time": "America/La_Paz",
  "Pacific SA Standard Time": "America/Santiago",
  "Newfoundland Standard Time": "America/St_Johns",
  "Tocantins Standard Time": "America/Araguaina",
  "E. South America Standard Time": "America/Sao_Paulo",
  "SA Eastern Standard Time": "America/Cayenne",
  "Argentina Standard Time": "America/Argentina/Buenos_Aires",
  "Greenland Standard Time": "America/Godthab",
  "Montevideo Standard Time": "America/Montevideo",
  "Magallanes Standard Time": "America/Punta_Arenas",
  "Saint Pierre Standard Time": "America/Miquelon",
  "Bahia Standard Time": "America/Bahia",
  "UTC-02": "Etc/GMT+2",
  "Azores Standard Time": "Atlantic/Azores",
  "Cape Verde Standard Time": "Atlantic/Cape_Verde",
  "UTC": "UTC",
  "Coordinated Universal Time": "UTC",
  "GMT Standard Time": "Europe/London",
  "Greenwich Standard Time": "Atlantic/Reykjavik",
  "Sao Tome Standard Time": "Africa/Sao_Tome",
  "Morocco Standard Time": "Africa/Casablanca",
  "W. Europe Standard Time": "Europe/Berlin",
  "Central Europe Standard Time": "Europe/Budapest",
  "Romance Standard Time": "Europe/Paris",
  "Central European Standard Time": "Europe/Warsaw",
  "W. Central Africa Standard Time": "Africa/Lagos",
  "Jordan Standard Time": "Asia/Amman",
  "GTB Standard Time": "Europe/Bucharest",
  "Middle East Standard Time": "Asia/Beirut",
  "Egypt Standard Time": "Africa/Cairo",
  "E. Europe Standard Time": "Europe/Chisinau",
  "Syria Standard Time": "Asia/Damascus",
  "West Bank Standard Time": "Asia/Hebron",
  "South Africa Standard Time": "Africa/Johannesburg",
  "FLE Standard Time": "Europe/Kiev",
  "Israel Standard Time": "Asia/Jerusalem",
  "South Sudan Standard Time": "Africa/Juba",
  "Kaliningrad Standard Time": "Europe/Kaliningrad",
  "Sudan Standard Time": "Africa/Khartoum",
  "Libya Standard Time": "Africa/Tripoli",
  "Namibia Standard Time": "Africa/Windhoek",
  "Arabic Standard Time": "Asia/Baghdad",
  "Turkey Standard Time": "Europe/Istanbul",
  "Arab Standard Time": "Asia/Riyadh",
  "Belarus Standard Time": "Europe/Minsk",
  "Russian Standard Time": "Europe/Moscow",
  "E. Africa Standard Time": "Africa/Nairobi",
  "Volgograd Standard Time": "Europe/Volgograd",
  "Iran Standard Time": "Asia/Tehran",
  "Arabian Standard Time": "Asia/Dubai",
  "Astrakhan Standard Time": "Europe/Astrakhan",
  "Azerbaijan Standard Time": "Asia/Baku",
  "Russia Time Zone 3": "Europe/Samara",
  "Mauritius Standard Time": "Indian/Mauritius",
  "Saratov Standard Time": "Europe/Saratov",
  "Georgian Standard Time": "Asia/Tbilisi",
  "Caucasus Standard Time": "Asia/Yerevan",
  "Afghanistan Standard Time": "Asia/Kabul",
  "West Asia Standard Time": "Asia/Tashkent",
  "Ekaterinburg Standard Time": "Asia/Yekaterinburg",
  "Pakistan Standard Time": "Asia/Karachi",
  "Qyzylorda Standard Time": "Asia/Qyzylorda",
  "India Standard Time": "Asia/Kolkata",
  "Sri Lanka Standard Time": "Asia/Colombo",
  "Nepal Standard Time": "Asia/Kathmandu",
  "Central Asia Standard Time": "Asia/Almaty",
  "Bangladesh Standard Time": "Asia/Dhaka",
  "Omsk Standard Time": "Asia/Omsk",
  "Myanmar Standard Time": "Asia/Yangon",
  "SE Asia Standard Time": "Asia/Bangkok",
  "Altai Standard Time": "Asia/Barnaul",
  "W. Mongolia Standard Time": "Asia/Hovd",
  "North Asia Standard Time": "Asia/Krasnoyarsk",
  "N. Central Asia Standard Time": "Asia/Novosibirsk",
  "Tomsk Standard Time": "Asia/Tomsk",
  "China Standard Time": "Asia/Shanghai",
  "North Asia East Standard Time": "Asia/Irkutsk",
  "Singapore Standard Time": "Asia/Singapore",
  "W. Australia Standard Time": "Australia/Perth",
  "Taipei Standard Time": "Asia/Taipei",
  "Ulaanbaatar Standard Time": "Asia/Ulaanbaatar",
  "Aus Central W. Standard Time": "Australia/Eucla",
  "Transbaikal Standard Time": "Asia/Chita",
  "Tokyo Standard Time": "Asia/Tokyo",
  "North Korea Standard Time": "Asia/Pyongyang",
  "Korea Standard Time": "Asia/Seoul",
  "Yakutsk Standard Time": "Asia/Yakutsk",
  "Cen. Australia Standard Time": "Australia/Adelaide",
  "AUS Central Standard Time": "Australia/Darwin",
  "E. Australia Standard Time": "Australia/Brisbane",
  "AUS Eastern Standard Time": "Australia/Sydney",
  "West Pacific Standard Time": "Pacific/Port_Moresby",
  "Tasmania Standard Time": "Australia/Hobart",
  "Vladivostok Standard Time": "Asia/Vladivostok",
  "Lord Howe Standard Time": "Australia/Lord_Howe",
  "Bougainville Standard Time": "Pacific/Bougainville",
  "Russia Time Zone 10": "Asia/Srednekolymsk",
  "Magadan Standard Time": "Asia/Magadan",
  "Norfolk Standard Time": "Pacific/Norfolk",
  "Sakhalin Standard Time": "Asia/Sakhalin",
  "Central Pacific Standard Time": "Pacific/Guadalcanal",
  "Russia Time Zone 11": "Asia/Kamchatka",
  "New Zealand Standard Time": "Pacific/Auckland",
  "UTC+12": "Etc/GMT-12",
  "Fiji Standard Time": "Pacific/Fiji",
  "Chatham Islands Standard Time": "Pacific/Chatham",
  "UTC+13": "Etc/GMT-13",
  "Tonga Standard Time": "Pacific/Tongatapu",
  "Samoa Standard Time": "Pacific/Apia",
  "Line Islands Standard Time": "Pacific/Kiritimati",
};

const windowsZones = new Map(Object.entries(WINDOWS_ZONES).map(([win, iana]) => [win.toLowerCase(), iana]));

/** A TZID that names a zone by itself: an IANA name, a Windows name, or an IANA name behind a prefix (`/mozilla.org/20050126_1/America/New_York`). */
function namedZone(tzid: string): Zone | null {
  const id = tzid.trim().replace(/^"(.*)"$/, "$1").trim();
  const win = windowsZones.get(id.toLowerCase());
  const direct = ianaZone(id) ?? (win ? ianaZone(win) : null);
  if (direct) return direct;
  const segments = id.split("/").filter(Boolean);
  for (let n = Math.min(3, segments.length - 1); n >= 1; n--) {
    const zone = ianaZone(segments.slice(-n).join("/"));
    if (zone) return zone;
  }
  return null;
}

interface ZoneBook {
  /** The zone floating and all-day times are read in for the window: X-WR-TIMEZONE, else UTC. */
  floating: Zone;
  clock(tzid: string): Clock;
}

/** Resolves TZIDs: by name, else by the feed's own VTIMEZONE, else X-WR-TIMEZONE, else UTC. */
function zoneBook(timezones: Component[], feedTz: string | null): ZoneBook {
  const floating = (feedTz && namedZone(feedTz)) || UTC;
  const defined = new Map<string, Component>();
  for (const tz of timezones) {
    const id = tz.props.find((p) => p.name === "TZID")?.value.trim();
    if (id && !defined.has(id)) defined.set(id, tz);
  }
  const clocks = new Map<string, Clock>();
  return {
    floating,
    clock(tzid) {
      const cached = clocks.get(tzid);
      if (cached) return cached;
      const def = defined.get(tzid.trim());
      const location = def?.props.find((p) => p.name === "X-LIC-LOCATION")?.value;
      const zone = namedZone(tzid) ?? (location ? namedZone(location) : null) ?? (def ? definedZone(def) : null) ?? floating;
      const clock: Clock = { kind: "zoned", zone };
      clocks.set(tzid, clock);
      return clock;
    },
  };
}

/** One STANDARD or DAYLIGHT block: from its onsets on, the zone is `to` ms east of UTC. */
interface Observance {
  start: number;
  from: number;
  to: number;
  rule: Rule | null;
  until: number | null;
  rdates: number[];
}

/** A zone defined only by the feed's VTIMEZONE, following its STANDARD and DAYLIGHT rules. */
function definedZone(tz: Component): Zone | null {
  const observances: Observance[] = [];
  for (const block of tz.children) {
    const first = (name: string) => block.props.find((p) => p.name === name);
    const start = first("DTSTART") && readStamp(first("DTSTART")!.value);
    const from = first("TZOFFSETFROM") && readOffset(first("TZOFFSETFROM")!.value);
    const to = first("TZOFFSETTO") && readOffset(first("TZOFFSETTO")!.value);
    if (!start || typeof from !== "number" || typeof to !== "number") continue;
    const rrule = first("RRULE");
    const rule = rrule ? readRule(rrule.value) : null;
    const real = rule && rule !== "first-only" ? rule : null;
    // UNTIL is in UTC here; the onset's wall time is in the offset it's leaving.
    const until = real?.until ? (real.until.clock.kind === "zoned" ? real.until.wall + from : real.until.wall) : null;
    const rdates = momentsOf(block.props.filter((p) => p.name === "RDATE"), NO_ZONES).map((m) => m.wall);
    observances.push({ start: start.wall, from, to, rule: real, until, rdates });
  }
  if (!observances.length) return null;
  const earliest = observances.reduce((a, b) => (b.start - b.from < a.start - a.from ? b : a));
  const years = new Map<number, Array<[number, number]>>();
  return {
    name: null,
    offsetAt(utc) {
      const year = new Date(utc).getUTCFullYear();
      let list = years.get(year);
      if (!list) years.set(year, (list = transitionsIn(observances, year, earliest.from)));
      let offset = list[0][1];
      for (const [at, to] of list) {
        if (at > utc) break;
        offset = to;
      }
      return offset;
    },
  };
}

/** The offset in force as a year starts, then each change during it, as [instant, offset] pairs. */
function transitionsIn(observances: Observance[], year: number, fallback: number): Array<[number, number]> {
  const start = Date.UTC(year, 0, 1);
  const end = Date.UTC(year + 1, 0, 1);
  let base: [number, number] = [-Infinity, fallback];
  let baseAt = -Infinity;
  const within: Array<[number, number]> = [];
  for (const o of observances) {
    const onsets = (skipTo: number) => {
      const budget = { left: MAX_PERIODS };
      const walls = o.rule ? [...ruleWalls(o.rule, o.start, o.until, skipTo, end + o.from, budget)] : [o.start];
      return [...walls, ...o.rdates].sort((a, b) => a - b);
    };
    // A rule that ended before this year has no onset near it: walk it from its start instead.
    const walls = onsets(o.until !== null && o.until < start + o.from ? -Infinity : start + o.from - 800 * DAY);
    for (const wall of walls) {
      const at = wall - o.from;
      if (at < start && at > baseAt) [baseAt, base] = [at, [-Infinity, o.to]];
      else if (at >= start && at < end) within.push([at, o.to]);
    }
  }
  return [base, ...within.sort((a, b) => a[0] - b[0])];
}

/** RDATEs in a VTIMEZONE never carry a TZID. */
const NO_ZONES = { floating: UTC, clock: () => FLOATING } satisfies ZoneBook;

// ------------------------------------------------------------------ recurrence rules

type Freq = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";

interface Rule {
  freq: Freq;
  interval: number;
  count: number | null;
  until: Moment | null;
  /** Weekdays (Monday = 0), each with an ordinal in its month or year (-1 = last), or 0 for every one. */
  byDay: Array<{ n: number; day: number }>;
  byMonthDay: number[];
  byMonth: number[];
  byYearDay: number[];
  bySetPos: number[];
  wkst: number;
}

const WEEKDAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
const FREQS: readonly string[] = ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"];
const SUB_DAILY: readonly string[] = ["HOURLY", "MINUTELY", "SECONDLY"];

/**
 * An RRULE value as a rule. "first-only" for a rule we don't expand (sub-daily frequencies, BYWEEKNO):
 * the event keeps its first instance. Null for a malformed rule, which is ignored.
 */
function readRule(value: string): Rule | "first-only" | null {
  const parts = new Map<string, string>();
  for (const piece of value.split(";")) {
    const eq = piece.indexOf("=");
    const key = piece.slice(0, eq).trim().toUpperCase();
    if (eq > 0 && !parts.has(key)) parts.set(key, piece.slice(eq + 1).trim().toUpperCase());
  }
  const freq = parts.get("FREQ") ?? "";
  if (SUB_DAILY.includes(freq)) return "first-only";
  if (!FREQS.includes(freq)) return null;
  if (parts.has("BYWEEKNO")) return "first-only";
  const int = (v: string | undefined, min: number, max: number) => {
    if (v === undefined) return undefined;
    const n = /^[+-]?\d{1,9}$/.test(v) ? +v : NaN;
    return n >= min && n <= max ? n : null;
  };
  const list = (key: string, min: number, max: number) => {
    const v = parts.get(key);
    if (v === undefined) return [];
    const ns = v.split(",").slice(0, 400).map((x) => int(x, min, max));
    return ns.every((n) => typeof n === "number" && n !== 0) ? ([...new Set(ns)] as number[]).sort((a, b) => a - b) : null;
  };
  const interval = int(parts.get("INTERVAL"), 1, 100_000);
  const count = int(parts.get("COUNT"), 1, 1_000_000_000);
  const untilRaw = parts.get("UNTIL");
  const until = untilRaw === undefined ? null : momentOf(untilRaw, new Map(), null);
  const byMonthDay = list("BYMONTHDAY", -31, 31);
  const byMonth = list("BYMONTH", 1, 12);
  const byYearDay = list("BYYEARDAY", -366, 366);
  const bySetPos = list("BYSETPOS", -366, 366);
  const wkst = parts.has("WKST") ? WEEKDAYS.indexOf(parts.get("WKST")!) : 0;
  const byDay: Rule["byDay"] = [];
  for (const item of parts.get("BYDAY")?.split(",").slice(0, 400) ?? []) {
    const m = item.match(/^([+-]?\d{1,2})?(MO|TU|WE|TH|FR|SA|SU)$/);
    const n = m?.[1] ? +m[1] : 0;
    if (!m || n < -53 || n > 53) return null;
    byDay.push({ n, day: WEEKDAYS.indexOf(m[2]) });
  }
  if (interval === null || count === null || (untilRaw !== undefined && !until) || !byMonthDay || !byMonth || !byYearDay || !bySetPos || wkst < 0) return null;
  return { freq: freq as Freq, interval: interval ?? 1, count: count ?? null, until, byDay, byMonthDay, byMonth, byYearDay, bySetPos, wkst };
}

/** DTSTART's day and its date parts. */
interface Anchor {
  day: number;
  y: number;
  m: number;
  d: number;
}

/** A frequency's periods: the first day of the kth one, which period a day falls in, and the rule's days in the kth one. */
interface Period {
  first(r: Rule, a: Anchor, k: number): number;
  index(r: Rule, a: Anchor, day: number): number;
  days(r: Rule, a: Anchor, k: number): number[];
}

const inMonths = (r: Rule, day: number) => !r.byMonth.length || r.byMonth.includes(partsOf(day).m);

/** A day of the month or year counted from its start, or (negative) from its end; null past either end. */
const nthDay = (first: number, length: number, n: number) => (n > 0 ? (n <= length ? first + n - 1 : null) : length + n >= 0 ? first + length + n : null);

/** The nth (negative: nth from last; 0: every) `day` of the week between first and last. */
function weekdaysBetween(first: number, last: number, n: number, day: number): number[] {
  const all: number[] = [];
  for (let x = first + ((day - weekday(first) + 7) % 7); x <= last; x += 7) all.push(x);
  if (n === 0) return all;
  const pick = n > 0 ? all[n - 1] : all[all.length + n];
  return pick === undefined ? [] : [pick];
}

/** The rule's days in one month: its days of the month and/or its weekdays (both: where they agree), else the anchor's day. */
function monthDays(r: Rule, y: number, m: number, anchorDay: number): number[] {
  const first = dayNumber(y, m, 1);
  const length = daysIn(y, m);
  const byMonthDay = r.byMonthDay.map((n) => nthDay(first, length, n)).filter((x): x is number => x !== null);
  const byDay = r.byDay.flatMap((d) => weekdaysBetween(first, first + length - 1, d.n, d.day));
  if (r.byMonthDay.length && r.byDay.length) return byMonthDay.filter((x) => byDay.includes(x));
  if (r.byMonthDay.length) return byMonthDay;
  if (r.byDay.length) return byDay;
  return anchorDay <= length ? [first + anchorDay - 1] : [];
}

/** BYMONTHDAY, BYYEARDAY and BYDAY as limits on a day already chosen. */
function dayPasses(r: Rule, day: number): boolean {
  const { y, m } = partsOf(day);
  if (r.byMonthDay.length && !r.byMonthDay.some((n) => nthDay(dayNumber(y, m, 1), daysIn(y, m), n) === day)) return false;
  if (r.byYearDay.length) {
    const jan1 = dayNumber(y, 1, 1);
    if (!r.byYearDay.some((n) => nthDay(jan1, dayNumber(y + 1, 1, 1) - jan1, n) === day)) return false;
  }
  return !r.byDay.length || r.byDay.some((b) => b.day === weekday(day));
}

const monthAt = (a: Anchor, months: number) => {
  const index = a.y * 12 + (a.m - 1) + months;
  return [Math.floor(index / 12), (index % 12) + 1] as const;
};

const PERIODS: Record<Freq, Period> = {
  DAILY: {
    first: (r, a, k) => a.day + k * r.interval,
    index: (r, a, day) => Math.floor((day - a.day) / r.interval),
    days: (r, a, k) => {
      const day = a.day + k * r.interval;
      return inMonths(r, day) && dayPasses(r, day) ? [day] : [];
    },
  },
  WEEKLY: {
    first: (r, a, k) => weekStart(a.day, r.wkst) + 7 * k * r.interval,
    index: (r, a, day) => Math.floor((weekStart(day, r.wkst) - weekStart(a.day, r.wkst)) / (7 * r.interval)),
    days: (r, a, k) => {
      const start = weekStart(a.day, r.wkst) + 7 * k * r.interval;
      const days = r.byDay.length ? r.byDay.map((d) => d.day) : [weekday(a.day)];
      return days.map((d) => start + ((d - r.wkst + 7) % 7)).filter((day) => inMonths(r, day));
    },
  },
  MONTHLY: {
    first: (r, a, k) => dayNumber(...monthAt(a, k * r.interval), 1),
    index: (r, a, day) => {
      const p = partsOf(day);
      return Math.floor(((p.y - a.y) * 12 + (p.m - a.m)) / r.interval);
    },
    days: (r, a, k) => {
      const [y, m] = monthAt(a, k * r.interval);
      return r.byMonth.length && !r.byMonth.includes(m) ? [] : monthDays(r, y, m, a.d);
    },
  },
  YEARLY: {
    first: (r, a, k) => dayNumber(a.y + k * r.interval, 1, 1),
    index: (r, a, day) => Math.floor((partsOf(day).y - a.y) / r.interval),
    days: (r, a, k) => {
      const y = a.y + k * r.interval;
      const jan1 = dayNumber(y, 1, 1);
      const length = dayNumber(y + 1, 1, 1) - jan1;
      const months = r.byMonth.length ? r.byMonth : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
      if (r.byYearDay.length) {
        const days = r.byYearDay.map((n) => nthDay(jan1, length, n)).filter((x): x is number => x !== null);
        return days.filter((day) => inMonths(r, day) && dayPasses({ ...r, byYearDay: [] }, day));
      }
      if (r.byMonthDay.length || (r.byDay.length && r.byMonth.length)) return months.flatMap((m) => monthDays(r, y, m, a.d));
      if (r.byDay.length) return r.byDay.flatMap((d) => weekdaysBetween(jan1, jan1 + length - 1, d.n, d.day));
      return (r.byMonth.length ? r.byMonth : [a.m]).flatMap((m) => (a.d <= daysIn(y, m) ? [dayNumber(y, m, a.d)] : []));
    },
  },
};

/** BYSETPOS: the chosen positions (1-based; negative from the end) of a period's sorted instances. */
function atPositions(days: number[], positions: number[]): number[] {
  const picked = positions.map((p) => (p > 0 ? days[p - 1] : days[days.length + p])).filter((x): x is number => x !== undefined);
  return [...new Set(picked)].sort((a, b) => a - b);
}

/**
 * A rule's wall times in order: DTSTART first (it always counts, RFC 5545), then each later instance
 * until COUNT, UNTIL (a wall time), `stopAt`, the per-rule period cap or the shared budget. Without a
 * COUNT, periods before `skipTo` aren't walked.
 */
function* ruleWalls(r: Rule, start: number, until: number | null, skipTo: number, stopAt: number, budget: { left: number }): Generator<number> {
  yield start;
  let emitted = 1;
  if (r.count !== null && emitted >= r.count) return;
  const day = Math.floor(start / DAY);
  const anchor: Anchor = { day, ...partsOf(day) };
  const time = start - day * DAY;
  const period = PERIODS[r.freq];
  let k = r.count === null && skipTo > start ? Math.max(0, period.index(r, anchor, Math.floor(skipTo / DAY)) - 1) : 0;
  const stopDay = Math.floor(Math.min(stopAt, MAX_WALL) / DAY);
  for (let n = 0; n < MAX_PERIODS && budget.left > 0; n++, k++) {
    budget.left--;
    if (!(period.first(r, anchor, k) <= stopDay)) return;
    let days = [...new Set(period.days(r, anchor, k))].sort((a, b) => a - b);
    if (r.bySetPos.length) days = atPositions(days, r.bySetPos);
    for (const d of days) {
      const wall = d * DAY + time;
      if (wall <= start) continue;
      if (until !== null && wall > until) return;
      yield wall;
      if (r.count !== null && ++emitted >= r.count) return;
    }
  }
}

// ------------------------------------------------------------------ events

type Details = Pick<Occurrence, "title" | "location" | "description" | "url" | "organizer" | "attendees">;

interface EventDef {
  uid: string;
  start: Moment;
  end: Moment | null;
  duration: Span | null;
  rule: Rule | "first-only" | null;
  rdates: Moment[];
  exdates: Moment[];
  recurrenceId: Moment | null;
  status: Occurrence["status"];
  details: Details;
}

const STATUSES: Record<string, Occurrence["status"]> = { CONFIRMED: "confirmed", TENTATIVE: "tentative", CANCELLED: "cancelled" };

/** A VEVENT as an event, or null without a usable DTSTART. */
function readEvent(comp: Component, zones: ZoneBook): EventDef | null {
  const first = new Map<string, Prop>();
  const all = (name: string) => comp.props.filter((p) => p.name === name);
  for (const p of comp.props) if (!first.has(p.name)) first.set(p.name, p);
  const dtstart = first.get("DTSTART");
  const start = dtstart && momentOf(dtstart.value, dtstart.params, zones);
  if (!start) return null;
  const dtend = first.get("DTEND");
  const recurrenceId = first.get("RECURRENCE-ID");
  const rrule = first.get("RRULE");
  const title = textOf(first.get("SUMMARY"), CAP.title);
  const uid = clip(first.get("UID")?.value.trim() ?? "", CAP.uid) || syntheticUid(dtstart, first.get("SUMMARY")?.value ?? "");
  const attendees: Person[] = [];
  for (const p of all("ATTENDEE")) {
    if (attendees.length >= CAP.attendees) break;
    const person = personOf(p);
    if (person) attendees.push(person);
  }
  const organizer = first.get("ORGANIZER");
  return {
    uid,
    start,
    end: dtend ? momentOf(dtend.value, dtend.params, zones) : null,
    duration: first.has("DURATION") ? readSpan(first.get("DURATION")!.value) : null,
    rule: rrule ? readRule(rrule.value) : null,
    rdates: momentsOf(all("RDATE"), zones),
    exdates: momentsOf(all("EXDATE"), zones),
    recurrenceId: recurrenceId ? momentOf(recurrenceId.value, recurrenceId.params, zones) : null,
    status: STATUSES[first.get("STATUS")?.value.trim().toUpperCase() ?? ""] ?? "confirmed",
    details: {
      title: title ?? "(No title)",
      location: textOf(first.get("LOCATION"), CAP.location),
      description: textOf(first.get("DESCRIPTION"), CAP.description),
      url: urlOf(first.get("URL")?.value),
      organizer: organizer ? personOf(organizer) : null,
      attendees,
    },
  };
}

/** A stable UID for an event without one: a hash of its start and title. */
function syntheticUid(dtstart: Prop, summary: string): string {
  const source = `${dtstart.params.get("TZID") ?? ""}|${dtstart.value}|${summary}`;
  const hash = (seed: number) => {
    let h = seed;
    for (let i = 0; i < source.length; i++) h = Math.imul(h ^ source.charCodeAt(i), 0x01000193);
    return (h >>> 0).toString(16).padStart(8, "0");
  };
  return `${hash(0x811c9dc5)}${hash(0x2166136b)}@common-ink`;
}

function personOf(p: Prop): Person | null {
  const value = p.value.trim();
  let email: string | null = null;
  if (value.slice(0, 7).toLowerCase() === "mailto:") email = value.slice(7).trim();
  else if (!value.includes(":") && value.includes("@")) email = value;
  email = email ? clip(email.toLowerCase(), CAP.email) : null;
  const name = clip(p.params.get("CN")?.trim() ?? "", CAP.name).trim() || null;
  const status = p.params.get("PARTSTAT")?.trim().toLowerCase() || null;
  return name || email ? { name, email, status } : null;
}

function urlOf(raw: string | undefined): string | null {
  const v = raw?.trim();
  if (!v || v.length > CAP.url) return null;
  try {
    const url = new URL(v);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ expansion

interface Ctx {
  from: number;
  to: number;
  floating: Zone;
  perEvent: number;
  total: number;
  budget: { left: number };
  out: Array<{ at: number; endAt: number; occ: Occurrence }>;
}

/** A wall time on a clock as an instant, for comparing with the window. */
const instant = (clock: Clock, wall: number, ctx: Ctx) => toUtc(clock.kind === "zoned" ? clock.zone : ctx.floating, wall);

/** Another date value (EXDATE, RDATE, RECURRENCE-ID, UNTIL) read on the event's own clock; a date on a timed clock takes the event's time of day. */
function wallOn(m: Moment, clock: Clock, timeOfDay: number): number {
  if (clock.kind === "date") return floorDay(m.wall);
  if (m.clock.kind === "date") return m.wall + timeOfDay;
  if (clock.kind === "floating" || m.clock.kind === "floating" || m.clock.zone === clock.zone) return m.wall;
  return toWall(clock.zone, toUtc(m.clock.zone, m.wall));
}

/** Which instance a wall time is: its original start in UTC, or its date for all-day, or its wall time for floating. */
function keyOf(clock: Clock, wall: number): string {
  if (clock.kind === "date") return compact(wall).slice(0, 8);
  if (clock.kind === "floating") return compact(wall);
  return `${compact(toUtc(clock.zone, wall))}Z`;
}

function stampOf(clock: Clock, wall: number, utc: number): string {
  if (clock.kind === "date") return iso(wall).slice(0, 10);
  if (clock.kind === "floating") return iso(wall).slice(0, 19);
  return `${iso(utc).slice(0, 19)}Z`;
}

/** How long each instance lasts: DTEND less DTSTART (exact), else DURATION, else a day (all-day) or nothing. */
function spanOf(def: EventDef, ctx: Ctx): Span {
  const { clock, wall } = def.start;
  if (def.end) {
    const end = wallOn(def.end, clock, wall - floorDay(wall));
    if (clock.kind === "date") return { days: Math.max(1, Math.round((end - wall) / DAY)), ms: 0 };
    const ms = clock.kind === "zoned" ? instant(clock, end, ctx) - instant(clock, wall, ctx) : end - wall;
    return { days: 0, ms: Math.max(0, ms) };
  }
  if (def.duration && clock.kind === "date") return { days: Math.max(1, def.duration.days + Math.ceil(def.duration.ms / DAY)), ms: 0 };
  if (def.duration) return def.duration;
  return { days: clock.kind === "date" ? 1 : 0, ms: 0 };
}

/** Adds one instance if it overlaps the window. True if it did. */
function emit(def: EventDef, wall: number, span: Span, key: string | null, recurring: boolean, ctx: Ctx): boolean {
  if (ctx.out.length >= ctx.total) return false;
  const clock = def.start.clock;
  const at = instant(clock, wall, ctx);
  const endWall = wall + span.days * DAY + (clock.kind === "zoned" ? 0 : span.ms);
  const endAt = (span.days ? instant(clock, wall + span.days * DAY, ctx) : at) + span.ms;
  if (!(at < ctx.to && (endAt > ctx.from || at >= ctx.from)) || endWall > MAX_WALL) return false;
  ctx.out.push({
    at,
    endAt,
    occ: {
      uid: def.uid,
      recurrenceId: key,
      start: stampOf(clock, wall, at),
      end: stampOf(clock, endWall, endAt),
      allDay: clock.kind === "date",
      timeZone: clock.kind === "zoned" ? clock.zone.name : null,
      ...def.details,
      status: def.status,
      recurring,
    },
  });
  return true;
}

/** Merges sorted extra wall times (RDATEs) into a rule's, without repeats. */
function* merged(walls: Iterable<number>, extra: number[]): Generator<number> {
  let i = 0;
  for (const wall of walls) {
    while (i < extra.length && extra[i] < wall) yield extra[i++];
    while (extra[i] === wall) i++;
    yield wall;
  }
  while (i < extra.length) yield extra[i++];
}

/** One UID's events: its master (or masters) expanded, with each override replacing or cancelling its instance. */
function expandSeries(group: EventDef[], ctx: Ctx): void {
  const masters = group.filter((d) => !d.recurrenceId);
  const overrides = group.filter((d) => d.recurrenceId);
  if (masters.length && masters.every((m) => m.status === "cancelled")) return;
  const main = masters[0]?.start;
  const keyed = overrides.map((o) => {
    const clock = main?.clock ?? o.recurrenceId!.clock;
    return { def: o, key: keyOf(clock, wallOn(o.recurrenceId!, clock, main ? main.wall - floorDay(main.wall) : 0)) };
  });
  const replaced = new Set(keyed.map((o) => o.key));
  for (const master of masters) if (master.status !== "cancelled") expandMaster(master, replaced, ctx);
  for (const { def, key } of keyed) {
    if (def.status !== "cancelled") emit(def, def.start.wall, spanOf(def, ctx), key, true, ctx);
  }
}

function expandMaster(def: EventDef, replaced: Set<string>, ctx: Ctx): void {
  const { clock, wall: start } = def.start;
  const timeOfDay = start - floorDay(start);
  const span = spanOf(def, ctx);
  const rule = def.rule === "first-only" ? null : def.rule;
  const recurring = def.rule !== null || def.rdates.length > 0;
  const excluded = new Set(def.exdates.map((m) => keyOf(clock, wallOn(m, clock, timeOfDay))));
  const extra = [...new Set(def.rdates.map((m) => wallOn(m, clock, timeOfDay)))].sort((a, b) => a - b);
  const until = rule?.until ? wallOn(rule.until, clock, timeOfDay) : null;
  // Walls sit within a day of the instants they stand for, whatever the zone.
  const stopAt = ctx.to + 2 * DAY;
  const skipTo = ctx.from - 2 * DAY - span.days * DAY - span.ms;
  const walls = rule ? ruleWalls(rule, start, until, skipTo, stopAt, ctx.budget) : [start];
  let count = 0;
  for (const wall of merged(walls, extra)) {
    if (wall > stopAt || ctx.out.length >= ctx.total) break;
    const key = keyOf(clock, wall);
    if (excluded.has(key) || replaced.has(key)) continue;
    if (emit(def, wall, span, recurring ? key : null, recurring, ctx) && ++count >= ctx.perEvent) break;
  }
}
