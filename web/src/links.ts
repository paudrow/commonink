// Links that leave the app (a web page, an email) versus links to notes. External ones show a
// small ↗ and their domain, open in the browser, and never open to the side. No DOM here.

export type LinkKind = "external" | "internal";

const EXTERNAL = /^(?:https?:|mailto:)/i;

/** Where a link's href goes: out of the app (http, https, mailto) or to a note. */
export const linkKind = (href: string): LinkKind => (EXTERNAL.test(href.trim()) ? "external" : "internal");

/** What an external link's tooltip names: its domain (without www.), or the address of a mailto. */
export function linkHost(href: string): string {
  const h = href.trim();
  if (/^mailto:/i.test(h)) return decodeURIComponent(h.slice(7).split("?")[0]);
  try {
    return new URL(h).hostname.replace(/^www\./, "");
  } catch {
    return h;
  }
}

/** The tooltip for an external link. */
export const externalTitle = (href: string) => `${linkHost(href)} · opens in your browser`;
