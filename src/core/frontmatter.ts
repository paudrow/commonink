// A note's frontmatter as entries: each top-level key with its lines, so a caller can read a few
// keys (a scalar, an inline list, or one `- item` per line) and write the rest back unchanged.
// No Node imports: the web app uses it too.

export interface Entry {
  key: string;
  /** The key's line and the lines nested under it, as written. */
  lines: string[];
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** A note's frontmatter entries, in order, and the text after the frontmatter. */
export function frontmatterEntries(md: string): { entries: Entry[]; body: string; had: boolean } {
  const m = md.match(FRONTMATTER);
  if (!m) return { entries: [], body: md, had: false };
  const out: Entry[] = [];
  for (const line of m[1].split(/\r?\n/)) {
    const key = line.match(/^([\w-]+):/)?.[1];
    if (key) out.push({ key, lines: [line] });
    else if (out.length) out.at(-1)!.lines.push(line); // a nested line, or a blank one
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

/** Split on commas that aren't inside quotes. */
function splitItems(s: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q: string | null = null;
  for (const ch of s) {
    if (q) (cur += ch), ch === q && (q = null);
    else if (ch === '"' || ch === "'") (cur += ch), (q = ch);
    else if (ch === ",") out.push(cur), (cur = "");
    else cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim());
}

/** An entry as one value (`key: "a, b"` is "a, b"). */
export function scalarOf(e: Entry | undefined): string {
  return e ? unquote(e.lines[0].replace(/^[\w-]+:/, "")) : "";
}

/** An entry's values: `key: a`, `key: [a, b]`, `key: a, b`, or one `- a` per line under it. */
export function listOf(e: Entry | undefined): string[] {
  if (!e) return [];
  const inline = e.lines[0].replace(/^[\w-]+:/, "").trim();
  if (inline) {
    const list = inline.match(/^\[(.*)\]$/);
    return splitItems(list ? list[1] : inline).map(unquote).filter(Boolean);
  }
  return e.lines.slice(1).flatMap((l) => l.match(/^\s*-\s+(.*)$/)?.[1] ?? []).map(unquote).filter(Boolean);
}
