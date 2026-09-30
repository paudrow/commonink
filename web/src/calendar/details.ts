// An event's details, beside the calendar (a sheet from the bottom on a phone): when, where, which
// calendar, who, the description, its link, and its meeting note. Everything here came from an
// outside feed, so it's set as text; the one link is http(s) only (the server checks) and opens in
// a new tab with no opener or referrer.
import { el, icon } from "../dom.ts";
import { toast } from "../toast.ts";
import { canEditCalendars, eventHref, hostOf, plainText, webAddress, whenText, type Item } from "./data.ts";
import { dot, openMeetingNote } from "./ui.ts";

const ATTENDEES_SHOWN = 12;

const outLink = (href: string, text: string) => el("a", { href, target: "_blank", rel: "noopener noreferrer", class: "is-external" }, text);

/** `edit` and `delete` are there for an event in a calendar this person can write to. */
export function renderDetails(item: Extract<Item, { kind: "event" }>, hooks: { open(path: string): void; close(): void; edit?(): void; delete?(): void }): HTMLElement {
  const ev = item.event;
  const titleId = `cal-d-${ev.id}`;
  const field = (ico: string, label: string, ...body: Array<Node | string | null>) =>
    el("div", { class: "cal-d-field" }, el("span", { class: "cal-d-ico", title: label, "aria-label": label, role: "img" }, icon(ico, 15)), el("div", { class: "cal-d-val" }, ...body));
  const where = ev.location ? (webAddress(ev.location) ? outLink(webAddress(ev.location)!, hostOf(ev.location)) : ev.location) : null;
  const people = ev.attendees.map((p) => p.name || p.email).filter((p): p is string => !!p);
  const organizer = ev.organizer?.name || ev.organizer?.email || null;
  const description = ev.description ? plainText(ev.description) : "";
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(new URL(eventHref(ev.id), location.origin).href);
      toast({ icon: "link", text: "Link copied" });
    } catch {
      toast({ text: "Couldn't copy the link" });
    }
  };
  return el(
    "section",
    { class: "cal-details", role: "dialog", "aria-labelledby": titleId, tabindex: "-1" },
    el(
      "header",
      { class: "cal-d-head" },
      dot(item.color, "cal-d-swatch"),
      el("h2", { id: titleId }, item.title),
      el("button", { type: "button", class: "icon-btn small", title: "Close (Esc)", "aria-label": "Close", onclick: hooks.close }, icon("close", 15)),
    ),
    field("clock", "When", whenText(item.span), ev.recurring ? el("span", { class: "cal-d-tag" }, icon("reset", 11), "Recurring") : null, ev.status === "tentative" ? el("span", { class: "cal-d-tag" }, "Tentative") : null),
    where ? field("globe", "Where", where) : null,
    field("calendar", "Calendar", dot(item.color), item.source?.name ?? "Calendar"),
    organizer ? field("user", "Organizer", `Organized by ${organizer}`) : null,
    people.length
      ? field(
          "at",
          "Attendees",
          el("span", { class: "cal-d-count" }, `${people.length} ${people.length === 1 ? "guest" : "guests"}`),
          el("ul", { class: "cal-d-people" }, ...people.slice(0, ATTENDEES_SHOWN).map((p) => el("li", {}, p)), people.length > ATTENDEES_SHOWN ? el("li", { class: "is-more" }, `and ${people.length - ATTENDEES_SHOWN} more`) : null),
        )
      : null,
    description ? el("div", { class: "cal-d-desc", tabindex: "0", role: "region", "aria-label": "Description" }, description) : null,
    ev.url ? field("open", "Link", outLink(ev.url, item.source?.kind === "google" ? "Open in Google Calendar" : `Open in ${hostOf(ev.url)}`)) : null,
    el(
      "div",
      { class: "cal-d-actions" },
      ev.note || canEditCalendars()
        ? el("button", { type: "button", class: "qw-btn primary", onclick: () => void openMeetingNote(ev, hooks.open) }, icon(ev.note ? "file" : "filePlus", 14), ev.note ? "Open meeting note" : "Create meeting note")
        : el("span", { class: "cal-d-hint" }, "No meeting note yet"),
      el("button", { type: "button", class: "qw-btn", onclick: () => void copy() }, icon("link", 14), "Copy link"),
      hooks.edit ? el("button", { type: "button", class: "qw-btn", onclick: hooks.edit }, icon("edit", 14), "Edit") : null,
      hooks.delete ? el("button", { type: "button", class: "qw-btn danger", onclick: hooks.delete }, icon("trash", 14), "Delete") : null,
    ),
  );
}
