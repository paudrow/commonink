// The event form, for a new event (the New event button, the palette, `c`, a drag across the grid)
// or one being edited: title, when (all day or not, with the date quick picks a task's due date
// has), which calendar, where, notes, who, and for a new one its meeting note. Changing the start
// keeps the length; the form stays open with the server's reason when saving fails. Each row leads
// with an icon instead of a label; where, notes and guests stay behind "Add …" buttons until used,
// and the end date shows only when it differs.
import { api } from "../api.ts";
import { el, icon } from "../dom.ts";
import { store } from "../store.ts";
import { datePicks } from "../taskChips.ts";
import { addDays, dayKey, dayStart } from "./layout.ts";
import { type EventForm, type Target } from "./data.ts";
import { connectUrl, needsWrite } from "./google.ts";
import { modal } from "./modal.ts";

type Person = EventForm["attendees"][number];

const pad = (n: number) => String(n).padStart(2, "0");
const timeValue = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
/** A date field and a time field as a local Date. */
function dateOf(day: string, time: string): Date | null {
  const m = day.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const t = time.match(/^(\d{2}):(\d{2})/) ?? ["", "00", "00"];
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(t[1]), Number(t[2])) : null;
}
/** How long the event runs, said briefly: "30 min", "1 hr 30 min", "2 days". */
function lengthText({ start, end, whole }: { start: Date | null; end: Date | null; whole: boolean }): string {
  if (!start || !end || end <= start) return "";
  const minutes = Math.round((end.getTime() - start.getTime()) / 60_000);
  if (whole) {
    const days = Math.round(minutes / 1440);
    return days === 1 ? "" : `${days} days`;
  }
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h && `${h} hr`, m && `${m} min`].filter(Boolean).join(" ");
}
const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

/** Everyone in the workspace, to suggest as guests (online; none locally). */
async function members(): Promise<Person[]> {
  const list = await api.members().catch(() => []);
  return list.map((m) => ({ name: m.name || null, email: m.email || null }));
}

