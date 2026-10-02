// Plain-text renderings of core results, shared by the MCP server and the CLI.
// Agents read markdown far more cheaply than JSON, so this is the default output.
import { authorLabel } from "./actor.ts";
import { createTwoFilesPatch } from "diff";
import { isTagFavorite, type Backlink, type Change, type Favorite, type Label, type Note, type NoteMeta, type Vault, type SearchHit, type SmartFolder, type TagCount, type Task, type TodayView, type TrashItem } from "./vault.ts";
import type { Board } from "./kanban.ts";
import type { TemplateInfo } from "./templates.ts";
import type { Contact, TimelineItem } from "./contacts.ts";
import { localDate } from "./tasks.ts";

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

export function fmtList(notes: Array<Pick<NoteMeta, "path" | "kind" | "title">>): string {
  if (!notes.length) return "No notes.";
  return notes.map((n) => `- ${n.path}${n.kind === "asset" ? "" : ` — ${n.title}`}`).join("\n");
}

export function fmtFavorites(favorites: Favorite[]): string {
  if (!favorites.length) return "No favorites.";
  const line = (f: Favorite) => (isTagFavorite(f) ? `- #${f.display} (${f.notes} note${f.notes === 1 ? "" : "s"})` : fmtList([f]));
  return `Favorites:\n${favorites.map(line).join("\n")}`;
}

export function fmtSmartFolders(folders: SmartFolder[]): string {
  if (!folders.length) return "No smart folders.";
  return folders
    .map((f) => `- ${f.name} (${f.count} note${f.count === 1 ? "" : "s"}, ${f.shared ? "shared" : "just you"}): ${f.query || "every note"} [${f.id}]`)
    .join("\n");
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
      return `${"  ".repeat(t.tag.split("/").length - 1)}- #${t.display} (${uses || "added, not used yet"})`;
    })
    .join("\n");
}

/** `hidden`: how many links from archived notes were left out. */
export function fmtBacklinks(target: string, links: Backlink[], hidden = 0): string {
  const more = hidden ? `${hidden} more from archived ${hidden === 1 ? "note" : "notes"} (include_archived to see them).` : "";
  if (!links.length) return hidden ? `Nothing active links to ${target}. ${more}` : `Nothing links to ${target}.`;
  return [...links.map((b) => `- ${b.path}:${b.line} (${b.kind}) ${b.text}`), ...(more ? [more] : [])].join("\n");
}

const folderOf = (path: string) => path.slice(0, path.lastIndexOf("/") + 1);

/** A move that kept its folder is a rename. */
export const isRename = (from: string | null, to: string) => from !== null && folderOf(from) === folderOf(to);

