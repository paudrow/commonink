// The Calendar page: the workspace's calendars and the open tasks due each day, as a month, a week,
// a day or an agenda of what's next. An event opens beside the calendar with its details and its
// meeting note; its address is /calendar/<event id>. Keys are in keys.ts; the date math in layout.ts.
import { api } from "../api.ts";
import { el, icon, setPressed, typingIn } from "../dom.ts";
import { matchKeys } from "../keys.ts";
import { store } from "../store.ts";
import { toast } from "../toast.ts";
import { calendars, canEditCalendars, colorVar, dayText, dueTasks, eventHref, eventItems, events, placeText, timeOnDay, timeText, whenText, type CalendarSource, type Item } from "./data.ts";
import { renderDetails } from "./details.ts";
import { CALENDAR_KEYS, VIEW_KEYS, type CalendarAction } from "./keys.ts";
import { addDays, bars, bucket, dayKey, dayStart, daysRange, inAllDayRow, monthWeeks, nowMinutes, spanOf, stepDay, timeGrid, viewDays, type Bar, type Day, type View } from "./layout.ts";
import { openCalendars } from "./sources.ts";
import { googleStatus } from "./google.ts";
import { dot } from "./ui.ts";
import { setDone } from "../taskRow.ts";

export interface CalendarHooks {
  /** Open a note, at a line (a task's), or to the side. */
  open(path: string, line?: number, side?: boolean): void;
  /** Point the address bar at the page or one of its events, in place (not a new step back). */
  setUrl(url: string): void;
}

const PHONE = "(max-width: 760px)";
/** Pixels per hour in the time grid. */
const HOUR = 48;
/** Lines a day shows in Month before "+N more". */
const MONTH_LINES = 3;
/** How often the page reads its events again while it's showing. */
const REFRESH_EVERY = 5 * 60_000;
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const span = (i: Item) => i.span;
const longDay = (d: Day) => dayText(dayStart(d), { weekday: "long", month: "long", day: "numeric" });
const count = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

