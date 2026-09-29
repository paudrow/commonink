// Plain-text renderings of core results, shared by the MCP server and the CLI.
// Agents read markdown far more cheaply than JSON, so this is the default output.
import { isTagFavorite, type Backlink, type Change, type Favorite, type Note, type NoteMeta, type SearchHit, type TagCount, type Task, type TodayView } from "./quire.ts";

export function fmtSearch(q: string, hits: SearchHit[]): string {
  if (!hits.length) return `No notes match "${q}".`;
  return hits
    .map((h) => {
      const lines = h.lines.map((l) => `    L${l.line}: ${l.text}`).join("\n");
      return `- ${h.path} — ${h.title}${lines ? `\n${lines}` : ""}`;
    })
    .join("\n");
}

export function fmtRead(n: Note, offset = 1, limit?: number): string {
  const all = n.content.split("\n");
  const start = Math.max(1, offset);
  const end = limit ? Math.min(all.length, start + limit - 1) : all.length;
  const width = String(end).length;
  const body = all
    .slice(start - 1, end)
    .map((l, i) => `${String(start + i).padStart(width)}│${l}`)
    .join("\n");
  const range = start > 1 || end < all.length ? ` (lines ${start}-${end} of ${all.length})` : "";
  return `path: ${n.path}\nversion: ${n.version}${range}\n\n${body}`;
}

export function fmtList(notes: NoteMeta[]): string {
  if (!notes.length) return "No notes.";
  return notes.map((n) => `- ${n.path}${n.kind === "asset" ? "" : ` — ${n.title}`}`).join("\n");
}

export function fmtFavorites(favorites: Favorite[]): string {
  if (!favorites.length) return "No favorites.";
  const line = (f: Favorite) => (isTagFavorite(f) ? `- #${f.display} (${f.notes} note${f.notes === 1 ? "" : "s"})` : fmtList([f]));
  return `Favorites:\n${favorites.map(line).join("\n")}`;
}

/** Tasks as their markdown lines (tokens and all), each with where it lives. */
export function fmtTasks(tasks: Task[]): string {
  if (!tasks.length) return "No tasks match.";
  return tasks.map((t) => `- [${t.done ? "x" : " "}] ${t.text} — ${t.path}:${t.line}`).join("\n");
}

/** The tag tree, children under their parents, with what carries each (counting tags under it). */
export function fmtTags(tags: TagCount[]): string {
  if (!tags.length) return "No tags yet.";
  const n = (count: number, what: string) => (count ? `${count} ${what}${count === 1 ? "" : "s"}` : "");
  return tags
    .map((t) => {
      const uses = [n(t.notes, "note"), n(t.tasks, "task"), n(t.assets, "asset")].filter(Boolean).join(", ");
      return `${"  ".repeat(t.tag.split("/").length - 1)}- #${t.display} (${uses})`;
    })
    .join("\n");
}

export function fmtBacklinks(target: string, links: Backlink[]): string {
  if (!links.length) return `Nothing links to ${target}.`;
  return links.map((b) => `- ${b.path}:${b.line} (${b.kind}) ${b.text}`).join("\n");
}

/**
 * Collapse runs of edits by the same source to the same note (autosaves) into one entry.
 * `first` is the id of the run's earliest change (`id` is its latest).
 */
export function groupChanges(changes: Change[], windowMs = 10 * 60_000): Array<Change & { count: number; first: number }> {
  const out: Array<Change & { count: number; first: number }> = [];
  for (const c of changes) {
    const prev = out[out.length - 1];
    const stat = (s: string | null) => s?.match(/^\+(\d+) −(\d+)$/)?.slice(1).map(Number);
    const a = stat(prev?.summary ?? null);
    const b = stat(c.summary);
    if (prev && c.op === "edit" && prev.op === "edit" && prev.path === c.path && prev.source === c.source && a && b && prev.ts - c.ts < windowMs) {
      prev.summary = `+${a[0] + b[0]} −${a[1] + b[1]}`;
      prev.count++;
      prev.first = c.id;
    } else out.push({ ...c, count: 1, first: c.id });
  }
  return out;
}

export function fmtChanges(changes: Change[]): string {
  if (!changes.length) return "No changes.";
  return groupChanges(changes)
    .map((c) => {
      const when = new Date(c.ts).toISOString().replace(/\.\d+Z$/, "Z");
      const moved = c.op === "move" || c.op === "archive" || c.op === "unarchive";
      const what = moved ? `${c.op === "move" ? "moved" : `${c.op}d`} ${c.from_path} → ${c.path}` : `${c.op} ${c.path}`;
      const saves = c.count > 1 ? `, ${c.count} saves` : "";
      return `#${c.id} ${when} ${c.source}: ${what}${c.summary && !moved ? ` (${c.summary}${saves})` : ""}`;
    })
    .join("\n");
}

export function fmtWrite(r: { path: string; version: string; change?: Change | null }, verb: string): string {
  return `${verb} ${r.path} → version ${r.version}${r.change?.summary ? ` (${r.change.summary})` : ""}`;
}

/** The Today view as text: a heading for the day, each section's tasks, and the journal note. */
export function fmtToday(t: TodayView): string {
  const day = new Date(`${t.date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
  const sections = t.sections.map((s) => `${s.title} (${s.tasks.length})\n${s.tasks.length ? fmtTasks(s.tasks) : "- nothing"}`);
  return [day, ...sections, `Journal: ${t.journal.path}${t.journal.exists ? "" : " (not written yet)"}`].join("\n\n");
}
