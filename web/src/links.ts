// Links that leave the app (a web page, an email) versus links to notes and calendar events.
// External ones show a small ↗ and their domain, open in the browser, and never open to the side.
// No DOM here beyond the event a clicked calendar link sends.

import { safeDecode } from "../../src/core/uri.ts";

export type LinkKind = "external" | "internal";

const EXTERNAL = /^(?:https?:|mailto:)/i;

/** Where a link's href goes: out of the app (http, https, mailto) or to a note. */
export const linkKind = (href: string): LinkKind => (EXTERNAL.test(href.trim()) ? "external" : "internal");

/** An email address as a tooltip may show it: one address, no spaces, quotes or brackets, a plain domain. */
const ADDRESS = /^[^\s@<>"'`\\()\[\],;:]{1,64}@(?:[a-z0-9-]{1,63}\.)*[a-z0-9-]{1,63}$/i;

/**
 * What an external link's tooltip names: its domain (without www.), or the address of a mailto.
 * Only what parses as one; anything else (a bad escape, a URL with no host) names nothing, so a
 * tooltip never repeats raw note text.
 */
export function linkHost(href: string): string | null {
  const h = href.trim();
  if (/^mailto:/i.test(h)) {
    const address = safeDecode(h.slice(7).split("?")[0]);
    return ADDRESS.test(address) ? address : null;
  }
  try {
    return new URL(h).hostname.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

/** The tooltip for an external link. */
export const externalTitle = (href: string) => {
  const host = linkHost(href);
  return host ? `${host} · opens in your browser` : "Opens in your browser";
};

/**
 * A link to the Calendar page or one of its events (`/calendar`, `/calendar/<event id>`): the event's
 * ID ("" for the page itself), or null for any other link. Meeting notes link to their event this way.
 */
export function calendarTarget(href: string): string | null {
  const m = href.trim().match(/^\/calendar(?:\/([a-z2-9]{12}))?\/?$/);
  return m ? (m[1] ?? "") : null;
}

/** A calendar link clicked where no note editor handles it (a note card, an embed): main.ts goes there. */
export const OPEN_CALENDAR = "quire-open-calendar";
export const openCalendarLink = (href: string) => window.dispatchEvent(new CustomEvent(OPEN_CALENDAR, { detail: calendarTarget(href) ?? "" }));
