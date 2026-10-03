// A note's frontmatter as entries: each top-level key with its lines, so a caller can read a few
// keys (a scalar, an inline list, or one `- item` per line) and write the rest back unchanged.
// No Node imports: the web app uses it too.

export interface Entry {
  key: string;
  /** The key's line and the lines nested under it, as written. */
  lines: string[];
}

// A leading byte-order mark (Windows editors write one) still starts the frontmatter.
const FRONTMATTER = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/**
 * A note's frontmatter entries, in order, and the text after the frontmatter. The body never keeps
 * a leading byte-order mark, so `frontmatterText(entries) + body` writes one block, not a second.
 */
export function frontmatterEntries(md: string): { entries: Entry[]; body: string; had: boolean } {
  md = md.replace(/^\uFEFF/, "");
  const m = md.match(FRONTMATTER);
  if (!m) return { entries: [], body: md, had: false };
  const out: Entry[] = [];
  for (const line of m[1].split(/\r?\n/)) {
    // Any unindented `key:` starts an entry (`Date Created:`, `título:` too), so writing one key back
    // never takes another's line with it.
    const key = line.match(/^([^\s#:-][^:]*|-[^\s:][^:]*):/)?.[1].trimEnd();
    if (key) out.push({ key, lines: [line] });
    // A nested line, a `- item`, or a blank one belongs to the entry above.
    else if (out.length && /^(\s|-\s|-$|$)/.test(line)) out.at(-1)!.lines.push(line);
    // Anything else (a `# comment`, or lines before the first key) is kept as its own keyless entry.
    else out.push({ key: "", lines: [line] });
  }
  return { entries: out, body: md.slice(m[0].length), had: true };
}

/** `entries` written back as a frontmatter block (none if there are none). */
export function frontmatterText(entries: Entry[]): string {
  return entries.length ? `---\n${entries.flatMap((e) => e.lines).join("\n")}\n---\n` : "";
}

function unquote(s: string): string {
  const t = s.trim();
  if (/^".*"$/.test(t)) return t.slice(1, -1).replace(/\\(["\\])/g, "$1");
  if (/^'.*'$/.test(t)) return t.slice(1, -1).replace(/''/g, "'");
  return t;
}

/**
 * Split on commas that aren't inside quotes. A quote opens only at the start of an item (`Dan's` is
 * plain text), and `\"` in double quotes or `''` in single quotes doesn't close it.
 */
function splitItems(s: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      cur += ch;
      if (q === '"' && ch === "\\" && i + 1 < s.length) cur += s[++i];
      else if (ch === "'" && q === "'" && s[i + 1] === "'") cur += s[++i];
      else if (ch === q) q = null;
    } else if ((ch === '"' || ch === "'") && !cur.trim()) (cur += ch), (q = ch);
    else if (ch === ",") out.push(cur), (cur = "");
    else cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim());
}

/** An entry as one value (`key: "a, b"` is "a, b"). */
export function scalarOf(e: Entry | undefined): string {
  return e ? unquote(e.lines[0].replace(/^[^:]*:/, "")) : "";
}

/** An entry's values: `key: a`, `key: [a, b]`, `key: a, b`, or one `- a` per line under it. */
export function listOf(e: Entry | undefined): string[] {
  if (!e) return [];
  const inline = e.lines[0].replace(/^[^:]*:/, "").trim();
  if (inline) {
    const list = inline.match(/^\[(.*)\]$/);
    return splitItems(list ? list[1] : inline).map(unquote).filter(Boolean);
  }
  return e.lines.slice(1).flatMap((l) => l.match(/^\s*-\s+(.*)$/)?.[1] ?? []).map(unquote).filter(Boolean);
}

/**
 * Frontmatter keys the app gives a meaning of its own, left out of a note's properties: `tags` are
 * tags (the tags index has them), and `title` is the note's title.
 */
export const OWN_KEYS: ReadonlySet<string> = new Set(["tags", "title"]);

/**
 * A note's frontmatter properties, for the properties index: each key in lowercase with its values.
 * A list (`[a, b]`, or one `- a` per line) has one per item; anything else is one value as written,
 * commas and all. Empty values and the keys in OWN_KEYS are left out.
 */
export function propsOf(md: string): Array<{ key: string; value: string }> {
  const out: Array<{ key: string; value: string }> = [];
  const seen = new Set<string>();
  for (const e of frontmatterEntries(md).entries) {
    const key = e.key.toLowerCase();
    if (!key || OWN_KEYS.has(key)) continue;
    const inline = e.lines[0].replace(/^[^:]*:/, "").trim();
    for (const value of !inline || /^\[.*\]$/.test(inline) ? listOf(e) : [scalarOf(e)]) {
      if (value && !seen.has(`${key}\0${value}`)) seen.add(`${key}\0${value}`), out.push({ key, value });
    }
  }
  return out;
}

/**
 * `md` with its frontmatter property `key` set to `value`, or taken out for null: a card moved to
 * another column of a board. The key keeps its case as written (`Status:`), a list becomes the one
 * value, and every other line stays as it was. A note without frontmatter gets some.
 */
export function withProperty(md: string, key: string, value: string | null): string {
  const { entries, body } = frontmatterEntries(md);
  const at = entries.findIndex((e) => e.key.toLowerCase() === key.toLowerCase());
  if (at < 0 && value === null) return md;
  const line = (k: string) => [{ key: k, lines: [`${k}: ${yamlScalar(value!)}`] }];
  const next = at < 0 ? [...entries, ...line(key)] : [...entries.slice(0, at), ...(value === null ? [] : line(entries[at].key)), ...entries.slice(at + 1)];
  // A note written with \r\n keeps them.
  const eol = /^﻿?---\r\n/.test(md) ? "\r\n" : "\n";
  return (md.startsWith("﻿") ? "﻿" : "") + frontmatterText(next).replace(/\n/g, eol) + body;
}

/** A value as YAML reads it back as written: quoted when it would read as something else (a list, a comment, a number's true or false). */
function yamlScalar(v: string): string {
  const plain = v !== "" && !/^[\s\-?:,[\]{}#&*!|>'"%@`]|[:#]\s|:$|\s$/.test(v) && !/^(true|false|null|yes|no|on|off|~)$/i.test(v);
  return plain ? v : `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
