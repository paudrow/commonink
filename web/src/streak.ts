// "Your writing days": a heatmap of the days you wrote, as many weeks as fill its width (12 to a
// year), under the Today page's week card (weekRecapCard.ts), on your profile (profilePage.ts), and
// with how many days in a row in the `::streak` widget. It counts your own notes made
// and edited (not an agent's work for you, nor moves and archiving), from the change log the History
// page reads; the date math is in writingDays.ts. A widget can narrow it to a folder or a tag.
import { api, type Change } from "./api.ts";
import { el, isSelf } from "./dom.ts";
import { today } from "./taskChips.ts";
import { countByDay, daysText, fitWeeks, heatmapWeeks, inFolder, level, MAX_WEEKS, streakOf, thisWeek, WEEKS, type Streak } from "./writingDays.ts";

/** What counts, said once wherever the streak shows. */
export const COUNTS = "Days you created or edited a note yourself. Agent edits, moves and archiving don't count.";

/** Whether the streak shows at all: off when a workspace owner turns the app's rewards off (gamify.ts). */
export { gamified } from "./gamify.ts";

const PAGE = 500;
/** At most this many pages of the log are read for the heatmap's year; a busier log shows its latest. */
const MAX_PAGES = 12;

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
        await readBack(midnight(heatmapWeeks(day, MAX_WEEKS)[0][0]!));
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

/** How many changes you made each day of the widest heatmap's weeks, to the notes `filter` names (every note by default). */
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

let lastFit: { weeks: number; cell: number } | null = null;

/**
 * A GitHub-style grid of the weeks up to today: a square per day, darker the more you wrote, today
 * outlined. It fills its width: as many weeks as fit (12 to a year, see fitWeeks), redrawn as it's
 * resized. Where nothing can measure it (tests), it's 12 weeks of 12px squares.
 */
export function heatmap(days: Map<string, number>, day = today()): HTMLElement {
  const map = el("div", { class: "wd-map", role: "img" });
  const draw = (count: number) => {
    const weeks = heatmapWeeks(day, count);
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
    map.setAttribute("aria-label", `You wrote on ${daysText(wrote)} of the last ${count} weeks`);
    map.replaceChildren(
      el("span", { class: "wd-corner" }),
      el("div", { class: "wd-months", "aria-hidden": "true" }, ...months),
      el("div", { class: "wd-weekdays", "aria-hidden": "true" }, ...["Mon", "", "Wed", "", "Fri", "", ""].map((t) => el("span", {}, t))),
      el("div", { class: "wd-grid", "aria-hidden": "true" }, ...cells),
    );
  };
  // Drawn first as the last one fitted, so a redrawn card doesn't jump from 12 weeks to its width.
  let drawn = lastFit?.weeks ?? WEEKS;
  if (lastFit) map.style.setProperty("--cell", `${lastFit.cell}px`);
  draw(drawn);
  if (typeof ResizeObserver === "undefined") return map;
  let width = 0;
  const fit = new ResizeObserver(() => {
    if (!map.isConnected) {
      if (width) fit.disconnect(); // gone with its card
      return;
    }
    if (map.clientWidth === width) return; // only its height changed: the squares did that
    width = map.clientWidth;
    requestAnimationFrame(refit); // after this round of resizing, so sizing the squares doesn't start another
  });
  const refit = () => {
    const labels = map.querySelector(".wd-weekdays")?.getBoundingClientRect().width ?? 0;
    const room = map.clientWidth - labels - parseFloat(getComputedStyle(map).columnGap || "0");
    if (room <= 0) return; // hidden
    const { weeks, cell } = (lastFit = fitWeeks(room));
    map.style.setProperty("--cell", `${cell}px`);
    if (weeks !== drawn) draw((drawn = weeks));
  };
  fit.observe(map);
  return map;
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
