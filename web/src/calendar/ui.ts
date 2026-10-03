// Small pieces every event list shares: a calendar's color dot, and an event as one row with its
// time and a meeting-note button (Today, a ::view's agenda). Event text is set as text only.
import { el, icon } from "../dom.ts";
import { toast } from "../toast.ts";
import { connectUrl, leave, needsWrite } from "./google.ts";
import { canEditCalendars, colorVar, eventHref, meetingNote, timeOnDay, type CalendarEvent, type Item } from "./data.ts";
import type { Day } from "./layout.ts";

export const dot = (color: string | null | undefined, cls = "cal-dot") => el("span", { class: cls, "aria-hidden": "true", style: { "--c": colorVar(color) } });

/** Open the event's meeting note, making it first if it has none, and say whether its link reached a Google event. */
export async function openMeetingNote(ev: CalendarEvent, open: (path: string) => void) {
  try {
    const { path, linkedBack } = await meetingNote(ev);
    open(path);
    if (linkedBack?.ok) toast({ icon: "link", text: "Link added to the event in Google Calendar" });
    else if (linkedBack && needsWrite(linkedBack.error)) toast({ text: linkedBack.error, actionLabel: "Allow", action: () => leave.to(connectUrl(true)) });
    else if (linkedBack) toast({ text: `Couldn't add the link to Google Calendar: ${linkedBack.error}` });
  } catch (e) {
    toast({ text: e instanceof Error ? e.message : "Couldn't make the meeting note" });
  }
}

/** The meeting-note button for an event, or null where there's none to open and this person can't make one. */
export function meetingButton(ev: CalendarEvent, open: (path: string) => void, readOnly = false): HTMLElement | null {
  if (!ev.note && (readOnly || !canEditCalendars())) return null;
  const label = ev.note ? "Open meeting note" : "Create meeting note";
  return el(
    "button",
    { type: "button", class: "cal-row-act", title: label, "aria-label": `${label}: ${ev.title}`, onmousedown: (e: Event) => e.preventDefault(), onclick: () => void openMeetingNote(ev, open) },
    icon(ev.note ? "file" : "filePlus", 14),
  );
}

/** An event on one day's list: its time, its calendar's color, its title (opens it on the Calendar page) and its meeting note. */
export function eventRow(item: Extract<Item, { kind: "event" }>, day: Day, hooks: { open(target: string): void; readOnly?: boolean; now?: Date }): HTMLElement {
  const ev = item.event;
  const past = !!hooks.now && item.span.end <= hooks.now;
  return el(
    "div",
    { class: `cal-row${past ? " is-past" : ""}`, role: "listitem" },
    el("span", { class: "cal-row-time" }, timeOnDay(item.span, day)),
    dot(item.color),
    el(
      "button",
      { type: "button", class: "cal-row-title", title: [item.title, ev.location, item.source?.name].filter(Boolean).join(" · "), onmousedown: (e: Event) => e.preventDefault(), onclick: () => hooks.open(eventHref(ev.id)) },
      item.title,
    ),
    meetingButton(ev, hooks.open, hooks.readOnly),
  );
}
