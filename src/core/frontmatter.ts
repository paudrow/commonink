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
