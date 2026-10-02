// Shortcut tips: Common Ink is keyboard-first, but a new person clicks. The third time someone
// clicks a button that has a shortcut (the sidebar's Search, the top bar's Archive, Settings), a
// toast says once which keys do it: "Tip: ⌘K searches from anywhere." Each tip shows once in this
// browser, at most one shows per visit, never from the keyboard or a touch screen, and never over a
// dialog or the palette: a tip that comes due then waits until it closes. Settings → Keyboard turns
// them off. The counting is plain functions on a plain state, so it can be tested; main.ts keeps it.
import { formatKeys } from "./keys.ts";

export interface Tip {
  /** The id of the button it's about. */
  id: string;
  keys: string;
  /** What the keys do, after them: "⌘K" + " searches from anywhere." */
  does: string;
}

/** Only buttons whose shortcut does what the button does (Notes is the exception: ⌘⇧F is Notes with its filter ready). */
export const TIPS: Tip[] = [
  { id: "search-btn", keys: "Mod-k", does: "searches from anywhere." },
  { id: "notes-btn", keys: "Mod-Shift-f", does: "opens Notes from anywhere, ready to filter." },
  { id: "archive-btn", keys: "Mod-Shift-e", does: "archives the open note." },
  { id: "focus-btn", keys: "Mod-Shift-Enter", does: "turns focus mode on and off." },
  { id: "panel-btn", keys: "Mod-\\", does: "shows and hides the info panel." },
  { id: "split-btn", keys: "Mod-Alt-\\", does: "opens split view, and closes it again." },
  { id: "share-btn", keys: "Mod-Shift-s", does: "opens Share." },
  { id: "settings-btn", keys: "Mod-,", does: "opens Settings." },
];

/** A tip comes due on this click of its button. */
export const CLICKS = 3;

/** What this browser keeps (under one key): whether tips are off, the clicks so far, and the tips already shown. */
export interface TipsState {
  off?: boolean;
  clicks: Record<string, number>;
  shown: string[];
}

export const NO_TIPS: TipsState = { clicks: {}, shown: [] };

export const tipText = (tip: Tip, mac?: boolean) => `Tip: ${formatKeys(tip.keys, mac)} ${tip.does}`;

/**
 * A click on button `id`: counted, and the tip to show now, if it's due. `usedThisVisit` says a tip
 * has already come due since the page loaded. A tip that shows is marked shown at once and counts no more.
 */
export function clickTip(state: TipsState, id: string, usedThisVisit: boolean): { state: TipsState; tip: Tip | null } {
  const tip = TIPS.find((t) => t.id === id);
  if (!tip || state.off || state.shown.includes(id)) return { state, tip: null };
  const n = (state.clicks[id] ?? 0) + 1;
  if (n < CLICKS || usedThisVisit) return { state: { ...state, clicks: { ...state.clicks, [id]: n } }, tip: null };
  const { [id]: _, ...clicks } = state.clicks;
  return { state: { ...state, clicks, shown: [...state.shown, id] }, tip };
}

/** What watchTips needs from the app. */
export interface TipsHooks {
  load(): TipsState;
  save(state: TipsState): void;
  /** A dialog, the palette or the quick-add bar is open. */
  busy(): boolean;
  show(tip: Tip): void;
}

/** How long after the click a tip waits (the click's own toast, an Archive's Undo, goes first), and how often it looks again while a dialog is open. */
const SETTLE = 700;

/** Count pointer clicks on the tips' buttons, and show a tip when one comes due. */
export function watchTips(hooks: TipsHooks, doc: Document = document) {
  let used = false;
  doc.addEventListener(
    "click",
    (e) => {
      const button = (e.target as Element | null)?.closest?.("button");
      // Enter or Space on a focused button is a click with no detail: that person already uses the keyboard.
      if (!button?.id || e.detail < 1 || (e as PointerEvent).pointerType === "touch" || matchMedia("(pointer: coarse)").matches) return;
      const before = hooks.load();
      const r = clickTip(before, button.id, used);
      if (r.state === before) return;
      hooks.save(r.state);
      if (!r.tip) return;
      used = true;
      const tip = r.tip;
      const later = (): unknown => setTimeout(() => (hooks.load().off ? null : hooks.busy() ? later() : hooks.show(tip)), SETTLE);
      later();
    },
    true,
  );
}
