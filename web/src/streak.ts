// "Your writing days": a quiet chip in the sidebar's foot ("3 days") once you've written two days
// in a row, and a 12-week heatmap of the days you wrote, in its popover and in the `::streak`
// widget. It counts your own notes made and edited (not an agent's work for you, nor moves and
// archiving), from the change log the History page reads; the date math is in writingDays.ts.
import { api, type Change } from "./api.ts";
import { el, icon, isSelf, setLabel } from "./dom.ts";
import { onVaultChange } from "./events.ts";
import { today } from "./taskChips.ts";
import { countByDay, daysText, heatmapWeeks, level, streakOf, WEEKS, type Streak } from "./writingDays.ts";

const PAGE = 500;
/** At most this many pages of the log are read for the 12 weeks; a busier log shows its latest. */
const MAX_PAGES = 8;

/** Your changes in the window, by change id: when each was. */
const mine = new Map<number, number>();
let loadedOnce = false;
let loading: Promise<Map<string, number>> | null = null;

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
    for (const c of got) if (c.ts >= from && yours(c)) mine.set(c.id, c.ts);
    const last = got.at(-1);
    if (!last || got.length < PAGE || last.ts < from) return;
    before = last.id;
  }
}

/**
 * How many changes you made each day of the heatmap's weeks. The first call reads them all; later
 * ones read back only to the start of today, since earlier days are done (a growing sitting's
 * change moves to a new id, so today's are read again rather than added to).
 */
export function writingDays(): Promise<Map<string, number>> {
  loading ??= (async () => {
    try {
      const day = today();
      if (loadedOnce) {
        const from = midnight(day);
        for (const [id, ts] of mine) if (ts >= from) mine.delete(id);
        await readBack(from);
      } else {
        await readBack(midnight(heatmapWeeks(day)[0][0]!));
        loadedOnce = true;
      }
      return countByDay([...mine.values()]);
    } finally {
      loading = null;
    }
  })();
  return loading;
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

/** The heatmap with the streaks under it: now, and the longest in these weeks. */
export function writingSummary(days: Map<string, number>): HTMLElement {
  const day = today();
  const s = streakOf(days, day);
  return el(
    "div",
    { class: "wd" },
    heatmap(days, day),
    el(
      "div",
      { class: "wd-stats" },
      el("span", { class: "wd-now" }, streakText(s)),
      s.longest ? el("span", { class: "wd-best" }, `Longest: ${daysText(s.longest)}`) : null,
    ),
  );
}

let popover: { box: HTMLElement; close(refocus: boolean): void } | null = null;

/** The chip's popover: the heatmap and streaks, over the chip. Esc, a click outside or tabbing away closes it. */
function togglePopover(chip: HTMLElement, days: Map<string, number>) {
  if (popover) return popover.close(true);
  const box = el(
    "div",
    { class: "wd-popover", role: "dialog", "aria-label": "Your writing days", tabindex: "-1" },
    el("div", { class: "wd-title" }, icon("drop", 14), "Your writing days"),
    writingSummary(days),
  );
  const outside = (e: Event) => !box.contains(e.target as Node) && !chip.contains(e.target as Node) && close(false);
  box.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === "Tab") close(true);
  });
  function close(refocus: boolean) {
    if (popover?.box !== box) return;
    popover = null;
    box.remove();
    chip.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", outside, true);
    if (refocus) chip.focus();
  }
  document.body.append(box);
  // Above the chip (it's at the bottom of the sidebar), kept on screen.
  const r = chip.getBoundingClientRect();
  box.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - box.offsetWidth - 8))}px`;
  box.style.top = `${Math.max(8, r.top - box.offsetHeight - 8)}px`;
  chip.setAttribute("aria-expanded", "true");
  document.addEventListener("pointerdown", outside, true);
  popover = { box, close };
  box.focus();
}

/**
 * The streak chip, in the sidebar's foot beside New note. It shows once you've written two days in
 * a row, and keeps up as you write (a few seconds after the last change, so typing isn't slowed).
 */
export function mountStreakChip(row: HTMLElement) {
  let days = new Map<string, number>();
  const label = el("span", {});
  const chip = el("button", { type: "button", class: "streak-chip", "aria-haspopup": "dialog", "aria-expanded": "false", hidden: true }, icon("drop", 13), label);
  chip.addEventListener("click", () => togglePopover(chip, days));
  row.append(chip);
  const load = async () => {
    days = await writingDays().catch(() => days);
    const s = streakOf(days, today());
    chip.hidden = s.current < 2;
    label.textContent = daysText(s.current);
    setLabel(chip, `Your writing days: ${streakText(s)}`);
  };
  void load();
  onVaultChange(() => void load(), 4000);
}
