// App-wide events: vault changes for live widgets, and what the person just did, for the guide.
import type { GuideStep } from "../../src/core/guide.ts";

export const vaultEvents = new EventTarget();

export function onVaultChange(fn: () => void, ms = 250): () => void {
  let t = 0;
  const handler = () => {
    clearTimeout(t);
    t = window.setTimeout(fn, ms);
  };
  vaultEvents.addEventListener("change", handler);
  return () => {
    clearTimeout(t);
    vaultEvents.removeEventListener("change", handler);
  };
}

/** Something the person just did that the Getting started checklist asks them to try (see onboarding.ts). */
export const DIDS = ["slash", "link", "search", "star", "tick"] as const satisfies readonly GuideStep[];
export type Did = (typeof DIDS)[number];
export const didEvents = new EventTarget();
export const did = (what: Did) => didEvents.dispatchEvent(new Event(what));

/** A first worth a seal that only this tab sees you do (see sealUnlocks.ts). */
export type First = "followedBacklink" | "usedTemplate" | "madeBoard";
export const firstEvents = new EventTarget();
export const didFirst = (what: First) => firstEvents.dispatchEvent(new Event(what));
