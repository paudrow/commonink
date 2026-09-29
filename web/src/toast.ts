// Toasts: a line in the corner saying what just happened, often with an Undo. Each one is read out
// to screen readers, stays while the pointer or focus is on it, and ⌘Z (Ctrl+Z off a Mac) presses
// the newest Undo while you aren't typing somewhere with an undo of its own.
import { authorAvatar, authorName, el, icon, typingIn } from "./dom.ts";
import { IS_MAC } from "./panes.ts";

export interface ToastSpec {
  text: string;
  by?: { source: string; person: string | null; agent: string | null };
  icon?: string;
  detail?: string;
  /** With `actionLabel`, a button; without, clicking the toast runs it. A label of "Undo" is also ⌘Z. */
  action?: () => void;
  actionLabel?: string;
  /** An Open button beside the action, for a toast about a note that isn't open. */
  open?: () => void;
  /** Something the person asked to hear about (a timer ending): read out at once, and it stays longer. */
  alert?: boolean;
}

/** How long a toast stays, counted only while nothing is on it. */
export const LIFE = { plain: 5000, action: 10_000, alert: 12_000 };
/** Left with less than this after a hover or focus, a toast gets this much again. */
const AGAIN = 2000;
const UNDO = "Undo";
const UNDO_KEY = IS_MAC ? "⌘Z" : "Ctrl+Z";

interface Live {
  spec: ToastSpec;
  node: HTMLElement;
  remaining: number;
  since: number;
  timer: ReturnType<typeof setTimeout> | undefined;
  holds: Set<"hover" | "focus">;
  /** What had the focus before it came into the toast, to give it back when the toast goes. */
  back: HTMLElement | null;
}

const live: Live[] = [];

function region(id: string, attrs: Record<string, string>): HTMLElement {
  return document.getElementById(id) ?? document.body.appendChild(el("div", { id, ...attrs }));
}
// The live regions exist before the first toast, or a screen reader may miss it.
const stack = () => region("toasts", { role: "region", "aria-label": "Notifications" });
const polite = region("toast-status", { class: "sr-only", role: "status" });
const assertive = region("toast-alert", { class: "sr-only", role: "alert" });

export function toast(t: ToastSpec): void {
  const undo = t.actionLabel === UNDO;
  const button = t.action && t.actionLabel
    ? el("button", { class: "toast-action", type: "button", title: undo ? `Undo (${UNDO_KEY})` : undefined, "aria-keyshortcuts": undo ? (IS_MAC ? "Meta+Z" : "Control+Z") : undefined }, t.actionLabel)
    : null;
  const open = t.open ? el("button", { class: "toast-action", type: "button" }, "Open") : null;
  const node = el(
    "div",
    { class: `toast${t.action && !button ? " is-clickable" : ""}${t.alert ? " is-alert" : ""}` },
    t.by ? authorAvatar(t.by, 22) : el("span", { class: "toast-icon" }, icon(t.icon ?? "info", 16)),
    el("div", { class: "toast-body" }, el("div", { class: "toast-text" }, t.by ? el("b", {}, authorName(t.by)) : null, t.by ? ` ${t.text}` : t.text), t.detail ? el("div", { class: "toast-detail" }, t.detail) : null),
    open,
    button,
  );
  const me: Live = { spec: t, node, remaining: 0, since: 0, timer: undefined, holds: new Set(), back: null };
  node.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest("button");
    if (b === open) t.open!();
    else if (b === button || !button) t.action?.();
    dismiss(me);
  });
  node.addEventListener("mouseenter", () => hold(me, "hover"));
  node.addEventListener("mouseleave", () => release(me, "hover"));
  node.addEventListener("focusin", (e) => {
    if (!me.holds.has("focus")) me.back = e.relatedTarget instanceof HTMLElement && !node.contains(e.relatedTarget) ? e.relatedTarget : null;
    hold(me, "focus");
  });
  node.addEventListener("focusout", (e) => {
    if (!node.contains(e.relatedTarget as Node | null)) release(me, "focus");
  });
  node.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    dismiss(me);
  });
  stack().append(node);
  live.push(me);
  run(me, t.alert ? LIFE.alert : button ? LIFE.action : LIFE.plain);
  const said = [t.by ? `${authorName(t.by)} ${t.text}` : t.text, t.detail, undo ? `Undo with ${IS_MAC ? "Command-Z" : "Control+Z"}` : null].filter(Boolean).join(". ");
  (t.alert ? assertive : polite).replaceChildren(el("div", {}, said));
}

/** Press the newest toast's Undo, if one is showing. */
export function undoLatest(): boolean {
  const t = live.findLast((x) => x.spec.actionLabel === UNDO && x.spec.action);
  if (!t) return false;
  t.spec.action!();
  dismiss(t);
  return true;
}

function run(t: Live, ms: number) {
  t.remaining = ms;
  t.since = Date.now();
  t.timer = setTimeout(() => dismiss(t), ms);
}

function hold(t: Live, why: "hover" | "focus") {
  if (!t.holds.size) {
    clearTimeout(t.timer);
    t.remaining -= Date.now() - t.since;
  }
  t.holds.add(why);
}

function release(t: Live, why: "hover" | "focus") {
  if (!t.holds.delete(why) || t.holds.size || !live.includes(t)) return;
  run(t, Math.max(t.remaining, AGAIN));
}

function dismiss(t: Live) {
  const i = live.indexOf(t);
  if (i < 0) return;
  live.splice(i, 1);
  clearTimeout(t.timer);
  if (t.node.contains(document.activeElement)) (t.back?.isConnected ? t.back : null)?.focus();
  t.node.classList.add("is-leaving");
  setTimeout(() => t.node.remove(), 400);
}

// Where someone is typing, the field or the editor has an undo of its own.
window.addEventListener(
  "keydown",
  (e) => {
    if (e.key.toLowerCase() !== "z" || !(IS_MAC ? e.metaKey : e.ctrlKey) || e.shiftKey || e.altKey || typingIn(e.target)) return;
    if (undoLatest()) e.preventDefault();
  },
  true,
);
