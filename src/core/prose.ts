// Line-level markdown structure shared by the indexers and the editor (no Node imports, so the web
// app can use it too).

/** Lines outside fenced code blocks, with their 1-based line numbers. */
export function proseLines(md: string): Array<[number, string]> {
  const out: Array<[number, string]> = [];
  let fence: string | null = null;
  md.split("\n").forEach((line, i) => {
    const f = line.match(/^\s*(```+|~~~+)/);
    if (f) {
      if (!fence) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
      return;
    }
    if (!fence) out.push([i + 1, line]);
  });
  return out;
}

/** The line with `code spans` blanked out, same length, so columns still line up. */
export const withoutCode = (line: string) => line.replace(/`[^`]*`/g, (s) => " ".repeat(s.length));

/** How many lines the frontmatter block takes at the top of a note (0 if it has none). */
export function frontmatterLines(md: string): number {
  const m = md.match(/^---\r?\n[\s\S]*?\r?\n---(\r?\n|$)/);
  return m ? m[0].replace(/\r?\n$/, "").split("\n").length : 0;
}
