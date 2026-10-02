// Seals: a small wax mark for the first time you do each thing worth knowing, from your first link
// between notes to your tenth edit kept from an agent. They're the long-term part of the Today page
// (the day is its ring, the week its recap): earned seals in ink, the rest greyed with a line on how,
// so each grey seal points at a feature. This is the rules and the counting, with nothing to fetch or
// draw, so it can be tested; sealUnlocks.ts gathers the numbers and says when one is earned.
import { GUIDE } from "../../src/core/guide.ts";
import { formatKeys } from "./keys.ts";

export const SEAL_IDS = ["link", "backlink", "template", "board", "smart-folder", "shared", "agent-task", "agent-edit", "agent-ten"] as const;
export type SealId = (typeof SEAL_IDS)[number];

/** What the seals are counted from. A null is a number not fetched (yet). */
export interface SealStats {
  /** You linked one note to another ([[ in the editor, or the guide's "link" box is ticked). */
  linked: boolean | null;
  /** You followed a backlink, from the list of notes that link to the one you're in. */
  followedBacklink: boolean | null;
  /** You made a note from a template. */
  usedTemplate: boolean | null;
  /** You made a kanban board (New board, or the board in the / menu). */
  madeBoard: boolean | null;
  /** Smart folders saved in the workspace. */
  smartFolders: number | null;
  /** Notes and folders shared outside the workspace (online). */
  shares: number | null;
  /** Tasks assigned to an agent (`@Claude`). */
  agentTasks: number | null;
  /** Agents' edits to notes that weren't taken back with Restore. */
  agentEdits: number | null;
}

export const NO_STATS: SealStats = { linked: null, followedBacklink: null, usedTemplate: null, madeBoard: null, smartFolders: null, shares: null, agentTasks: null, agentEdits: null };

export interface Seal {
  id: SealId;
  name: string;
  /** The icon pressed into it (dom.ts). */
  icon: string;
  /** How to earn it, as its grey seal says. */
  how: string;
  /** The toast's second line once it's earned. */
  earned: string;
  /** Only where sharing is (online). */
  online?: boolean;
  progress(s: SealStats): { have: number; need: number } | null;
}

const yes = (b: boolean | null) => (b === null ? null : { have: b ? 1 : 0, need: 1 });
const count = (n: number | null, need: number) => (n === null ? null : { have: Math.min(n, need), need });

export const SEALS: Seal[] = [
  { id: "link", name: "First link", icon: "link", how: "Link one note to another: type [[ and pick it.", earned: "You linked two notes.", progress: (s) => yes(s.linked) },
  { id: "backlink", name: "First backlink", icon: "back", how: "Follow a backlink: the notes that link here are listed under a note.", earned: "You followed a link back.", progress: (s) => yes(s.followedBacklink) },
  { id: "template", name: "First template", icon: "file", how: `Make a note from a template: New note from template in ${formatKeys("Mod-Shift-p")}.`, earned: "You made a note from a template.", progress: (s) => yes(s.usedTemplate) },
  { id: "board", name: "First board", icon: "kanban", how: `Make a kanban board: New board in ${formatKeys("Mod-Shift-p")}, or / → Kanban board.`, earned: "You made a kanban board.", progress: (s) => yes(s.madeBoard) },
  { id: "smart-folder", name: "First smart folder", icon: "folder", how: "Save a search as a smart folder from the Notes page.", earned: "You saved a smart folder.", progress: (s) => count(s.smartFolders, 1) },
  { id: "shared", name: "First share", icon: "share", how: "Share a note with someone outside the workspace.", earned: "You shared a note.", online: true, progress: (s) => count(s.shares, 1) },
  { id: "agent-task", name: "First handoff", icon: "bot", how: "Hand a task to an agent: put @Claude (or your agent's name) on it.", earned: "You handed a task to an agent.", progress: (s) => count(s.agentTasks, 1) },
  { id: "agent-edit", name: "First agent edit", icon: "edit", how: "Connect an agent and keep an edit it makes to a note.", earned: "You kept an agent's edit.", progress: (s) => count(s.agentEdits, 1) },
  { id: "agent-ten", name: "Ten agent edits", icon: "spark", how: "Keep 10 edits from agents.", earned: "You've kept 10 edits from agents.", progress: (s) => count(s.agentEdits, 10) },
];

export const sealById = (id: string): Seal | undefined => SEALS.find((s) => s.id === id);
export const isSeal = (id: unknown): id is SealId => typeof id === "string" && !!sealById(id);

/** The seals there are here: sharing's only online. */
export const sealsFor = (online: boolean): Seal[] => SEALS.filter((s) => online || !s.online);

/** The seals `stats` earn. */
export function earnedSeals(s: SealStats): SealId[] {
  return SEALS.filter((seal) => {
    const p = seal.progress(s);
    return p !== null && p.have >= p.need;
  }).map((x) => x.id);
}

/** "3 of 10" while a count is under way; nothing for a first, an earned seal, or one not counted. */
export function sealProgress(seal: Seal, s: SealStats | null): string | null {
  const p = s && seal.progress(s);
  return p && p.need > 1 && p.have < p.need ? `${p.have} of ${p.need}` : null;
}

/**
 * Agents' edits you kept, from a page of the change log (newest first): an agent's create or edit
 * (not the guide's), unless the note was restored after it, which is how an edit is taken back.
 */
export function keptAgentEdits(changes: Array<{ ts: number; path: string; op: string; agent: string | null }>): number {
  const restored = new Map<string, number>(); // path → its latest restore
  for (const c of changes) if (c.op === "restore") restored.set(c.path, Math.max(restored.get(c.path) ?? 0, c.ts));
  return changes.filter((c) => c.agent && c.agent !== GUIDE && (c.op === "edit" || c.op === "create") && !((restored.get(c.path) ?? 0) > c.ts)).length;
}

/** Handles that read as an agent: "agent", "claude", and each agent's name in the change log ("Claude Code" → claude-code or claude). */
export function agentHandles(names: string[]): Set<string> {
  const out = new Set(["agent", "claude"]);
  for (const n of names) {
    if (n === GUIDE) continue;
    const words = n.toLowerCase().trim().split(/\s+/).filter(Boolean);
    if (!words.length) continue;
    out.add(words.join("-"));
    out.add(words[0]);
  }
  return out;
}

/** Tasks with an agent among their assignees. */
export function agentTaskCount(tasks: Array<{ meta: { assignees: string[] } }>, handles: Set<string>): number {
  return tasks.filter((t) => t.meta.assignees.some((a) => handles.has(a.replace(/^@/, "").toLowerCase()))).length;
}

/** What to say about seals earned since the last look: one gets its own toast, several share one. */
export function sealToast(ids: SealId[]): { text: string; detail: string } | null {
  const seals = ids.map(sealById).filter((s): s is Seal => !!s);
  if (!seals.length) return null;
  if (seals.length === 1) return { text: `New seal: ${seals[0].name}`, detail: seals[0].earned };
  const names = seals.map((s) => s.name);
  return { text: `New seals: ${names.slice(0, -1).join(", ")} and ${names.at(-1)}`, detail: "They're on the Today page." };
}
