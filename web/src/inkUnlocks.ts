// Which inks you've earned in this browser, and the one you're using. At start and after you do
// things (a note changes, you tick a task), it counts what the locked inks need from the API the
// app already has, and a toast says when one is earned, with a button to use it. Only the locked
// inks are counted, so once every ink is yours it stops asking. Earned inks are kept per browser.
// In a workspace that isn't gamified (gamify.ts) every ink is yours, and nothing is counted or said.
import { api } from "./api.ts";
import { didEvents, onVaultChange } from "./events.ts";
import { isSelf } from "./dom.ts";
import { store } from "./store.ts";
import { toast } from "./toast.ts";
import { watchGuide } from "./onboarding.ts";
import { gamified, onGamified } from "./gamify.ts";
import { GUIDE } from "../../src/core/guide.ts";
import { localDate } from "../../src/core/tasks.ts";
import { DEFAULT_INK, distinctDays, earnedInks, INK_IDS, isInk, unlockToast, type InkId, type InkStats } from "./inks.ts";

/** Iron gall's goal, and how far back the change log is read for it (pages of 500 of your changes). */
const DAYS = 7;
const PAGES = 6;

const stats: InkStats = { guideFinished: null, notes: null, ticked: null, agentEdited: null, days: null };
/** The inks earned in this browser; null until the first count, which earns what you'd already done in one toast. */
const kept = (): InkId[] | null => {
  const ids = store.get<unknown>("inks", null);
  return Array.isArray(ids) ? ids.filter(isInk) : null;
};
let earned = kept();
/** The day Iron gall last found you'd written on, so it isn't counted again until tomorrow. */
let countedDay: string | null = null;
let ready = false;
let hooks = { choose() {} };

const owned = (): InkId[] => (!gamified() ? [...INK_IDS] : (earned ?? [DEFAULT_INK]));
const locked = (id: InkId) => !owned().includes(id);

/** The ink in use, as index.html applied it before the page drew. */
export function currentInk(): InkId {
  const id = document.documentElement.dataset.ink;
  return isInk(id) ? id : DEFAULT_INK;
}

/** Use an ink in this browser; index.html reads it back on the next load so the page draws in it. */
export function setInk(id: InkId) {
  try {
    if (id === DEFAULT_INK) localStorage.removeItem("commonink.ink");
    else localStorage.setItem("commonink.ink", id);
  } catch {}
  if (id === DEFAULT_INK) delete document.documentElement.dataset.ink;
  else document.documentElement.dataset.ink = id;
}

/** What Settings shows: the ink in use, those earned, and the counts toward the rest. */
export const inkState = () => ({ current: currentInk(), earned: INK_IDS.filter((id) => owned().includes(id)), stats: ready ? stats : null });

/** Start counting. `choose` opens Settings at the Ink setting, for the toast that names several. */
export function startInks(h: typeof hooks) {
  hooks = h;
  let timer = 0;
  onVaultChange(() => void count(), 1500);
  didEvents.addEventListener("tick", () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => void count(), 1500);
  });
  onGamified((on) => on && void count()); // back on: what you've done since earns its inks
  watchGuide((s) => {
    if (!s) return; // gone (archived, say): what it last said stands
    stats.guideFinished = s.finished;
    if (ready && gamified()) award();
  });
  void count();
}

let counting = false;
/** Something changed while counting: count again after. */
let again = false;
async function count(): Promise<void> {
  if (counting) return void (again = true);
  if (!gamified() || !INK_IDS.some(locked)) return;
  counting = true;
  try {
    await Promise.allSettled([
      locked("sepia") && !ready ? api.guide().then((g) => void (stats.guideFinished ??= !!g?.finished)) : null,
      locked("viridian") ? api.notes().then((n) => void (stats.notes = n.filter((x) => x.kind !== "asset").length)) : null,
      locked("vermilion") ? api.tasks({}).then((t) => void (stats.ticked = t.filter((x) => x.done).length)) : null,
      locked("cobalt") ? api.changeAgents().then((a) => void (stats.agentEdited = a.some((x) => x !== GUIDE))) : null,
      locked("iron-gall") && countedDay !== localDate(Date.now()) ? countDays() : null,
    ]);
    ready = true;
    award();
  } finally {
    counting = false;
  }
  if (again) {
    again = false;
    return count();
  }
}

/** Your own changes (not your agents'), page by page back through the change log, until there are enough days. */
async function countDays() {
  const mine: Array<{ ts: number }> = [];
  let before: number | undefined;
  for (let page = 0; page < PAGES; page++) {
    const changes = await api.history({ by: "people", limit: 500, before });
    mine.push(...changes.filter((c) => isSelf(c.source)));
    if (distinctDays(mine, undefined, DAYS) >= DAYS || changes.length < 500) break;
    before = changes.at(-1)!.id;
  }
  stats.days = distinctDays(mine, undefined, DAYS);
  const today = localDate(Date.now());
  if (mine.some((c) => localDate(c.ts) === today)) countedDay = today;
}

/** Keep any newly earned inks, and say so. */
function award() {
  earned = kept() ?? earned; // another tab may have earned (and announced) some already
  const now = earnedInks(stats);
  const fresh = now.filter((id) => id !== DEFAULT_INK && locked(id));
  if (!fresh.length && earned) return;
  earned = INK_IDS.filter((id) => owned().includes(id) || now.includes(id));
  store.set("inks", earned);
  const said = unlockToast(fresh);
  if (!said) return;
  const one = fresh.length === 1 ? fresh[0] : null;
  toast({ ...said, icon: "spark", actionLabel: one ? "Use it" : "Choose…", action: () => (one ? setInk(one) : hooks.choose()) });
}
