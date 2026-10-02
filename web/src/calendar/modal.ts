// A calendar dialog: the app's modal (../modal.ts) in the calendar's look. One at a time: opening
// one closes the last. The Calendars dialog (sources.ts) and the event form (editor.ts) are these.
import { openModal } from "../modal.ts";

export function modal(o: {
  titleId: string;
  title: string;
  icon: string;
  class: string;
  content: Array<Node | null>;
  /** Escape here is the field's own (a rename being typed), not the dialog's. */
  ownsEscape?(target: Element): boolean;
}): { box: HTMLElement; close(): void } {
  const { box, close } = openModal({
    title: o.title,
    icon: o.icon,
    content: o.content,
    id: "agents-page",
    pageClass: "",
    boxClass: `agents-box ${o.class}`,
    headClass: "agents-head",
    titleId: o.titleId,
    ownsEscape: o.ownsEscape,
  });
  return { box, close };
}
