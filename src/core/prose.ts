// Line-level markdown structure shared by the indexers and the editor (no Node imports, so the web
// app can use it too).

const LIST_ITEM = /^\s*([-*+]|\d+[.)])\s/;

/**
 * Lines outside code, with their 1-based line numbers. Code is a fenced block (closed only by a
 * bare fence of the same kind, at least as long) or an indented one: indented four spaces after a
 * blank line, unless it continues a list item.
 */
export function proseLines(md: string): Array<[number, string]> {
  const out: Array<[number, string]> = [];
  let fence: { char: string; len: number } | null = null;
  let indentedCode = false;
  let blankBefore = true;
  let lastProse = "";
  md.split("\n").forEach((line, i) => {
    if (fence) {
      const close = line.match(/^\s*(`{3,}|~{3,})\s*$/);
      if (close && close[1][0] === fence.char && close[1].length >= fence.len) fence = null;
      return;
    }
    const open = line.match(/^\s*(`{3,}|~{3,})/);
    if (open) {
      fence = { char: open[1][0], len: open[1].length };
      indentedCode = blankBefore = false;
      return;
    }
    if (!line.trim()) {
      blankBefore = true;
      if (!indentedCode) out.push([i + 1, line]);
      return;
    }
    const indented = /^( {4}|\t)/.test(line);
    indentedCode = indented && (indentedCode || (blankBefore && !LIST_ITEM.test(lastProse) && !/^\s/.test(lastProse)));
    blankBefore = false;
    if (indentedCode) return;
    lastProse = line;
    out.push([i + 1, line]);
  });
  return out;
}

/** The line with `code spans` blanked out, same length, so columns still line up. */
export const withoutCode = (line: string) => line.replace(/`[^`]*`/g, (s) => " ".repeat(s.length));

/** The line with code spans and [[links]] blanked out, for finding words that mean something (tags, people). */
export const withoutCodeOrLinks = (line: string) => withoutCode(line).replace(/\[\[[^\]\n]*\]\]/g, (s) => " ".repeat(s.length));

/** A markdown link's target with its %-escapes decoded; one that isn't valid escaping (`50%off.md`) is taken as written. */
export function decodeTarget(target: string): string {
  try {
    return decodeURIComponent(target);
  } catch {
    return target;
  }
}

/** How many lines the frontmatter block takes at the top of a note (0 if it has none). */
export function frontmatterLines(md: string): number {
  const m = md.match(/^---\r?\n[\s\S]*?\r?\n---(\r?\n|$)/);
  return m ? m[0].replace(/\r?\n$/, "").split("\n").length : 0;
}
