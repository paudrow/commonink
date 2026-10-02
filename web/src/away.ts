// "While you were away": one line at the top of Notes and Today when agents changed things since
// you last changed anything yourself ("Claude edited 4 notes and added 6 tasks while you were
// away"), with See changes (History on just that span) and ×. Your own last change is kept by the
// server, so it holds across browsers and devices; dismissing is per browser, up to the last change
// it covered, and the line comes back only when an agent does more. Fetched when the app opens and
// when you come back to its tab. Nothing shows when agents did nothing.
import { api } from "./api.ts";
import { el, icon } from "./dom.ts";
import { store } from "./store.ts";
import { awayLine, type AwaySummary } from "../../src/core/away.ts";

export interface AwayHooks {
  /** History on the agents' changes after this change id. */
  seeChanges(after: number): void;
  /** Which workspace this is, so a dismissal in one doesn't hide another's. */
  workspace(): string;
}

let summary: AwaySummary | null = null;
const strip = el("div", { class: "away", role: "status", hidden: true });
const key = (h: AwayHooks) => `away:${h.workspace() || "local"}`;

/** The line, to put at the top of a page; it moves to whichever page asks for it last. */
export function awayStrip(): HTMLElement {
  return strip;
}

function render(hooks: AwayHooks) {
  const s = summary;
  strip.hidden = !s;
  if (!s) return strip.replaceChildren();
  const dismiss = () => {
    store.set(key(hooks), s.last);
    summary = null;
    render(hooks);
  };
  const when = new Date(s.from).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
  strip.replaceChildren(
    icon("bot", 15),
    el("span", { class: "away-text", title: `Since ${when}, the first change after your own last one` }, awayLine(s)),
    el("button", { type: "button", class: "link-btn away-see", onclick: () => (dismiss(), hooks.seeChanges(s.after)) }, "See changes"),
    el("button", { type: "button", class: "away-x", title: "Dismiss", "aria-label": "Dismiss", onclick: dismiss }, icon("close", 13)),
  );
}

async function load(hooks: AwayHooks) {
  const got = await api.away(Number(store.get(key(hooks), 0)) || 0).catch(() => undefined);
  if (got === undefined) return;
  summary = got;
  render(hooks);
}

/** Fetch the summary now, and again whenever you come back to this tab. */
export function startAway(hooks: AwayHooks) {
  void load(hooks);
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && void load(hooks));
}