function rangeTitle(days: Day[]): string {
  const [a, b] = [dayStart(days[0]), dayStart(days[days.length - 1])];
  const sameYear = a.getFullYear() === b.getFullYear();
  const from = dayText(a, { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
  return `${from} to ${dayText(b, { month: a.getMonth() === b.getMonth() && sameYear ? undefined : "short", day: "numeric", year: "numeric" })}`;
}

const VIEWS: Record<View, { label: string; title(day: Day): string }> = {
  month: { label: "Month", title: (d) => dayStart(d).toLocaleDateString(undefined, { month: "long", year: "numeric" }) },
  week: { label: "Week", title: (d) => rangeTitle(viewDays("week", d)) },
  day: { label: "Day", title: (d) => dayText(dayStart(d), { weekday: "long", month: "long", day: "numeric", year: "numeric" }) },
  agenda: { label: "Agenda", title: (d) => rangeTitle(viewDays("agenda", d)) },
};

/** Where the keyboard is: a day (its cell, or its header) and, in a day's list, one of its items by key ("" for none). */
interface Cursor {
  day: Day;
  key: string;
}
const navOf = (c: Cursor) => `${c.day}|${c.key}`;

export class CalendarPage {
  view: View;
  /** The day the view is around. */
  day: Day = dayKey(new Date());
  private cursor: Cursor = { day: this.day, key: "" };
  private items: Item[] = [];
  /** Tasks being ticked or reopened, so a second click waits for the first. */
  private ticking = new Set<string>();
  private sources: CalendarSource[] = [];
  /** Whether this server has Google Calendar, which anyone may add their own calendars from. */
  private google = false;
  private problem = "";
  private loaded = false;
  private loading = 0;
  private lastLoad = 0;
  /** The event whose details show. */
  private selected: string | null = null;
  /** The day it was when the page was last drawn (Today, the now line). */
  private drawnOn = "";
  private title = el("h1", { class: "cal-title", "aria-live": "polite" });
  private viewButtons: Record<View, HTMLButtonElement>;
  private notice = el("div", { class: "cal-notice", hidden: true });
  private body = el("div", { class: "cal-body" });
  private details = el("div", { class: "cal-details-host" });

  constructor(
    readonly root: HTMLElement,
    private hooks: CalendarHooks,
  ) {
    this.view = matchMedia(PHONE).matches ? "agenda" : store.get<View>("calendarView", "week");
    if (!(this.view in VIEWS)) this.view = "week";
    const btn = (ico: string, label: string, run: () => void, cls = "icon-btn") => el("button", { type: "button", class: cls, title: label, "aria-label": label, onclick: run }, icon(ico, 16));
    this.viewButtons = Object.fromEntries(
      (Object.keys(VIEWS) as View[]).map((v) => [v, el("button", { type: "button", title: `${VIEWS[v].label} (${v[0]})`, onclick: () => void this.setView(v) }, VIEWS[v].label)]),
    ) as Record<View, HTMLButtonElement>;
    root.append(
      el(
        "div",
        { class: "cal" },
        el(
          "header",
          { class: "cal-head" },
          this.title,
          el(
            "div",
            { class: "cal-tools" },
            el(
              "div",
              { class: "cal-nav" },
              btn("back", "Previous (k)", () => void this.run("prev"), "icon-btn cal-prev"),
              el("button", { type: "button", class: "qw-btn cal-today", title: "Today (t)", onclick: () => void this.run("today") }, "Today"),
              btn("chevron", "Next (j)", () => void this.run("next")),
            ),
            el("div", { class: "seg cal-views", role: "group", "aria-label": "View" }, ...Object.values(this.viewButtons)),
            el("button", { type: "button", class: "qw-btn cal-sources-btn", title: "Your calendars: subscribe, rename, remove", "aria-label": "Calendars", onclick: () => this.openSources() }, icon("calendar", 14), el("span", {}, "Calendars")),
          ),
        ),
        this.notice,
        el("div", { class: "cal-main" }, this.body, this.details),
      ),
    );
    root.addEventListener("keydown", (e) => this.onKey(e));
    root.addEventListener("focusin", (e) => {
      const nav = (e.target as HTMLElement).closest<HTMLElement>("[data-nav]")?.dataset.nav;
      if (nav) this.cursor = { day: nav.slice(0, 10), key: nav.slice(11) };
    });
    // Read again every few minutes while showing, and when you come back to the window; the now line moves every minute.
    let ticks = 0;
    window.setInterval(() => {
      if (!this.visible) return;
      if (++ticks % (REFRESH_EVERY / 60_000) === 0) void this.refresh();
      else this.moveNow();
    }, 60_000);
    window.addEventListener("focus", () => this.visible && Date.now() - this.lastLoad > 30_000 && void this.refresh());
  }

  get visible() {
    return !this.root.hidden;
  }

  /** Show the page, on today, or on an event with its details open. */
  async show(opts: { event?: string } = {}) {
    this.root.hidden = false;
    if (opts.event) {
      const known = this.items.find((i) => i.kind === "event" && i.key === opts.event);
      const ev = known?.kind === "event" ? known.event : await api.event(opts.event).catch(() => null);
      if (!ev) {
        toast({ text: "That event doesn't exist, or you can't see it" });
        this.hooks.setUrl("/calendar");
        this.selected = null;
      } else {
        this.selected = ev.id;
        this.day = dayKey(spanOf(ev).start);
        this.cursor = { day: this.day, key: ev.id };
      }
    } else if (this.selected) this.closeDetails(false);
    await this.load();
    (this.details.querySelector<HTMLElement>(".cal-details") ?? this.root).focus({ preventScroll: true });
  }

  /** Read the events again, keeping the view, the scroll and the keyboard where they are. */
  async refresh() {
    if (this.visible) await this.load(true);
  }

  // ---------------------------------------------------------------- data

  private async load(keep = false) {
    const run = ++this.loading;
    const days = viewDays(this.view, this.day);
    const { from, to } = daysRange(days);
    if (!this.loaded) this.body.replaceChildren(el("div", { class: "cal-loading" }, "Loading…"));
    let items: Item[] = keep ? this.items : []; // a refresh that fails keeps what's showing
    try {
      const [sources, list, tasks, google] = await Promise.all([calendars(), events(from, to), dueTasks(days[0], days[days.length - 1]), googleStatus().catch(() => null)]);
      this.google = !!google && google.mode !== "off";
      this.sources = sources;
      items = [...eventItems(list, sources), ...tasks];
      this.problem = "";
    } catch (e) {
      this.problem = e instanceof Error ? e.message : "Couldn't load the calendar";
    }
    if (run !== this.loading) return; // a later load (another week) has the page now
    this.items = items;
    this.loaded = true;
    this.lastLoad = Date.now();
    this.render(keep);
  }

  // ---------------------------------------------------------------- moving around

  private async run(action: CalendarAction) {
    if (action === "today") return this.goTo(dayKey(new Date()));
    if (action === "next" || action === "prev") return this.goTo(stepDay(this.view, this.day, action === "next" ? 1 : -1));
    return this.setView(action);
  }

  private async goTo(day: Day, key = "") {
    this.day = day;
    this.cursor = { day, key };
    await this.load();
    this.focusCursor();
  }

  async setView(view: View, day = this.day) {
    this.view = view;
    if (!matchMedia(PHONE).matches) store.set("calendarView", view);
    await this.goTo(day, this.cursor.day === day ? this.cursor.key : "");
  }

  private goDay = (day: Day) => void this.setView("day", day);

  /** The arrow keys: days in Month; in Week and Day, left and right go by day and up and down through its events; Agenda goes down the list. */
  private async move(key: string) {
    const c = this.cursor;
    if (this.view === "month") {
      const by = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[key] ?? 0;
      return this.moveTo({ day: addDays(c.day, by), key: "" });
    }
    const navs = [...this.body.querySelectorAll<HTMLElement>("[data-nav]")];
    if (key === "ArrowLeft" || key === "ArrowRight") {
      const day = addDays(c.day, key === "ArrowLeft" ? -1 : 1);
      if (this.view === "agenda") {
        const heads = navs.filter((n) => n.dataset.nav!.endsWith("|"));
        const at = heads.findIndex((n) => n.dataset.nav === navOf({ day: c.day, key: "" }));
        const to = key === "ArrowLeft" ? (c.key ? at : at - 1) : at + 1;
        return heads[Math.max(0, Math.min(heads.length - 1, to))]?.focus();
      }
      const first = navs.find((n) => n.dataset.nav!.startsWith(`${day}|`) && !n.dataset.nav!.endsWith("|"));
      return this.moveTo({ day, key: first?.dataset.nav!.slice(11) ?? "" });
    }
    const pool = this.view === "agenda" ? navs : navs.filter((n) => n.dataset.nav!.startsWith(`${c.day}|`));
    const at = pool.findIndex((n) => n.dataset.nav === navOf(c));
    pool[Math.min(pool.length - 1, Math.max(0, at + (key === "ArrowUp" ? -1 : 1)))]?.focus();
  }

  private async moveTo(c: Cursor) {
    this.cursor = c;
    if (!viewDays(this.view, this.day).includes(c.day) || (this.view === "month" && dayStart(c.day).getMonth() !== dayStart(this.day).getMonth())) {
      this.day = c.day;
      await this.load();
    }
    this.focusCursor();
  }

  /** Give the keyboard to the cursor's day or item, making it the one tab stop in the calendar. */
  private focusCursor(focus = true) {
    const navs = [...this.body.querySelectorAll<HTMLElement>("[data-nav]")];
    const target = navs.find((n) => n.dataset.nav === navOf(this.cursor)) ?? navs.find((n) => n.dataset.nav === navOf({ day: this.cursor.day, key: "" })) ?? navs[0];
    for (const n of navs) n.tabIndex = n === target ? 0 : -1;
    if (focus) target?.focus({ preventScroll: this.view !== "agenda" });
  }

  private onKey(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    if (e.defaultPrevented || typingIn(t)) return;
    if (e.key === "Escape" && this.selected) {
      e.preventDefault();
      return this.closeDetails();
    }
    if (t.closest(".cal-details, .cal-head")) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (/^Arrow/.test(e.key) && !e.shiftKey) {
      e.preventDefault();
      return void this.move(e.key);
    }
    if (e.key === "Enter" && t.matches("[role=gridcell]")) {
      e.preventDefault();
      return this.goDay(this.cursor.day);
    }
    if ((e.key === "Enter" || e.key === " ") && t.closest("button, a")) return; // the button's own
    const task = t.closest<HTMLElement>("[data-task]")?.dataset.task;
    if (task && matchKeys(e, "x")) {
      const item = this.items.find((i): i is Extract<Item, { kind: "task" }> => i.kind === "task" && i.key === task);
      e.preventDefault();
      return item && void this.tick(item);
    }
    const view = (Object.keys(VIEW_KEYS) as Array<keyof typeof VIEW_KEYS>).find((k) => matchKeys(e, k));
    const action = view ? VIEW_KEYS[view] : CALENDAR_KEYS.find((k) => k.action && k.keys.some((key) => matchKeys(e, key)))?.action;
    if (!action) return;
    e.preventDefault();
    void this.run(action);
  }

  // ---------------------------------------------------------------- details

  private select(id: string) {
    this.selected = id;
    this.hooks.setUrl(eventHref(id));
    this.renderDetails();
    this.details.querySelector<HTMLElement>(".cal-details")?.focus();
  }

  private closeDetails(refocus = true) {
    this.selected = null;
    this.hooks.setUrl("/calendar");
    this.renderDetails();
    if (refocus) this.focusCursor();
  }

  private renderDetails() {
    const item = this.items.find((i): i is Extract<Item, { kind: "event" }> => i.kind === "event" && i.key === this.selected);
    if (this.selected && !item) {
      // Gone from what's showing (another week, or the feed dropped it): so is its address.
      this.selected = null;
      this.hooks.setUrl("/calendar");
    }
    this.root.classList.toggle("has-details", !!item);
    for (const n of this.body.querySelectorAll<HTMLElement>("[data-event]")) n.classList.toggle("is-selected", n.dataset.event === item?.key);
    if (!item) return this.details.replaceChildren();
    this.details.replaceChildren(renderDetails(item, { open: (path) => this.hooks.open(path), close: () => this.closeDetails() }));
  }

  /** The Calendars dialog; `subscribe` starts in its link field, `google` at its Google section. */
  openSources(opts: { subscribe?: boolean; google?: boolean } = {}) {
    openCalendars({ ...opts, changed: () => void this.refresh() });
  }

  /** Subscribe from the palette: the page, then the dialog with the link field ready. */
  subscribe() {
    this.openSources({ subscribe: true });
  }

  // ---------------------------------------------------------------- drawing

  private render(keep: boolean) {
    const scroller = this.body;
    const scroll = keep ? scroller.scrollTop : null;
    const hadFocus = this.body.contains(document.activeElement);
    this.drawnOn = dayKey(new Date());
    this.title.textContent = VIEWS[this.view].title(this.day);
    for (const [v, b] of Object.entries(this.viewButtons)) setPressed(b, v === this.view);
    this.renderNotice();
    this.root.dataset.view = this.view;
    const views: Record<View, () => HTMLElement> = { month: () => this.month(), week: () => this.timeGrid(viewDays("week", this.day)), day: () => this.timeGrid([this.day]), agenda: () => this.agenda() };
    this.body.replaceChildren(views[this.view]());
    this.renderDetails();
    this.focusCursor(keep && hadFocus);
    if (scroll !== null) scroller.scrollTop = scroll;
    else if (this.view === "week" || this.view === "day") {
      // To the open event's hour, or to now on a view with today in it, or to 8 in the morning.
      const days = viewDays(this.view, this.day);
      const open = this.items.find((i) => i.key === this.selected && !inAllDayRow(i.span) && days.includes(dayKey(i.span.start)));
      const hours = open ? nowMinutes(open.span.start) / 60 - 1 : days.includes(dayKey(new Date())) ? nowMinutes(new Date()) / 60 - 1.5 : 8;
      scroller.scrollTop = Math.min(Math.max(0, hours), 16) * HOUR;
    } else scroller.scrollTop = 0;
  }

  private renderNotice() {
    const none = !this.problem && this.loaded && !this.sources.length;
    this.notice.hidden = !this.problem && !none;
    if (this.problem) return this.notice.replaceChildren(icon("info", 14), el("span", {}, this.problem), el("button", { type: "button", class: "qw-btn", onclick: () => void this.refresh() }, "Try again"));
    if (!none) return;
    const edit = canEditCalendars();
    const google = el("button", { type: "button", class: "qw-btn", onclick: () => this.openSources({ google: true }) }, icon("globe", 13), "Google Calendar");
    this.notice.replaceChildren(
      icon("calendar", 14),
      el(
        "span",
        {},
        edit
          ? `No calendars yet. Subscribe to a calendar's ICS or webcal link${this.google ? ", or add your Google calendars," : ""} to see events here, with your tasks.`
          : `No calendars in this workspace yet. Tasks with due dates show here${this.google ? ", and your own Google calendars if you add them" : ""}.`,
      ),
      ...(edit ? [el("button", { type: "button", class: "qw-btn", onclick: () => this.openSources({ subscribe: true }) }, icon("plus", 13), "Subscribe")] : []),
      ...(this.google ? [google] : []),
    );
  }

  /**
   * An item: an event as a button that opens its details, or a task due that day as its checkbox
   * (tick it here, as in Tasks) and a button that opens its note at the task.
   */
  private chip(item: Item, day: Day, how: { bar?: Bar<Item>; timed?: boolean } = {}): HTMLElement {
    if (item.kind === "task") return this.taskChip(item, day, how);
    const time = item.span.allDay || how.bar ? null : el("span", { class: "cal-chip-time" }, timeOnDay(item.span, day));
    const title = el("span", { class: "cal-chip-title" }, item.title);
    const lead = how.timed || how.bar || item.span.allDay ? null : dot(item.color);
    const label = [item.title, whenText(item.span), placeText(item.event.location), item.source?.name].filter(Boolean).join(", ");
    return el(
      "button",
      {
        type: "button",
        class: `cal-chip is-event${how.bar || item.span.allDay ? " is-allday" : ""}${how.bar?.before ? " is-before" : ""}${how.bar?.after ? " is-after" : ""}${item.event.status === "tentative" ? " is-tentative" : ""}`,
        "data-nav": `${day}|${item.key}`,
        "data-event": item.key,
        tabindex: "-1",
        title: label,
        "aria-label": label,
        style: { "--c": colorVar(item.color) },
        onclick: () => {
          this.cursor = { day, key: item.key };
          this.select(item.key);
        },
      },
      ...(how.timed ? [title, time] : [lead, time, title]),
    );
  }

  private taskChip(item: Extract<Item, { kind: "task" }>, day: Day, how: { bar?: Bar<Item> }): HTMLElement {
    const t = item.task;
    const state = t.done ? "done" : "due";
    const label = `${item.title}, task ${state} ${longDay(day)}, in ${t.title}`;
    const box = el("button", {
      type: "button",
      class: `cm-checkbox cal-check${t.done ? " is-checked" : ""}`,
      role: "checkbox",
      tabindex: "-1",
      "aria-checked": String(t.done),
      "aria-label": `${item.title}: ${t.done ? "done" : "not done"}`,
      title: t.done ? "Mark open (x)" : "Mark done (x)",
      onclick: () => void this.tick(item),
    });
    const open = el(
      "button",
      {
        type: "button",
        class: "cal-chip-open",
        "data-nav": `${day}|${item.key}`,
        tabindex: "-1",
        title: label,
        "aria-label": label,
        onclick: (e: MouseEvent) => {
          this.cursor = { day, key: item.key };
          this.hooks.open(t.path, t.line, e.metaKey || e.ctrlKey);
        },
      },
      el("span", { class: "cal-chip-title" }, item.title),
    );
    return el("div", { class: `cal-chip is-task is-allday${t.done ? " is-done" : ""}${how.bar?.before ? " is-before" : ""}${how.bar?.after ? " is-after" : ""}`, "data-task": item.key, style: { "--c": "var(--muted)" } }, box, open);
  }

  /**
   * Tick a task due on the calendar, or reopen it, the way Tasks does (setDone): Undo, and a repeating
   * task's next date, come with it. It shows at once, then the calendar reads the notes again.
   */
  private async tick(item: Extract<Item, { kind: "task" }>) {
    const t = item.task;
    if (this.ticking.has(item.key)) return;
    this.ticking.add(item.key);
    const done = !t.done;
    for (const n of [...this.body.querySelectorAll<HTMLElement>("[data-task]")].filter((n) => n.dataset.task === item.key)) {
      n.classList.toggle("is-done", done);
      const box = n.querySelector<HTMLElement>(".cal-check")!;
      box.classList.toggle("is-checked", done);
      box.setAttribute("aria-checked", String(done));
    }
    await setDone(t, done, { changed: () => void this.refresh() });
    this.ticking.delete(item.key);
  }

  private month(): HTMLElement {
    const weeks = monthWeeks(this.day);
    const byDay = bucket(this.items, span, weeks.flat());
    const month = dayStart(this.day).getMonth();
    const today = dayKey(new Date());
    return el(
      "div",
      { class: "cal-month", role: "grid", "aria-label": VIEWS.month.title(this.day), style: { "--weeks": String(weeks.length) } },
      el("div", { class: "cal-dows", role: "row" }, ...DOW.map((d) => el("div", { class: "cal-dow", role: "columnheader" }, d))),
      ...weeks.map((week) =>
        el(
          "div",
          { class: "cal-mweek", role: "row" },
          ...week.map((d) => {
            const list = byDay.get(d)!;
            const shown = list.length > MONTH_LINES ? list.slice(0, MONTH_LINES - 1) : list;
            const date = dayStart(d);
            return el(
              "div",
              {
                class: `cal-cell${date.getMonth() !== month ? " is-other" : ""}${d === today ? " is-today" : ""}${d < today ? " is-past" : ""}`,
                role: "gridcell",
                tabindex: "-1",
                "data-nav": `${d}|`,
                "aria-label": `${longDay(d)}${list.length ? `, ${count(list.length, "item")}` : ""}`,
                "aria-current": d === today ? "date" : undefined,
                // Anywhere in a day but its events shows that day (a phone draws the events as dots).
                onclick: (e: MouseEvent) => !(e.target as Element).closest("button") && this.goDay(d),
              },
              el("button", { type: "button", class: "cal-num", tabindex: "-1", title: `Show ${longDay(d)}`, "aria-label": `Show ${longDay(d)}`, onclick: () => this.goDay(d) }, String(date.getDate())),
              ...shown.map((i) => this.chip(i, d)),
              list.length > shown.length ? el("button", { type: "button", class: "cal-more", tabindex: "-1", onclick: () => this.goDay(d) }, `+${list.length - shown.length} more`) : null,
            );
          }),
        ),
      ),
    );
  }

  private timeGrid(days: Day[]): HTMLElement {
    const today = dayKey(new Date());
    const top = bars(this.items, span, days);
    const rows = Math.max(1, ...top.map((b) => b.row + 1));
    const head = (d: Day) => {
      const date = dayStart(d);
      const label = el("span", { class: "cal-dh" }, el("span", { class: "cal-dh-dow" }, DOW[(date.getDay() + 6) % 7]), el("span", { class: "cal-dh-num" }, String(date.getDate())));
      // In Day view the day's header is its journal note; in Week, it shows that day.
      return days.length === 1
        ? el("button", { type: "button", class: `cal-dayhead${d === today ? " is-today" : ""}`, "data-nav": `${d}|`, title: `Journal for ${longDay(d)}`, onclick: () => void this.openJournal(d) }, label, el("span", { class: "cal-dh-journal" }, icon("file", 13), "Journal"))
        : el("button", { type: "button", class: `cal-dayhead${d === today ? " is-today" : ""}`, "data-nav": `${d}|`, title: `Show ${longDay(d)}`, "aria-label": `Show ${longDay(d)}`, onclick: () => this.goDay(d) }, label);
    };
    const hours = Array.from({ length: 23 }, (_, h) => el("div", { class: "cal-hour", style: { top: `${(h + 1) * HOUR}px` } }, timeText(new Date(2000, 0, 1, h + 1)).replace(":00", "")));
    const column = (d: Day) => {
      const segs = timeGrid(this.items, span, d);
      const now = d === today ? el("div", { class: "cal-now", "aria-hidden": "true", style: { top: `${(nowMinutes(new Date()) / 60) * HOUR}px` } }) : null;
      return el(
        "div",
        { class: `cal-col${d === today ? " is-today" : ""}`, role: "group", "aria-label": longDay(d) },
        ...segs.map((s) => {
          const chip = this.chip(s.item, d, { timed: true });
          const height = (Math.max(s.bottom - s.top, 15) / 60) * HOUR;
          chip.classList.add("cal-ev");
          if (height < 36) chip.classList.add("is-short");
          if (s.item.span.end <= new Date()) chip.classList.add("is-past");
          Object.assign(chip.style, { top: `${(s.top / 60) * HOUR}px`, height: `${height - 2}px`, left: `calc(${s.lane} * 100% / ${s.lanes})`, width: `calc(100% / ${s.lanes} - 3px)` });
          return chip;
        }),
        now,
      );
    };
    return el(
      "div",
      { class: "cal-tg", style: { "--days": String(days.length), "--hour": `${HOUR}px` } },
      el(
        "div",
        { class: "cal-tg-top" },
        el("div", { class: "cal-tg-head" }, el("div", { class: "cal-gutter" }), ...days.map(head)),
        el(
          "div",
          { class: "cal-tg-allday", style: { "--rows": String(rows) }, role: "group", "aria-label": "All day" },
          el("div", { class: "cal-gutter cal-allday-label" }, "All day"),
          ...top.map((b) => {
            const chip = this.chip(b.item, days[b.from], { bar: b });
            Object.assign(chip.style, { gridColumn: `${b.from + 2} / ${b.to + 3}`, gridRow: String(b.row + 1) });
            return chip;
          }),
        ),
      ),
      el("div", { class: "cal-tg-body" }, el("div", { class: "cal-hours", "aria-hidden": "true" }, ...hours), ...days.map(column)),
    );
  }

  private agenda(): HTMLElement {
    const days = viewDays("agenda", this.day);
    const byDay = bucket(this.items, span, days);
    const today = dayKey(new Date());
    const shown = days.filter((d) => byDay.get(d)!.length || d === today);
    const row = (item: Item, d: Day) => {
      const chip = this.chip(item, d);
      chip.classList.add("cal-arow");
      // A task's row keeps its checkbox; the rest of the row opens it, as an event's whole row does.
      const b = item.kind === "task" ? chip.querySelector<HTMLElement>(".cal-chip-open")! : chip;
      b.replaceChildren(
        el("span", { class: "cal-arow-time" }, item.kind === "task" ? (item.task.done ? "Done" : "Due") : timeOnDay(item.span, d)),
        el("span", { class: "cal-arow-bar", "aria-hidden": "true" }),
        el(
          "span",
          { class: "cal-arow-main" },
          el("span", { class: "cal-arow-title" }, item.title),
          el("span", { class: "cal-arow-meta" }, item.kind === "event" ? [placeText(item.event.location), item.source?.name].filter(Boolean).join(" · ") : item.task.title),
        ),
      );
      return chip;
    };
    const next = el("button", { type: "button", class: "qw-btn cal-agenda-next", onclick: () => void this.run("next") }, "Next two weeks", icon("chevron", 14));
    return el(
      "div",
      { class: "cal-agenda" },
      ...shown.map((d) =>
        el(
          "section",
          { class: `cal-aday${d === today ? " is-today" : ""}`, "aria-label": longDay(d) },
          el("h2", {}, el("button", { type: "button", class: "cal-aday-head", "data-nav": `${d}|`, tabindex: "-1", title: `Show ${longDay(d)}`, onclick: () => this.goDay(d) }, d === today ? "Today" : dayText(dayStart(d), { weekday: "long" }), el("span", {}, dayText(dayStart(d), { month: "long", day: "numeric" })))),
          byDay.get(d)!.length ? el("div", { class: "cal-aday-list" }, ...byDay.get(d)!.map((i) => row(i, d))) : el("p", { class: "cal-aday-none" }, "Nothing today."),
        ),
      ),
      shown.length <= 1 && !byDay.get(today)?.length ? el("p", { class: "cal-agenda-empty" }, `Nothing in the ${days.length} days from ${dayText(dayStart(days[0]), { month: "long", day: "numeric" })}.`) : null,
      next,
    );
  }

  /** Move the now line; past midnight, draw the page again for the new day. */
  private moveNow() {
    if (dayKey(new Date()) !== this.drawnOn) return void this.refresh();
    const line = this.body.querySelector<HTMLElement>(".cal-now");
    if (line) line.style.top = `${(nowMinutes(new Date()) / 60) * HOUR}px`;
  }

  private async openJournal(day: Day) {
    const path = `Journal/${day}.md`;
    const r = await api.dailyNote(day).catch(() => null);
    this.hooks.open(r?.path ?? path);
  }
}
