// A view: a note query and a layout. `::view{tag=work layout=board fields=owner,due}` lists the
// notes the query matches (query.ts) and lays them out as a list, a table, a board or a month. Every
// layout reads the same rows: each note with its title, its tags and the frontmatter properties the
// view asks for. The widget that draws them is web/src/widgets/view.ts; an export snapshots them in
// web/src/export/static.ts. No Node imports: the web app uses this too.

export const LAYOUTS = ["list", "table", "board", "calendar"] as const;
export type Layout = (typeof LAYOUTS)[number];

/** The layout a view's args ask for; list when they name none (or one that isn't a layout). */
export function layoutOf(args: Record<string, string>): Layout {
  const l = (args.layout ?? "").trim().toLowerCase();
  return (LAYOUTS as readonly string[]).includes(l) ? (l as Layout) : "list";
}

/** Fields every note has, not frontmatter properties. */
export const BUILT_IN_FIELDS = ["tags", "folder", "modified"];

/** What a board groups by when it names nothing, and what a calendar places notes by. */
export const DEFAULT_GROUP = "status";
export const DEFAULT_DATE = "due";

/** The fields a view shows (`fields=status, due`), lowercase, each once, at most 20. */
export function fieldsOf(args: Record<string, string>): string[] {
  return [...new Set((args.fields ?? "").split(",").map((f) => f.trim().toLowerCase()).filter(Boolean))].slice(0, 20);
}

/** The property a board makes a column of each value of. */
export const groupOf = (args: Record<string, string>) => (args.group ?? "").trim().toLowerCase() || DEFAULT_GROUP;

/** The property a calendar places each note on the day of. */
export const dateKeyOf = (args: Record<string, string>) => (args.date ?? "").trim().toLowerCase() || DEFAULT_DATE;

/**
 * A view's own args, which aren't filters. `group` and `date` are the board's and the calendar's,
 * so they're only the view's in that layout: elsewhere `date=2026-10-01` filters by a `date:` property.
 */
export function viewArgKeys(args: Record<string, string>): string[] {
  const layout = layoutOf(args);
  return ["label", "id", "layout", "fields", ...(layout === "board" ? ["group"] : []), ...(layout === "calendar" ? ["date"] : [])];
}

/** The frontmatter properties a view reads for its rows: its fields, and what it groups or dates by. */
export function propsWanted(args: Record<string, string>): string[] {
  const layout = layoutOf(args);
  const keys = fieldsOf(args).filter((f) => !BUILT_IN_FIELDS.includes(f));
  if (layout === "board") keys.push(groupOf(args));
  if (layout === "calendar") keys.push(dateKeyOf(args));
  return [...new Set(keys)];
}

/** How many notes a view shows: its limit, else a few for a list or table, and up to MAX_ROWS for a board or calendar. */
export const MAX_ROWS = 200;
export function rowsOf(args: Record<string, string>, limit: number | undefined): number {
  const layout = layoutOf(args);
  return Math.min(limit ?? (layout === "list" || layout === "table" ? 6 : MAX_ROWS), MAX_ROWS);
}

/** What a view's rows need: a note's path, its own date (see parse.ts's dateOf) and the properties asked for. */
export interface ViewRow {
  path: string;
  date?: string | null;
  props?: Record<string, string[]>;
}

/**
 * A board's columns: one per value of `key`, in the order the notes first have them, then one for
 * the notes without it (value null). A note with several values (`status: [review, draft]`) goes
 * under its first. Values that differ only in case are one column, named as first written.
 */
export function boardColumns<T extends ViewRow>(rows: T[], key: string): Array<{ value: string | null; rows: T[] }> {
  const cols = new Map<string, { value: string; rows: T[] }>();
  const none: T[] = [];
  for (const r of rows) {
    const v = r.props?.[key]?.[0];
    if (!v) none.push(r);
    else {
      const k = v.toLowerCase();
      (cols.get(k) ?? cols.set(k, { value: v, rows: [] }).get(k)!).rows.push(r);
    }
  }
  return [...cols.values(), ...(none.length || !cols.size ? [{ value: null, rows: none }] : [])];
}

const YMD = /^(\d{4})-(\d{2})-(\d{2})(?!\d)/;

/** The day (YYYY-MM-DD) a calendar puts a note on: its `key` property, else the note's own date. Null for neither. */
export function dayOf(row: ViewRow, key: string): string | null {
  for (const v of [...(row.props?.[key] ?? []), row.date ?? ""]) {
    const m = v.trim().match(YMD);
    if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12 && Number(m[3]) >= 1 && Number(m[3]) <= 31) return m[0].slice(0, 10);
  }
  return null;
}

/** The notes on each day of `month` (YYYY-MM), by day, and how many have no day at all. */
export function calendarDays<T extends ViewRow>(rows: T[], key: string, month: string): { days: Map<string, T[]>; undated: number } {
  const days = new Map<string, T[]>();
  let undated = 0;
  for (const r of rows) {
    const day = dayOf(r, key);
    if (!day) undated++;
    else if (day.startsWith(`${month}-`)) days.set(day, [...(days.get(day) ?? []), r]);
  }
  return { days, undated };
}
