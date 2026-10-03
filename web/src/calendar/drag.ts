// Dragging on the calendar with a mouse or a pen. In Week and Day: down a day's column across a time
// to make an event there, an event to another time or day, an event's bottom edge to change its end;
// in Month, an event to another day. Everything snaps to 15 minutes (layout.ts has the math). A press
// that doesn't move is a click: on empty grid, a new half-hour event there (the slot under the
// pointer is outlined while it hovers); a drag of something that can't change says why instead.
// Touch scrolls the page as usual: there, the form and the keys (keys.ts) do this.
import { atMinutes, dayKey, dayStart, dragSlot, endAt, moved, movedTo, snap, timesOf, type Day, type Times } from "./layout.ts";
import { readOnlyReason, timeText, type Item } from "./data.ts";

export interface DragHooks {
  item(key: string): Item | undefined;
  /** Whether there's a calendar to put a new event in. */
  canCreate(): boolean;
  create(slot: { start: Date; end: Date }): void;
  /** A click on empty grid, at the half hour under it. */
  pick(slot: { start: Date; end: Date }): void;
  change(item: Item, times: Times, verb: "Moved" | "Resized"): void;
  refuse(reason: string): void;
}

/** How far a press moves, in pixels, before it's a drag. */
const THRESHOLD = 5;

type Press = { x: number; y: number; pointer: number };

/**
 * Follow a press: `begin` runs once it's moved far enough to be a drag (and may refuse it), `move`
 * as it goes, `end` on release. A drag doesn't also click what it started on.
 */
function follow(e: PointerEvent, run: { begin(): boolean; move(ev: PointerEvent): void; end(ev: PointerEvent): void; cancel(): void }) {
  const press: Press = { x: e.clientX, y: e.clientY, pointer: e.pointerId };
  let state: "pressed" | "dragging" | "done" = "pressed";
  const onMove = (ev: PointerEvent) => {
    if (ev.pointerId !== press.pointer) return;
    if (state === "pressed") {
      if (Math.hypot(ev.clientX - press.x, ev.clientY - press.y) < THRESHOLD) return;
      state = run.begin() ? "dragging" : "done";
      if (state === "done") return stop();
    }
    ev.preventDefault();
    run.move(ev);
  };
  const onUp = (ev: PointerEvent) => {
    if (ev.pointerId !== press.pointer) return;
    if (state === "dragging") {
      run.end(ev);
      swallowClick();
    }
    stop();
  };
  const onCancel = () => {
    if (state === "dragging") run.cancel();
    stop();
  };
  const onKey = (ev: KeyboardEvent) => ev.key === "Escape" && onCancel();
  function stop() {
    state = "done";
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
    window.removeEventListener("keydown", onKey, true);
  }
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onCancel);
  window.addEventListener("keydown", onKey, true);
}

/** The click that ends a drag isn't a click on what was dragged. */
function swallowClick() {
  const eat = (ev: Event) => (ev.stopPropagation(), ev.preventDefault());
  window.addEventListener("click", eat, { capture: true, once: true });
  setTimeout(() => window.removeEventListener("click", eat, true), 0);
}

const pressable = (e: PointerEvent) => e.button === 0 && e.pointerType !== "touch" && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
const keyOf = (chip: HTMLElement) => chip.dataset.nav!.slice(11);
const dayOfChip = (chip: HTMLElement) => chip.dataset.nav!.slice(0, 10);
const daysBetween = (a: Day, b: Day) => Math.round((dayStart(b).getTime() - dayStart(a).getTime()) / 86_400_000);