/** What a change did, as a past-tense verb ("you renamed Groceries"). */
export function changeVerb(c: Pick<Change, "op" | "path" | "from_path">): string {
  if (c.op === "move" && isRename(c.from_path, c.path)) return "renamed";
  return { create: "created", edit: "edited", move: "moved", delete: "deleted", archive: "archived", unarchive: "unarchived", restore: "restored", purge: "deleted forever" }[c.op];
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

/**
 * Changes as History lists them: a run of saves is one line counting its net change (diffStats),
 * not the sum of each save's count, and its verb is History's ("renamed", "edited").
 */
export function fmtChanges(changes: Change[], vault: Pick<Vault, "diffStats">): string {
  if (!changes.length) return "No changes.";
  const groups = groupChanges(changes);
  const runs = groups.filter((g) => g.count > 1);
  const nets = vault.diffStats(runs.map((g) => changes.filter((c) => c.id >= g.first && c.id <= g.id).map((c) => c.id)));
  const net = new Map(runs.map((g, i) => [g, nets[i]]));
  return groups
    .map((c) => {
      const when = new Date(c.ts).toISOString().replace(/\.\d+Z$/, "Z");
      const moved = c.op === "move" || c.op === "archive" || c.op === "unarchive";
      const what = `${changeVerb(c)} ${moved ? `${c.from_path} → ` : ""}${c.path}`;
      const n = net.get(c);
      const stat = c.count === 1 ? c.summary : `${n ? `+${n.add} −${n.del}, ` : ""}${c.count} saves`;
      return `#${c.id} ${when} ${authorLabel(c)}: ${what}${stat && !moved ? ` (${stat})` : ""}`;
    })
    .join("\n");
}

/** Labels, newest first: each one's name and ID, its note, who labeled it and when. */
export function fmtLabels(labels: Label[], note?: string): string {
  if (!labels.length) return note ? `${note} has no labels yet. Label one with label_version.` : "No labels yet.";
  return labels
    .map((m) => {
      const when = new Date(m.ts).toISOString().replace(/\.\d+Z$/, "Z");
      const at = m.change_id ? `after change #${m.change_id}` : "";
      const where = m.path ?? "(in Trash)";
      return `- "${m.name}" [${m.id}] ${where}, labeled ${when} by ${authorLabel(m)}${at ? `, ${at}` : ""}${m.current ? " (the note is at this version now)" : ""}${m.description ? `\n    ${m.description}` : ""}`;
    })
    .join("\n");
}

/** What changed between two versions, as a unified diff (context of 3 lines). */
export function fmtVersionDiff(path: string, from: { label: string; text: string }, to: { label: string; text: string }): string {
  if (from.text === to.text) return `${path}: "${from.label}" and ${to.label} are the same.`;
  return createTwoFilesPatch(`${path} (${from.label})`, `${path} (${to.label})`, from.text, to.text, "", "", { context: 3 }).replace(/^=+\n/, "").trimEnd();
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

/** A note's boards, column by column: each card as its markdown line with its line number, and the lines nested under it. */
export function fmtBoards(path: string, boards: Board[], unclosed: number | null = null): string {
  const open = unclosed === null ? "" : `\n\nProblem: the :::kanban on line ${unclosed + 1} has no closing ::: line, so it shows as text.`;
  if (!boards.length) return `${path} has no board.${open}`;
  return (
    boards
      .map((b, i) => {
        const columns = b.columns.map((c) =>
          [
            `## ${c.title}${c.done ? " (done column)" : ""}${c.color ? ` {color=${c.color}}` : ""}`,
            ...c.cards.flatMap((k) => [`- ${k.checked === null ? "" : `[${k.checked ? "x" : " "}] `}${k.text} — L${k.from + 1}`, ...k.details.map((d) => (d ? `    ${d}` : ""))]),
          ].join("\n"),
        );
        const problems = b.problems.map((p) => `- ${p.message} (${p.kind}, L${p.from + 1}${p.to - p.from > 1 ? `–${p.to}` : ""})`);
        return [`Board ${i + 1} of ${boards.length} in ${path}`, ...(problems.length ? [`Problems (the lines stay as they are until fixed):\n${problems.join("\n")}`] : []), ...columns].join("\n\n");
      })
      .join("\n\n") + open
  );
}

/** What's in Trash, one line each: id, where it was, when it went and who sent it. */
export function fmtTrash(items: TrashItem[]): string {
  if (!items.length) return "Trash is empty.";
  return items
    .map((t) => `${t.id}  ${t.path} — deleted ${localDate(t.deletedAt)} ${new Date(t.deletedAt).toTimeString().slice(0, 5)}${t.by ? ` by ${authorLabel({ ...t.by })}` : ""}, gone for good ${localDate(t.expiresAt)}`)
    .join("\n");
}

/** A template on a line: its path and name, what it asks, and the folders it's the default for. */
export function fmtTemplate(t: TemplateInfo): string {
  const kind = (a: TemplateInfo["asks"][number]) => (a.type === "choice" ? ` (one of ${a.choices.join(", ")})` : a.type === "text" ? "" : ` (${a.type})`);
  const asks = t.asks.length ? ` · asks: ${t.asks.map((a) => a.label + kind(a)).join(", ")}` : "";
  const where = t.appliesTo.length ? ` · new notes in ${t.appliesTo.map((f) => `${f}/`).join(", ")} start from it` : "";
  return `${t.path} — ${t.name}${asks}${where}`;
}

/** One contact on a line: path, name, role and company, emails and tags, and when they were last mentioned. */
export function fmtContactLine(c: Contact): string {
  const tags = c.tags.map((t) => `#${t}`).join(" ");
  const seen = c.lastContacted ? `last mentioned ${c.lastContacted} (${c.mentions} note${c.mentions === 1 ? "" : "s"})` : "not mentioned yet";
  return `${c.path} — ${[c.name, [c.role, c.company].filter(Boolean).join(", "), [c.email.join(", "), tags].filter(Boolean).join(" "), seen].filter(Boolean).join(" · ")}`;
}

/** A contact's details, then the notes that mention them. */
export function fmtContact({ contact: c, timeline }: { contact: Contact; timeline: TimelineItem[] }): string {
  const fields: Array<[string, string]> = [
    ["email", c.email.join(", ")],
    ["phone", c.phone.join(", ")],
    ["company", c.company],
    ["role", c.role],
    ["links", c.links.join(", ")],
    ["aliases", c.aliases.join(", ")],
    ["tags", c.tags.map((t) => `#${t}`).join(" ")],
  ];
  const head = [`# ${c.name} (${c.path})`, ...fields.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`)];
  const seen = timeline.length ? ["Mentioned in:", ...timeline.map((t) => `- ${t.date} ${t.path}:${t.line} ${t.text}`)] : ["Not mentioned in any note yet."];
  return [...head, "", ...seen].join("\n");
}
