// The Today ring: a thin circle that fills as you tick today's tasks (overdue, due or starting
// today: the ones the Today page lists) and closes when Today is clear. A small one sits beside
// Today in the sidebar, and a larger one beside the date at the top of the Today page. Both keep up
// as tasks change anywhere, and aren't there when Today had nothing, or in a workspace that isn't
// gamified (gamify.ts). The counting is in todayDone.ts.
import { api } from "./api.ts";
import { onVaultChange } from "./events.ts";
import { gamified, onGamified } from "./gamify.ts";
import { today } from "./taskChips.ts";
import { openToday, todayProgress, type TodayProgress } from "./todayDone.ts";

const NS = "http://www.w3.org/2000/svg";

/** One ring, hidden until it's given progress. `big` is the Today page's, with the count beside it. */
function ring(big: boolean) {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", "today-ring");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");
  const circle = (cls: string) => {
    const c = document.createElementNS(NS, "circle");
    for (const [k, v] of Object.entries({ class: cls, cx: "8", cy: "8", r: "6.25", pathLength: "100" })) c.setAttribute(k, v);
    return svg.appendChild(c);
  };
  circle("today-ring-track");
  const fill = circle("today-ring-fill");
  // A tick inside, shown once the ring closes, so a full ring reads as done rather than empty.
  // Turned back a quarter, since the whole ring is turned so it fills from the top.
  const tick = document.createElementNS(NS, "path");
  for (const [k, v] of Object.entries({ class: "today-ring-tick", d: "M5.3 8.2 7.2 10 10.7 6.2", transform: "rotate(90 8 8)" })) tick.setAttribute(k, v);
  svg.append(tick);
  // What a screen reader hears; the ring itself is a picture of it. The big one shows it too.
  const label = document.createElement("span");
  label.className = big ? "today-ring-text" : "sr-only";
  const root = document.createElement("span");
  root.className = big ? "today-ring-wrap is-big" : "today-ring-wrap";
  root.hidden = true;
  root.append(svg, label);
  const set = (p: TodayProgress | null) => {
    root.hidden = !p?.total;
    if (!p?.total) return;
    root.classList.toggle("is-closed", p.fraction === 1);
    fill.setAttribute("stroke-dasharray", `${Math.round(p.fraction * 100)} 100`);
    label.textContent = big ? (p.fraction === 1 ? "All done" : `${p.done} of ${p.total} done`) : `, ${p.label}`;
    if (big) root.setAttribute("aria-label", p.label);
    root.title = p.label;
  };
  if (big) root.setAttribute("role", "img");
  return { root, set };
}

/** Keep `set` up to date with Today's progress (null: don't draw); returns a function that stops. */
function follow(set: (p: TodayProgress | null) => void): () => void {
  let asked = 0;
  const draw = async () => {
    const mine = ++asked;
    if (!gamified()) return set(null);
    const v = await api.today(today()).catch(() => null);
    if (mine !== asked || !v) return; // a newer ask is on its way, or Today couldn't be read: leave it as it was
    set(gamified() ? todayProgress(openToday(v), v.done ?? 0) : null);
  };
  void draw();
  const offChange = onVaultChange(() => void draw(), 600);
  const offGamified = onGamified(() => void draw());
  // Back to the tab, maybe on another day: Today may be a new list.
  const onVisible = () => document.visibilityState === "visible" && void draw();
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    asked++;
    offChange();
    offGamified();
    document.removeEventListener("visibilitychange", onVisible);
  };
}

/** The sidebar's ring, at the right of the Today button. */
export function watchTodayRing(button: HTMLElement) {
  const r = ring(false);
  button.append(r.root);
  follow(r.set);
}

/** The Today page's larger ring, beside the date; returns its cleanup. */
export function todayPageRing(): { root: HTMLElement; stop: () => void } {
  const r = ring(true);
  return { root: r.root, stop: follow(r.set) };
}
