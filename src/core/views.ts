// Saved views: a note query kept as a note, so what a person saves is a file like everything else
// they write. A view is a Markdown note in Views/ whose body holds one query directive line
// (`::view{tag=work sort=title}`, the widget a note shows it with, as a list, a table, a board or a
// month), with any words above it; its name is its file's name. The sidebar's Views, ⌘K, the MCP
// tools and the CLI read these notes.
//
// Who sees which: a note right in Views/ is shared with everyone in the workspace. A note in
// Views/<user ID>/ is that person's own, and listed only to them (online, a user ID is a short
// random string; locally the vault's one person keeps theirs right in Views/, as there's no one
// else). The folder is named by ID, not by name, so a view stays its owner's when they change their
// name, and two people with the same name can't land in one folder. It isn't private: like any
// note, everyone in the workspace can open it in the file tree. No Node imports: the web app uses
// this too.
import { parseDirective, serializeAttrs } from "./directive.ts";
import { proseLines } from "./prose.ts";
import { formatQuery, parseQuery, toQuery } from "./query.ts";
import { viewArgKeys } from "./view.ts";

/** The folder saved views live in. */
export const VIEWS = "Views";

/**
 * The directive a view note holds its query in. Only here: if the widget gets another name, this
 * is the one line to change (notes written with the old name would need rewriting too).
 */
export const VIEW_DIRECTIVE = "view";

/**
 * The line a view note keeps its query on: `::view{tag=work}`, or `::view` for every note. `own` are
 * the line's args that aren't its query (its title, layout and fields), written after it.
 */
export function viewLine(query: string, own: Record<string, string> = {}): string {
  const args = [formatQuery({ ...parseQuery(query), limit: undefined }), serializeAttrs(own)].filter(Boolean).join(" ");
  return args ? `::${VIEW_DIRECTIVE}{${args}}` : `::${VIEW_DIRECTIVE}`;
}

/**
 * The query in a view note's text, tidied, and the (0-based) line it's on: the first query
 * directive outside code. A limit sizes the widget, not the view, so it's left out. Null if the
 * note has none.
 */
export function viewQueryIn(text: string): { query: string; line: number } | null {
  for (const [n, line] of proseLines(text)) {
    const d = parseDirective(line);
    if (d?.name === VIEW_DIRECTIVE) return { query: formatQuery({ ...toQuery(d.args), limit: undefined }), line: n - 1 };
  }
  return null;
}

/**
 * A view note's text with its query line set to `query` (added at the end if it had none). The
 * line's title, layout, fields and id stay as they were.
 */
export function withViewQuery(text: string, query: string): string {
  const at = viewQueryIn(text);
  const lines = text.split("\n");
  if (at) {
    const indent = lines[at.line].match(/^\s*/)![0];
    const args = parseDirective(lines[at.line])!.args;
    const own = Object.fromEntries(viewArgKeys(args).filter((k) => args[k]).map((k) => [k, args[k]]));
    lines[at.line] = indent + viewLine(query, own) + (lines[at.line].endsWith("\r") ? "\r" : "");
    return lines.join("\n");
  }
  const body = text.replace(/\s+$/, "");
  return `${body ? `${body}\n\n` : ""}${viewLine(query)}\n`;
}

/** A new view note's text. */
export const viewNote = (query: string) => `${viewLine(query)}\n`;

/**
 * A view's name as a file name: what a note name can't hold (/ \ : * ? " < > | and the # ^ [ ] a
 * [[link]] reads) becomes a space, as a meeting note's title does.
 */
export function viewFileName(name: string): string {
  return name
    .replace(/[\\/:*?"<>|#^[\]\x00-\x1f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 80);
}