export function openEventForm(o: { mode: "new" | "edit"; initial: EventForm; targets: Target[]; calendar?: string; save(form: EventForm): Promise<void> }) {
  const f = o.initial;
  const title = el("input", { class: "ws-input cal-f-title", value: f.title, placeholder: "Add a title", "aria-label": "Title", maxlength: "500", autocomplete: "off" });
  const allDay = el("input", { type: "checkbox", checked: f.allDay });
  // An all-day event's end is exclusive; the form shows its last day.
  const endShown = f.allDay ? dayStart(addDays(dayKey(f.end), -1)) : f.end;
  const startDay = el("input", { type: "date", class: "ws-input", value: dayKey(f.start), "aria-label": "Start date" });
  const startTime = el("input", { type: "time", class: "ws-input", value: timeValue(f.start), step: "900", "aria-label": "Start time" });
  const endDay = el("input", { type: "date", class: "ws-input", value: dayKey(endShown), "aria-label": "End date" });
  const endTime = el("input", { type: "time", class: "ws-input", value: timeValue(f.end), step: "900", "aria-label": "End time" });
  // A new event picks its calendar; one being edited stays in its own.
  const pick = o.mode === "new" ? el("select", { class: "ws-input", "aria-label": "Calendar" }, ...o.targets.map((t) => el("option", { value: t.value, selected: t.value === f.source }, t.name))) : null;
  const calendar = pick ?? el("span", { class: "cal-f-fixed" }, o.calendar ?? "");
  const location = el("input", { class: "ws-input", value: f.location, placeholder: "Add a place or a link", "aria-label": "Location", autocomplete: "off" });
  const description = el("textarea", { class: "ws-input cal-f-notes", placeholder: "Add a description", "aria-label": "Description", rows: "3" });
  description.value = f.description;
  const note = el("input", { type: "checkbox", checked: f.meetingNote });
  const problem = el("p", { class: "cal-src-error", role: "alert" });
  const save = el("button", { type: "submit", class: "qw-btn primary" }, o.mode === "new" ? "Add event" : "Save");

  // ---------------------------------------------------------------- guests
  const people: Person[] = [...f.attendees];
  const chips = el("div", { class: "cal-f-people", role: "list", "aria-label": "Guests" });
  const suggest = el("datalist", { id: "cal-f-members" });
  const guest = el("input", { class: "ws-input", list: "cal-f-members", placeholder: "Add guests by email", "aria-label": "Add a guest", autocomplete: "off" });
  let known: Person[] = [];
  void members().then((list) => {
    known = list;
    suggest.replaceChildren(...list.filter((p) => p.email).map((p) => el("option", { value: p.email! }, p.name ?? p.email!)));
  });
  const drawPeople = () =>
    chips.replaceChildren(
      ...people.map((p, i) =>
        el(
          "span",
          { class: "tag is-removable", role: "listitem" },
          p.name ?? p.email,
          el("button", { type: "button", title: `Remove ${p.name ?? p.email}`, "aria-label": `Remove ${p.name ?? p.email}`, onclick: () => (people.splice(i, 1), drawPeople()) }, icon("close", 10)),
        ),
      ),
    );
  /** Whatever's typed in the guest field, as guests: a member by name or address, or an email address. */
  const addTyped = () => {
    const words = guest.value.split(/[,;\s]+/).filter(Boolean);
    const rest = words.filter((w) => {
      const member = known.find((p) => p.email?.toLowerCase() === w.toLowerCase() || p.name?.toLowerCase() === w.toLowerCase());
      const person = member ?? (EMAIL.test(w) ? { name: null, email: w } : null);
      if (person && !people.some((p) => p.email && p.email === person.email)) people.push(person);
      return !person;
    });
    guest.value = rest.join(" ");
    drawPeople();
  };
  guest.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === ",") && guest.value.trim()) {
      e.preventDefault();
      addTyped();
    }
  });
  guest.addEventListener("change", addTyped);
  drawPeople();

  // ---------------------------------------------------------------- when
  let length = f.end.getTime() - f.start.getTime();
  const read = () => {
    const whole = allDay.checked;
    const start = dateOf(startDay.value, whole ? "00:00" : startTime.value);
    const last = dateOf(endDay.value, whole ? "00:00" : endTime.value);
    return { start, end: last && whole ? dayStart(addDays(dayKey(last), 1)) : last, whole };
  };
  /** Times for a timed event; the end date only when the event runs past its first day (or all day over several). */
  const showTimes = () => {
    for (const t of [startTime, endTime]) t.hidden = allDay.checked;
    endDay.hidden = endDay.value === startDay.value && document.activeElement !== endDay;
    dash.hidden = allDay.checked && endDay.hidden;
    moreDays.hidden = !endDay.hidden;
    span.textContent = lengthText(read());
  };
  // A new start keeps the event's length: the end moves with it.
  const startMoved = () => {
    const { start, whole } = read();
    if (!start) return;
    const end = new Date(start.getTime() + length);
    endDay.value = dayKey(whole ? dayStart(addDays(dayKey(end), -1)) : end);
    endTime.value = timeValue(end);
    showTimes();
  };
  const endMoved = () => {
    const { start, end } = read();
    if (start && end && end > start) length = end.getTime() - start.getTime();
    showTimes();
  };
  startDay.addEventListener("change", startMoved);
  startTime.addEventListener("change", startMoved);
  endDay.addEventListener("change", endMoved);
  endTime.addEventListener("change", endMoved);
  allDay.addEventListener("change", () => {
    showTimes();
    length = allDay.checked ? Math.max(86_400_000, Math.round(length / 86_400_000) * 86_400_000) : 30 * 60_000;
    startMoved();
  });
  const dash = el("span", { class: "cal-f-to" }, "–");
  const span = el("span", { class: "cal-f-span" });
  const moreDays = el("button", { type: "button", class: "cal-f-link", onclick: () => ((endDay.hidden = false), (dash.hidden = false), endDay.focus()) }, "Ends another day");
  // The same quick picks a task's due date has (no Clear: an event always has a day). The end moves with the start.
  const picks = el(
    "div",
    { class: "cal-f-row cal-f-sub cal-f-picks", role: "group", "aria-label": "Start date" },
    ...datePicks().map((p) => el("button", { type: "button", class: "cal-f-link", onclick: () => ((startDay.value = p.day), startMoved()) }, p.label)),
  );
  showTimes();

  // ---------------------------------------------------------------- the rest, as rows that open when wanted
  const row = (iconName: string, _label: string, ...content: (HTMLElement | null)[]) =>
    el("div", { class: "cal-f-line" }, el("span", { class: "cal-f-icon" }, icon(iconName, 16)), el("div", { class: "cal-f-line-body" }, ...content));
  const whereRow = row("globe", "Location", location);
  const notesRow = row("list", "Description", description);
  const guestsRow = row("share-people", "Guests", chips, guest, suggest);
  const adders = el("div", { class: "cal-f-adders" });
  const optional: Array<[HTMLElement, string, HTMLElement, boolean]> = [
    [whereRow, "Location", location, !!f.location],
    [guestsRow, "Guests", guest, f.attendees.length > 0],
    [notesRow, "Description", description, !!f.description],
  ];
  for (const [line, label, input, filled] of optional) {
    line.hidden = !filled;
    if (filled) continue;
    const add: HTMLButtonElement = el("button", {
      type: "button",
      class: "cal-f-add",
      onclick: () => {
        line.hidden = false;
        add.remove();
        if (!adders.children.length) adders.hidden = true;
        input.focus();
      },
    }, icon("plus", 13), `Add ${label.toLowerCase()}`);
    adders.append(add);
  }
  adders.hidden = !adders.children.length;

  // ---------------------------------------------------------------- saving
  const form = el(
    "form",
    { class: "cal-f" },
    title,
    row(
      "clock",
      "When",
      el("div", { class: "cal-f-row" }, startDay, startTime, dash, endDay, endTime, span),
      picks,
      el("div", { class: "cal-f-row cal-f-sub" }, el("label", { class: "cal-f-check" }, allDay, "All day"), moreDays),
    ),
    pick && o.targets.length < 2 ? null : row("calendar", "Calendar", calendar),
    whereRow,
    guestsRow,
    notesRow,
    adders,
    o.mode === "new" ? row("file", "Meeting note", el("label", { class: "cal-f-check" }, note, "Also make a meeting note")) : null,
    problem,
    el("div", { class: "ask-actions" }, el("button", { type: "button", class: "qw-btn", onclick: () => close() }, "Cancel"), save),
  );
  const fail = (text: string) => {
    problem.replaceChildren(text, ...(needsWrite(text) ? [" ", el("a", { href: connectUrl(true) }, "Allow")] : []));
  };
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    addTyped();
    const { start, end, whole } = read();
    if (!title.value.trim()) {
      fail("Give the event a title");
      return title.focus();
    }
    if (!start || !end) return fail("Give the event a start and an end");
    if (end <= start) return fail("An event has to end after it starts");
    problem.replaceChildren();
    save.disabled = true;
    save.textContent = "Saving…";
    const next: EventForm = {
      source: pick?.value ?? f.source,
      title: title.value,
      start,
      end,
      allDay: whole,
      location: location.value,
      description: description.value,
      attendees: people,
      meetingNote: note.checked,
    };
    try {
      await o.save(next);
      if (o.mode === "new") store.set("calendarTarget", next.source);
      close();
    } catch (err) {
      fail(err instanceof Error ? err.message : "Couldn't save the event");
    } finally {
      save.disabled = false;
      save.textContent = o.mode === "new" ? "Add event" : "Save";
    }
  });
  const { close } = modal({ titleId: "cal-f-title", title: o.mode === "new" ? "New event" : "Edit event", icon: "calendar", class: "cal-f-box", content: [form] });
  title.focus();
  return { close };
}

/** The calendar a new event goes in: the one used last, if it's still there, or the first. */
export const lastTarget = (targets: Target[]) => targets.find((t) => t.value === store.get<string>("calendarTarget", ""))?.value ?? targets[0]?.value ?? "";
