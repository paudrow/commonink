// Inks: the app's accent color, which you pick in Settings → Appearance. Indigo is yours from the
// start, and the others are earned by using the app: finishing Getting started, writing notes,
// ticking tasks, having an agent edit a note, coming back to write on different days. This is the
// rules and the counting, with nothing to fetch or draw, so it can be tested; inkUnlocks.ts gathers
// the numbers and says when one is earned, and styles.css has each ink's colors.
import { localDate } from "../../src/core/tasks.ts";

export const INK_IDS = ["indigo", "sepia", "viridian", "vermilion", "cobalt", "iron-gall"] as const;
export type InkId = (typeof INK_IDS)[number];
export const DEFAULT_INK: InkId = "indigo";

/** What the milestones are counted from. A null is a number not fetched (yet): its ink shows no progress. */
export interface InkStats {
  /** The Getting started checklist has its closing line. */
  guideFinished: boolean | null;
  /** Notes in the workspace (markdown and HTML, not assets). */
  notes: number | null;
  /** Ticked tasks in the workspace's notes. */
  ticked: number | null;
  /** An agent other than the guide has a change in the change log. */
  agentEdited: boolean | null;
  /** Different days (in this browser's time zone) you've changed notes on yourself. */
  days: number | null;
}

export interface Ink {
  id: InkId;
  name: string;
  /** How to earn it, as its locked swatch says ("Tick 25 tasks"); null for the one you start with. */
  goal: string | null;
  /** The toast's second line once it's earned ("You ticked 25 tasks."). */
  earned: string | null;
  /** Where you are toward it, and where it unlocks. */
  progress(s: InkStats): { have: number; need: number } | null;
}

const yes = (b: boolean | null) => (b === null ? null : { have: b ? 1 : 0, need: 1 });
const count = (n: number | null, need: number) => (n === null ? null : { have: Math.min(n, need), need });

export const INKS: Ink[] = [
  { id: "indigo", name: "Indigo", goal: null, earned: null, progress: () => ({ have: 1, need: 1 }) },
  { id: "sepia", name: "Sepia", goal: "Finish Getting started", earned: "You finished Getting started.", progress: (s) => yes(s.guideFinished) },
  { id: "viridian", name: "Viridian", goal: "Have 10 notes", earned: "You have 10 notes.", progress: (s) => count(s.notes, 10) },
  { id: "vermilion", name: "Vermilion", goal: "Tick 25 tasks", earned: "You ticked 25 tasks.", progress: (s) => count(s.ticked, 25) },
  { id: "cobalt", name: "Cobalt", goal: "Have an agent edit a note", earned: "An agent edited a note.", progress: (s) => yes(s.agentEdited) },
  { id: "iron-gall", name: "Iron gall", goal: "Write on 7 different days", earned: "You wrote on 7 different days.", progress: (s) => count(s.days, 7) },
];

export const inkById = (id: string): Ink | undefined => INKS.find((i) => i.id === id);
export const isInk = (id: unknown): id is InkId => typeof id === "string" && !!inkById(id);

/** The browser tab's icon in an ink's color: the logo, a white drop on a rounded square of it. */
export const faviconSvg = (color: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="24" fill="${color}"/><path d="M50 14.5C50 14.5 25 43.5 25 60.5a25 25 0 0 0 50 0C75 43.5 50 14.5 50 14.5Z" fill="#fff"/><path d="M37 60.5a13 13 0 0 0 9 12" stroke="${color}" stroke-width="5" stroke-linecap="round" fill="none"/></svg>`;

/** The inks `stats` earn, Indigo always among them. */
export function earnedInks(s: InkStats): InkId[] {
  return INKS.filter((ink) => {
    const p = ink.progress(s);
    return p !== null && p.have >= p.need;
  }).map((i) => i.id);
}

/** "12 of 25" while a count is under way; nothing for a yes-or-no milestone, an earned one, or one not counted. */
export function progressText(ink: Ink, s: InkStats | null): string | null {
  const p = s && ink.progress(s);
  return p && p.need > 1 && p.have < p.need ? `${p.have} of ${p.need}` : null;
}

/** How many different local days these changes were made on, counting up to `cap`. */
export function distinctDays(changes: Array<{ ts: number }>, timeZone?: string, cap = Infinity): number {
  const days = new Set<string>();
  for (const c of changes) {
    days.add(localDate(c.ts, timeZone));
    if (days.size >= cap) break;
  }
  return days.size;
}

/**
 * What to say about inks earned since the last look. One ink gets its own toast; several at once
 * (what you'd already done when inks first came, say) get one toast that names them all.
 */
export function unlockToast(ids: InkId[]): { text: string; detail: string } | null {
  const inks = ids.map(inkById).filter((i): i is Ink => !!i && i.earned !== null);
  if (!inks.length) return null;
  if (inks.length === 1) return { text: `New ink: ${inks[0].name}`, detail: inks[0].earned! };
  const names = inks.map((i) => i.name);
  return { text: `New inks: ${names.slice(0, -1).join(", ")} and ${names.at(-1)}`, detail: "Pick one in Settings → Appearance." };
}
