// Widgets live in markdown as one-line leaf directives (the CommonMark "generic directives"
// proposal, as used by remark-directive):   ::timer{duration=25m label="Tea" id=k3x9q}
// Config is in the file; runtime state (running, laps) is kept per widget id in the browser.

export interface Directive {
  name: string;
  args: Record<string, string>;
}

const DIRECTIVE = /^\s*::([a-z][\w-]*)(?:\{([^}\n]*)\})?\s*$/i;

export function parseDirective(line: string): Directive | null {
  const m = line.match(DIRECTIVE);
  return m ? { name: m[1].toLowerCase(), args: parseAttrs(m[2] ?? "") } : null;
}

/** `key=value` pairs; a key can also compare (`due<=today`), and then the operator starts its value ("<=today"). */
export function parseAttrs(src: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of src.matchAll(/([\w-]+)(?:(<=|>=|<|>|=)(?:"([^"]*)"|'([^']*)'|([^\s"']+)))?/g)) {
    const value = m[3] ?? m[4] ?? m[5];
    out[m[1]] = value === undefined ? "true" : m[2] === "=" ? value : `${m[2]}${value}`;
  }
  return out;
}

export function serializeDirective({ name, args }: Directive): string {
  const keys = [...Object.keys(args).filter((k) => k !== "id"), ...("id" in args ? ["id"] : [])];
  const parts = keys
    .filter((k) => args[k] !== undefined && args[k] !== "")
    .map((k) => {
      const op = args[k].match(/^(<=|>=|<|>)\s*/);
      const value = op ? args[k].slice(op[0].length) : args[k];
      return `${k}${op ? op[1] : "="}${/^[\w.:/+-]+$/.test(value) ? value : `"${value.replace(/"/g, "'")}"`}`;
    });
  return parts.length ? `::${name}{${parts.join(" ")}}` : `::${name}`;
}

export const newId = () => Math.random().toString(36).slice(2, 7);

/** "25m", "1h30m", "90s", "4:30", "1:02:03", "10" (minutes) → ms. */
export function parseDuration(input: string | undefined): number | null {
  const s = (input ?? "").trim().toLowerCase();
  if (!s) return null;
  let ms: number | null = null;
  const clock = s.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);
  const units = s.match(/^(?:(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?)?\s*(?:(\d+(?:\.\d+)?)\s*m(?:in(?:utes?)?)?)?\s*(?:(\d+(?:\.\d+)?)\s*s(?:ec(?:onds?)?)?)?$/);
  if (clock) {
    const [a, b, c] = [clock[1], clock[2], clock[3]].map((x) => Number(x ?? 0));
    ms = clock[3] === undefined ? (a * 60 + b) * 1000 : (a * 3600 + b * 60 + c) * 1000;
  } else if (/^\d+(?:\.\d+)?$/.test(s)) {
    ms = Number(s) * 60_000;
  } else if (units && (units[1] || units[2] || units[3])) {
    ms = (Number(units[1] ?? 0) * 3600 + Number(units[2] ?? 0) * 60 + Number(units[3] ?? 0)) * 1000;
  }
  return ms && ms > 0 && ms <= 100 * 3600_000 ? Math.round(ms) : null;
}

/** ms → canonical markdown form: "25m", "1h30m", "4m30s", "45s". */
export function formatDuration(ms: number): string {
  const t = Math.round(ms / 1000);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return `${h ? `${h}h` : ""}${m ? `${m}m` : ""}${s || (!h && !m) ? `${s}s` : ""}`;
}

/** ms → "04:59", "1:02:03", or with centiseconds "00:12.34". */
export function clock(ms: number, centis = false): string {
  const total = Math.max(0, ms);
  const cs = Math.floor((total % 1000) / 10);
  // Countdowns round up so "0:00" only shows when time is actually up.
  const secs = centis ? Math.floor(total / 1000) : Math.ceil(total / 1000);
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  const base = h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  return centis ? `${base}.${pad(cs)}` : base;
}