/** Drags in the time grid (`body` holds the day columns, each `.cal-col[data-day]`; `hour` is pixels an hour). */
export function gridDrags(body: HTMLElement, hooks: DragHooks, hour: number) {
  const cols = () => [...body.querySelectorAll<HTMLElement>(".cal-col[data-day]")];
  const minutesIn = (col: HTMLElement, y: number) => ((y - col.getBoundingClientRect().top) / hour) * 60;
  const colAt = (x: number) => {
    const all = cols();
    return all.find((c) => x < c.getBoundingClientRect().right) ?? all[all.length - 1];
  };
  const place = (node: HTMLElement, top: number, bottom: number) => Object.assign(node.style, { top: `${(top / 60) * hour}px`, height: `${Math.max(((bottom - top) / 60) * hour - 2, 10)}px` });
  const clock = (d: Date, day: Day) => (dayKey(d) === day ? d.getHours() * 60 + d.getMinutes() : d > dayStart(day) ? 24 * 60 : 0);

  // The half hour under a mouse on empty grid, outlined: a click there makes an event.
  const ghost = Object.assign(document.createElement("div"), { className: "cal-ghost" });
  ghost.setAttribute("aria-hidden", "true");
  const halfHour = (col: HTMLElement, y: number) => {
    const day = col.dataset.day!;
    const from = Math.min(23.5 * 60, Math.floor(minutesIn(col, y) / 30) * 30);
    return { from, slot: { start: atMinutes(day, from), end: atMinutes(day, from + 30) } };
  };
  body.addEventListener("pointermove", (e) => {
    const target = e.target as HTMLElement;
    const col = e.pointerType === "mouse" && e.buttons === 0 && !target.closest(".cal-ev") ? target.closest<HTMLElement>(".cal-col[data-day]") : null;
    if (!col || !hooks.canCreate()) return ghost.remove();
    const { from, slot } = halfHour(col, e.clientY);
    if (ghost.parentElement !== col) col.append(ghost);
    place(ghost, from, from + 30);
    ghost.textContent = timeText(slot.start);
  });
  body.addEventListener("pointerleave", () => ghost.remove());
  body.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const col = target.closest<HTMLElement>(".cal-col[data-day]");
    if (!col || target.closest(".cal-ev") || e.button !== 0) return;
    ghost.remove();
    hooks.pick(halfHour(col, e.clientY).slot);
  });

  body.addEventListener("pointerdown", (e) => {
    if (!pressable(e)) return;
    ghost.remove();
    const target = e.target as HTMLElement;
    const chip = target.closest<HTMLElement>(".cal-ev");
    const col = target.closest<HTMLElement>(".cal-col[data-day]");
    if (!col) return;

    if (!chip) {
      // Across empty grid: a new event there.
      const day = col.dataset.day!;
      const from = minutesIn(col, e.clientY);
      const draft = Object.assign(document.createElement("div"), { className: "cal-ev is-draft" });
      draft.setAttribute("aria-hidden", "true");
      let slot = dragSlot(day, from, from);
      return follow(e, {
        begin: () => {
          if (!hooks.canCreate()) return false;
          col.append(draft);
          return true;
        },
        move: (ev) => {
          slot = dragSlot(day, from, minutesIn(col, ev.clientY));
          place(draft, clock(slot.start, day), clock(slot.end, day));
          draft.textContent = `${timeText(slot.start)} to ${timeText(slot.end)}`;
        },
        end: () => (draft.remove(), hooks.create(slot)),
        cancel: () => draft.remove(),
      });
    }

    const item = hooks.item(keyOf(chip));
    if (!item) return;
    const day = dayOfChip(chip);
    const resize = !!target.closest(".cal-ev-grip");
    const top = parseFloat(chip.style.top) / hour * 60;
    const grab = minutesIn(col, e.clientY) - top; // where on the event it was picked up
    const home = { parent: chip.parentElement!, top: chip.style.top, height: chip.style.height, left: chip.style.left, width: chip.style.width, time: chip.querySelector(".cal-chip-time")?.cloneNode(true) as Element | undefined };
    let times: Times | null = null;
    const restore = () => {
      home.parent.append(chip);
      Object.assign(chip.style, { top: home.top, height: home.height, left: home.left, width: home.width });
      if (home.time) chip.querySelector(".cal-chip-time")?.replaceWith(home.time);
    };
    follow(e, {
      begin: () => {
        const reason = readOnlyReason(item);
        if (reason) hooks.refuse(reason);
        else chip.classList.add("is-dragging");
        return !reason;
      },
      move: (ev) => {
        if (resize) {
          times = endAt(item.span, day, minutesIn(col, ev.clientY));
          place(chip, top, clock(new Date(times.end), day));
          return showTimes(chip, times);
        }
        const to = colAt(ev.clientX);
        const toDay = to.dataset.day!;
        const at = minutesIn(to, ev.clientY) - grab;
        // An event that began the day before keeps its start's minutes: it moves by whole steps from there.
        times = dayKey(item.span.start) === day ? movedTo(item.span, toDay, at) : moved(item.span, { days: daysBetween(day, toDay), minutes: snap(at - top) });
        if (chip.parentElement !== to) to.append(chip);
        Object.assign(chip.style, { left: "0", width: "calc(100% - 3px)" });
        const start = new Date(times.start);
        const startMin = clock(start, toDay);
        place(chip, startMin, startMin + (item.span.end.getTime() - item.span.start.getTime()) / 60_000);
        showTimes(chip, times);
      },
      end: () => {
        chip.classList.remove("is-dragging");
        const was = timesOf(item.span.start, item.span.end, false);
        if (times && (times.start !== was.start || times.end !== was.end)) hooks.change(item, times, resize ? "Resized" : "Moved");
        else restore();
      },
      cancel: () => (chip.classList.remove("is-dragging"), restore()),
    });
  });
}

