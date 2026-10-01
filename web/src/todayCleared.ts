// Clearing Today. When a box you tick in this tab (in Tasks, the ::today widget, a note's card or
// the editor) takes the last open task off Today, a small ink burst rings that box and a toast says
// today's tasks are done. It happens at most once a day in this browser, never for someone else's
// change arriving live, and with Reduce motion on there's only the toast.
import { api } from "./api.ts";
import { el } from "./dom.ts";
import { didEvents, onVaultChange } from "./events.ts";
import { store } from "./store.ts";
import { today } from "./taskChips.ts";
import { toast } from "./toast.ts";
import { cheer, openToday, shouldCelebrate } from "./todayDone.ts";

const KEY = "todayCleared";
const BOX = 'input[type="checkbox"], [role="checkbox"]';
/** How long to wait for the tick to reach the note before giving up quietly. */
const WAIT = 8000;

type Spot = { box: Element; rect: DOMRect };
/** The last box pressed, and where it was then: the editor redraws its box as it ticks. */
let pressed: (Spot & { at: number }) | null = null;

export function watchTodayCleared() {
  document.addEventListener(
    "pointerdown",
    (e) => {
      const box = e.target instanceof Element ? e.target.closest(BOX) : null;
      pressed = box ? { box, rect: box.getBoundingClientRect(), at: Date.now() } : null;
    },
    true,
  );
  didEvents.addEventListener("tick", ticked);
}

function ticked() {
  const day = today();
  if (store.get(KEY, "") === day) return;
  const spot = tickedBox();
  // Asked as the tick happens, before it reaches the note: how much Today had.
  const before = api.today(day).then(openToday, () => null);
  // Then asked again each time a note changes, until the count moves (a change that isn't the
  // tick, like the guide's, leaves it as it was). Nothing to do if Today was already empty.
  const off = onVaultChange(async () => {
    const was = await before;
    if (!was) return stop();
    const after = await api.today(day).then(openToday, () => null);
    if (after === null || after === was) return;
    stop();
    if (!shouldCelebrate(was, after, day, store.get(KEY, ""))) return;
    store.set(KEY, day);
    celebrate(spot);
  });
  const timer = setTimeout(() => off(), WAIT);
  const stop = () => (off(), clearTimeout(timer));
}

/** The box just ticked: the one pressed a moment ago, or the focused one (ticked with the keyboard). */
function tickedBox(): Spot | null {
  if (pressed && Date.now() - pressed.at < 1000) return pressed;
  const box = document.activeElement?.closest(BOX);
  return box ? { box, rect: box.getBoundingClientRect() } : null;
}

function celebrate(spot: Spot | null) {
  // The list may have redrawn since the tick: ring the box where it is now, or where it was.
  const now = spot?.box.isConnected ? spot.box.getBoundingClientRect() : null;
  const r = now?.width ? now : spot?.rect;
  if (r?.width && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
    const burst = el("span", { class: "td-burst", "aria-hidden": "true", style: { left: `${r.left + r.width / 2}px`, top: `${r.top + r.height / 2}px` } });
    document.body.append(burst);
    setTimeout(() => burst.remove(), 700);
  }
  toast({ icon: "check", text: "Today's tasks are done.", detail: cheer() });
}
