// "Your writing days": a 12-week heatmap of the days you wrote, under the Today page's week card
// (weekRecapCard.ts). It counts your own notes made and edited (not an agent's work for you, nor
// moves and archiving), from the change log the History page reads; the date math is in writingDays.ts.
import { api, type Change } from "./api.ts";
import { el, isSelf } from "./dom.ts";
import { today } from "./taskChips.ts";
import { countByDay, daysText, heatmapWeeks, level, WEEKS } from "./writingDays.ts";

/** What counts, said once wherever the streak shows. */
export const COUNTS = "Days you created or edited a note yourself. Agent edits, moves and archiving don't count.";

/** Whether the streak shows at all: off when a workspace owner turns the app's rewards off (gamify.ts). */
export { gamified } from "./gamify.ts";

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

/** How many changes you made each day of the heatmap's weeks. */
export async function writingDays(): Promise<Map<string, number>> {
  await refresh();
  return countByDay([...mine.values()].map((c) => c.ts));
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
