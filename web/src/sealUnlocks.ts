// Which seals you've earned in this browser. Firsts you do here (a link, a backlink followed, a
// template, a board) earn theirs as you do them; the rest are counted from the API the app already
// has, at start and as notes change, and only while a seal they'd earn is still grey. A toast says
// when one is earned. Earned seals are kept per browser, like inks (inkUnlocks.ts).
// In a workspace that isn't gamified (gamify.ts) there are no seals: nothing is counted, earned or said.
import { api } from "./api.ts";
import { didEvents, firstEvents, onVaultChange, type First } from "./events.ts";
import { store } from "./store.ts";
import { toast } from "./toast.ts";
import { gamified, onGamified } from "./gamify.ts";
import { agentHandles, agentTaskCount, earnedSeals, isSeal, keptAgentEdits, NO_STATS, sealToast, SEAL_IDS, type SealId, type SealStats } from "./seals.ts";

const stats: SealStats = { ...NO_STATS };
const kept = (): SealId[] | null => {
  const ids = store.get<unknown>("seals", null);
  return Array.isArray(ids) ? ids.filter(isSeal) : null;
};
let earned = kept();
let ready = false;
let hooks = { online: () => false, openToday() {} };
const listeners = new Set<() => void>();

const has = (id: SealId) => !!earned?.includes(id);

/** What the Today page shows: the seals there are here, those earned, and the counts toward the rest. */
export const sealState = () => ({ online: hooks.online(), earned: SEAL_IDS.filter(has), stats: ready ? stats : null });

/** Call `fn` when a seal is earned or the counts change. Returns a function that stops listening. */
export function onSeals(fn: () => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/** A first you just did in this tab. */
function sealFirst(what: First | "linked") {
  if (!gamified()) return;
  stats[what] = true;
  award();
}

/** Start counting. `online` says whether sharing is here; `openToday` is the toast's button. */
export function startSeals(h: typeof hooks) {
  hooks = h;
  didEvents.addEventListener("link", () => sealFirst("linked"));
  for (const what of ["followedBacklink", "usedTemplate", "madeBoard"] as const) firstEvents.addEventListener(what, () => sealFirst(what));
  onVaultChange(() => void count(), 2000);
  onGamified((on) => (on && void count(), notify()));
  void count();
}

const notify = () => listeners.forEach((fn) => fn());

let counting = false;
let again = false;
async function count(): Promise<void> {
  if (counting) return void (again = true);
  const grey = (id: SealId) => !has(id);
  if (!gamified() || !SEAL_IDS.some(grey)) return;
  counting = true;
  try {
    await Promise.allSettled([
      grey("link") && !ready ? api.guide().then((g) => void (stats.linked ||= !!g?.done.includes("link"))) : null,
      grey("smart-folder") ? api.smartFolders().then((f) => void (stats.smartFolders = f.length)) : null,
      grey("shared") && hooks.online() ? api.shares().then((s) => void (stats.shares = s.shares.length)) : null,
      grey("agent-task")
        ? Promise.all([api.changeAgents().catch(() => [] as string[]), api.tasks({})]).then(([names, tasks]) => void (stats.agentTasks = agentTaskCount(tasks, agentHandles(names))))
        : null,
      grey("agent-edit") || grey("agent-ten") ? api.history({ limit: 500 }).then((c) => void (stats.agentEdits = keptAgentEdits(c))) : null,
    ]);
    ready = true;
    award();
    notify();
  } finally {
    counting = false;
  }
  if (again) {
    again = false;
    return count();
  }
}

/** Keep any newly earned seals, and say so. The first count earns what you'd already done in one toast. */
function award() {
  if (!gamified()) return;
  earned = kept() ?? earned; // another tab may have earned (and announced) some already
  const fresh = earnedSeals(stats).filter((id) => !has(id));
  if (!fresh.length) return;
  earned = SEAL_IDS.filter((id) => has(id) || fresh.includes(id));
  store.set("seals", earned);
  notify();
  const said = sealToast(fresh);
  if (said) toast({ ...said, icon: "spark", actionLabel: "See seals", action: () => hooks.openToday() });
}