/** An event being dragged says where it would land. (The page draws it again once it's saved, or put back.) */
function showTimes(chip: HTMLElement, times: Times) {
  const [start, end] = [new Date(times.start), new Date(times.end)];
  for (const [cls, text] of [[".cal-t-start", timeText(start)], [".cal-t-range", `${timeText(start)} – ${timeText(end)}`]]) {
    const node = chip.querySelector(cls);
    if (node) node.textContent = text;
  }
}

/** Drags in Month: an event to another day, by whole days. */
export function monthDrags(grid: HTMLElement, hooks: DragHooks) {
  grid.addEventListener("pointerdown", (e) => {
    if (!pressable(e)) return;
    const chip = (e.target as HTMLElement).closest<HTMLElement>(".cal-chip[data-nav]");
    const item = chip && hooks.item(keyOf(chip));
    if (!chip || !item) return;
    // By the day under the pointer, not the element: a bar across several days lies over the ones after its first.
    const cellAt = (x: number, y: number) =>
      [...grid.querySelectorAll<HTMLElement>(".cal-cell[data-nav]")].find((c) => {
        const r = c.getBoundingClientRect();
        return x >= r.left && x < r.right && y >= r.top && y < r.bottom;
      }) ?? null;
    const from = cellAt(e.clientX, e.clientY)?.dataset.nav?.slice(0, 10) ?? dayOfChip(chip);
    let over: HTMLElement | null = null;
    const mark = (cell: HTMLElement | null) => {
      over?.classList.remove("is-drop");
      over = cell;
      over?.classList.add("is-drop");
    };
    follow(e, {
      begin: () => {
        const reason = readOnlyReason(item);
        if (reason) hooks.refuse(reason);
        else chip.classList.add("is-dragging");
        return !reason;
      },
      move: (ev) => mark(cellAt(ev.clientX, ev.clientY)),
      end: () => {
        chip.classList.remove("is-dragging");
        const to = over?.dataset.nav?.slice(0, 10);
        mark(null);
        if (to && to !== from) hooks.change(item, moved(item.span, { days: daysBetween(from, to) }), "Moved");
      },
      cancel: () => (chip.classList.remove("is-dragging"), mark(null)),
    });
  });
}
