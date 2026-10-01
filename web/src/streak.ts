// "Your writing days": a 12-week heatmap of the days you wrote, with how many days in a row, on the
// Today page (its Writing streak section) and in the `::streak` widget. It counts your own notes made
// and edited (not an agent's work for you, nor moves and archiving), from the change log the History
// page reads; the date math is in writingDays.ts. A widget can narrow it to a folder or a tag.
import { api, type Change } from "./api.ts";
import { el, isSelf } from "./dom.ts";
import { today } from "./taskChips.ts";
import { countByDay, daysText, heatmapWeeks, inFolder, level, streakOf, thisWeek, WEEKS, type Streak } from "./writingDays.ts";

/** What counts, said once wherever the streak shows. */
export const COUNTS = "Days you created or edited a note yourself. Agent edits, moves and archiving don't count.";

/**
 * Whether the streak shows at all. A workspace owner will be able to turn the app's rewards off
 * (PR #180's "Unlock as you go" switch, web/src/gamify.ts there); once that's in, this becomes its
 * `gamified()`. Until then the streak always shows.
 */
export const gamified = () => true;

const PAGE = 500;
/** At most this many pages of the log are read for the 12 weeks; a busier log shows its latest. */
const MAX_PAGES = 8;

/** Your changes in the window, by change id: when each was, and to which note. */
const mine = new Map<number, { ts: number; path: string; note: string | null }>();
let loadedOnce = false;
let loading: Promise<void> | null = null;

const yours = (c: Change) => !c.agent && (c.op === "create" || c.op === "edit") && isSelf(c.person ?? c.source);
const midnight = (day: string) => new Date(`${day}T00:00:00`).getTime(); // local midnight

/**
 * Pages of the change log, newest first, until one reaches back before `from` (or MAX_PAGES): your
 * changes in them go in `mine`. People's changes only: the server leaves agents' out.
 */
async function readBack(from: number) {
  let before: number | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const got = await api.history({ limit: PAGE, before, by: "people" });
    for (const c of got) if (c.ts >= from && yours(c)) mine.set(c.id, { ts: c.ts, path: c.path, note: c.note_id });
    const last = got.at(-1);
    if (!last || got.length < PAGE || last.ts < from) return;
    before = last.id;
  }
}

/**
 * Your changes in the heatmap's weeks. The first call reads them all; later ones read back only to
 * the start of today, since earlier days are done (a growing sitting's change moves to a new id, so
 * today's are read again rather than added to).
 */
function refresh(): Promise<void> {
  loading ??= (async () => {
    try {
      const day = today();
      if (loadedOnce) {
        const from = midnight(day);
        for (const [id, c] of mine) if (c.ts >= from) mine.delete(id);
        await readBack(from);
      } else {
        await readBack(midnight(heatmapWeeks(day)[0][0]!));
        loadedOnce = true;
      }
    } finally {
      loading = null;
    }
  })();
  return loading;
}

export interface StreakFilter {
  /** Only notes in this folder (or under it). */
  folder?: string;
  /** Only notes with this tag (or a tag under it), as they are now. */
  tag?: string;
}

/** How many changes you made each day of the heatmap's weeks, to the notes `filter` names (every note by default). */
export async function writingDays(filter: StreakFilter = {}): Promise<Map<string, number>> {
  // Which notes carry the tag now, by ID and by path (a change from before IDs has only its path).
  const tagged = filter.tag
    ? api.feed({ tag: filter.tag, scope: "all", limit: 5000 }).then((p) => new Set(p.items.flatMap((i) => [i.id, i.path])))
    : null;
  const [, notes] = await Promise.all([refresh(), tagged]);
  const counted = [...mine.values()].filter((c) => (!filter.folder || inFolder(c.path, filter.folder)) && (!notes || notes.has(c.note ?? "") || notes.has(c.path)));
  return countByDay(counted.map((c) => c.ts));
}

/** "3 days in a row", and what to do next: write today to keep it going. */
export function streakText(s: Streak): string {
  if (!s.current) return "No streak yet. Write today to start one.";
  return `${daysText(s.current)} in a row.${s.wroteToday ? "" : " Write today to keep it going."}`;
}

/** A GitHub-style grid of the last 12 weeks: a square per day, darker the more you wrote, today outlined. */
export function heatmap(days: Map<string, number>, day = today()): HTMLElement {
  const weeks = heatmapWeeks(day);
  const month = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: "short" });
  const long = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const wrote = weeks.flat().filter((d) => d && days.get(d)).length;
  // A month's name over the week its 1st falls in, and over the first week unless the next has a 1st.
  const firstOf = (w: Array<string | null>) => w.find((d) => d?.endsWith("-01"));
  const months = weeks.map((w, i) => {
    const show = firstOf(w) ?? (i === 0 && !firstOf(weeks[1] ?? []) ? w[0] : null);
    return el("span", { class: "wd-month" }, show ? month(show) : "");
  });
  const cells = weeks.flatMap((w) =>
    w.map((d) => {
      if (!d) return el("span", { class: "wd-day is-future" });
      const n = days.get(d) ?? 0;
      return el("span", { class: `wd-day l${level(n)}${d === day ? " is-today" : ""}`, title: `${long(d)}: ${n ? `${n} ${n === 1 ? "change" : "changes"}` : "nothing written"}` });
    }),
  );
  return el(
    "div",
    { class: "wd-map", role: "img", "aria-label": `You wrote on ${daysText(wrote)} of the last ${WEEKS} weeks` },
    el("span", { class: "wd-corner" }),
    el("div", { class: "wd-months", "aria-hidden": "true" }, ...months),
    el("div", { class: "wd-weekdays", "aria-hidden": "true" }, ...["Mon", "", "Wed", "", "Fri", "", ""].map((t) => el("span", {}, t))),
    el("div", { class: "wd-grid", "aria-hidden": "true" }, ...cells),
  );
}

/** The heatmap with the streaks under it: now, this week, and the longest in these weeks. */
export function writingSummary(days: Map<string, number>): HTMLElement {
  const day = today();
  const s = streakOf(days, day);
  const week = thisWeek(days, day);
  return el(
    "div",
    { class: "wd" },
    heatmap(days, day),
    el(
      "div",
      { class: "wd-stats" },
      el("span", { class: "wd-now" }, streakText(s)),
      el("span", { class: "wd-best" }, `${daysText(week)} this week`),
      s.longest ? el("span", { class: "wd-best" }, `Longest: ${daysText(s.longest)}`) : null,
    ),
  );
}
