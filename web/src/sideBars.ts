// The sidebar and the info panel, as VS Code's side bars: each one hides and shows (⌘B, ⌥⌘B, or
// its button), and its inner edge is a sash you drag to make it wider or narrower. Dragged under
// half its narrowest, it snaps shut, and dragged back out in the same drag it opens again; a
// double-click on the sash puts back the width it started with. The widths are kept per browser.

/** How wide a side bar can be, and the width it starts with, in pixels. */
export interface BarSize {
  min: number;
  max: number;
  initial: number;
}
export const SIDEBAR: BarSize = { min: 180, max: 520, initial: 264 };
export const PANEL: BarSize = { min: 220, max: 600, initial: 292 };

/** A width kept within a bar's bounds; anything that isn't a number is its starting width. */
export function clampWidth(w: unknown, size: BarSize): number {
  return typeof w === "number" && Number.isFinite(w) ? Math.round(Math.min(size.max, Math.max(size.min, w))) : size.initial;
}

/**
 * Where a drag of a bar's sash leaves it, for the width the pointer asks for: shut, under half its
 * narrowest (as VS Code does); otherwise open, kept within its bounds.
 */
export function dragTo(want: number, size: BarSize): { open: boolean; width: number } {
  if (want < size.min / 2) return { open: false, width: size.min }; // its width while shut: wireSash keeps the one it had
  return { open: true, width: clampWidth(want, size) };
}

/**
 * Let `sash` resize a bar on the window's `edge` (left: the sidebar, whose sash is its right edge;
 * right: the panel, whose sash is its left edge). Arrow keys on the focused sash move it too.
 */
export function wireSash(
  sash: HTMLElement,
  edge: "left" | "right",
  size: BarSize,
  bar: { width(): number; set(width: number, open: boolean): void; done(): void },
) {
  const toward = (x: number) => (edge === "left" ? x : window.innerWidth - x);
  sash.setAttribute("aria-valuemin", String(size.min));
  sash.setAttribute("aria-valuemax", String(size.max));
  sash.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    sash.setPointerCapture(e.pointerId);
    // The pointer is a few pixels off the bar's edge: keep that offset, so the edge doesn't jump.
    const start = bar.width();
    const off = start - toward(e.clientX);
    document.body.classList.add("is-resizing");
    sash.classList.add("is-dragging");
    const move = (ev: PointerEvent) => {
      const at = dragTo(toward(ev.clientX) + off, size);
      bar.set(at.open ? at.width : start, at.open); // snapped shut, it keeps its width for when it opens again
    };
    let ended = false;
    const up = () => {
      if (ended) return;
      ended = true;
      sash.removeEventListener("pointermove", move);
      sash.removeEventListener("lostpointercapture", up);
      document.body.classList.remove("is-resizing");
      sash.classList.remove("is-dragging");
      bar.done();
    };
    sash.addEventListener("pointermove", move);
    sash.addEventListener("pointerup", up, { once: true });
    sash.addEventListener("lostpointercapture", up, { once: true });
  });
  sash.addEventListener("dblclick", () => {
    bar.set(size.initial, true);
    bar.done();
  });
  sash.addEventListener("keydown", (e) => {
    // The arrow away from the bar's edge widens it; Shift moves further.
    const by = e.shiftKey ? 48 : 16;
    const d = e.key === "ArrowRight" ? by : e.key === "ArrowLeft" ? -by : 0;
    if (!d) return;
    e.preventDefault();
    bar.set(clampWidth(bar.width() + (edge === "left" ? d : -d), size), true);
    bar.done();
  });
}
