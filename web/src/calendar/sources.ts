// The Calendars dialog: the calendars the workspace subscribes to, and your own Google calendars
// here, with their color, where they come from and how their last read went. Editors subscribe to
// an ICS or webcal link; anyone can add their Google calendars (google.ts) and refresh. Each row
// says whether this person may rename, recolor and remove it.
import { api } from "../api.ts";
import { el, icon, timeAgo } from "../dom.ts";
import { toast } from "../toast.ts";
import { ask } from "../trash.ts";
import { calendarChanged, calendars, canEditCalendars, COLORS, type CalendarSource, type SourceColor } from "./data.ts";
import { dot } from "./ui.ts";
import { googleSection } from "./google.ts";

const FOCUSABLE = "button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex='-1'])";

let closeOpen: (() => void) | null = null;

/**
 * Open the dialog (closing one that's open). `subscribe` puts the cursor in the link field, `google`
 * on the Google section. `changed` runs after anything changes.
 */
export function openCalendars(opts: { subscribe?: boolean; google?: boolean; changed(): void }) {
  closeOpen?.();
  const canEdit = canEditCalendars();
  const back = document.activeElement as HTMLElement | null;
  const list = el("div", { class: "cal-src-list", role: "list", "aria-label": "Calendars" }, el("p", { class: "agents-empty" }, "Loading…"));
  const failed = (e: unknown, what: string) => toast({ text: e instanceof Error ? e.message : what });
  const changed = async () => {
    calendarChanged();
    opts.changed();
    await render();
  };
  const google = googleSection({ changed });

  // ---------------------------------------------------------------- subscribe
  const url = el("input", { class: "ws-input cal-src-url", type: "url", placeholder: "https://… or webcal://…", "aria-label": "Calendar link (ICS or webcal)", spellcheck: "false", autocomplete: "off" });
  const name = el("input", { class: "ws-input", placeholder: "Name (optional)", "aria-label": "Name (optional)", maxlength: "80" });
  const problem = el("p", { class: "cal-src-error", role: "alert" });
  const go = el("button", { type: "submit", class: "qw-btn primary" }, "Subscribe");
  const form = el(
    "form",
    { class: "cal-src-form" },
    el("div", { class: "cal-src-inputs" }, url, name, go),
    problem,
    el("p", { class: "cal-src-note" }, icon("info", 13), "Everyone in this workspace sees the calendars added here."),
  );
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!url.value.trim()) return url.focus();
    problem.textContent = "";
    go.disabled = url.disabled = name.disabled = true;
    go.textContent = "Reading the feed…";
    try {
      const s = await api.subscribe(url.value.trim(), name.value.trim() || undefined);
      url.value = name.value = "";
      toast({ icon: "calendar", text: s.status === "error" ? `Added ${s.name}, but ${s.error ?? "it couldn't be read"}` : `Subscribed to ${s.name}` });
      await changed();
    } catch (err) {
      problem.textContent = err instanceof Error ? err.message : "Couldn't subscribe to that link";
    } finally {
      go.disabled = url.disabled = name.disabled = false;
      go.textContent = "Subscribe";
      if (problem.textContent) url.focus();
    }
  });

  // ---------------------------------------------------------------- the list
  const status = (s: CalendarSource) => {
    if (s.status === "error") return el("span", { class: "cal-src-bad" }, s.error ?? "Couldn't read it");
    if (s.status === "pending" || !s.syncedAt) return el("span", {}, "Not read yet");
    return el("span", {}, `Updated ${timeAgo(s.syncedAt)} · ${s.events} ${s.events === 1 ? "event" : "events"}`);
  };

  const row = (s: CalendarSource): HTMLElement => {
    const swatches = el("div", { class: "cal-swatches", role: "group", "aria-label": `Color for ${s.name}`, hidden: true });
    const setColor = async (color: SourceColor) => {
      try {
        await api.updateCalendar(s.id, { color });
        await changed();
      } catch (e) {
        failed(e, "Couldn't change the color");
      }
    };
    swatches.append(...COLORS.map((c) => el("button", { type: "button", class: "cal-swatch", title: c[0].toUpperCase() + c.slice(1), "aria-pressed": String(c === s.color), onclick: () => void setColor(c) }, dot(c))));
    const colorBtn = s.editable
      ? el("button", { type: "button", class: "cal-src-color", title: "Change color", "aria-label": `Change the color of ${s.name}`, "aria-expanded": "false", onclick: () => {
          swatches.hidden = !swatches.hidden;
          colorBtn.setAttribute("aria-expanded", String(!swatches.hidden));
          if (!swatches.hidden) swatches.querySelector<HTMLElement>("[aria-pressed=true]")?.focus();
        } }, dot(s.color))
      : dot(s.color, "cal-dot cal-src-color");
    const title = el("span", { class: "cal-src-name" }, s.name);
    return el(
      "div",
      { class: "cal-src", role: "listitem", "data-id": s.id },
      el(
        "div",
        { class: "cal-src-row" },
        colorBtn,
        el(
          "div",
          { class: "cal-src-main" },
          title,
          el(
            "span",
            { class: "cal-src-meta" },
            ...(s.owner ? [el("span", { class: "cal-src-mine", title: "Only you see this calendar" }, icon("lock", 11), "Only you"), " · "] : []),
            ...(s.kind === "google" ? ["Google Calendar · "] : s.host ? [s.host, " · "] : []),
            status(s),
          ),
        ),
        el("button", { type: "button", class: "icon-btn small", title: "Refresh", "aria-label": `Refresh ${s.name}`, onclick: () => void refresh(s.id) }, icon("reset", 14)),
        s.editable ? el("button", { type: "button", class: "icon-btn small", title: "Rename", "aria-label": `Rename ${s.name}`, onclick: () => rename(s, title) }, icon("edit", 14)) : null,
        s.editable ? el("button", { type: "button", class: "icon-btn small", title: "Remove", "aria-label": `Remove ${s.name}`, onclick: () => void remove(s) }, icon("trash", 14)) : null,
      ),
      s.editable ? swatches : null,
    );
  };

  const rename = (s: CalendarSource, title: HTMLElement) => {
    const input = el("input", { class: "tag-rename", value: s.name, maxlength: "80", "aria-label": `New name for ${s.name}` });
    title.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = async (save: boolean) => {
      if (done) return;
      done = true;
      const next = input.value.trim();
      if (save && next && next !== s.name) {
        try {
          await api.updateCalendar(s.id, { name: next });
          return void (await changed());
        } catch (e) {
          failed(e, "Couldn't rename it");
        }
      }
      input.replaceWith(title);
    };
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") void finish(true);
      if (e.key === "Escape") void finish(false);
    });
    input.addEventListener("blur", () => void finish(false));
  };

  const refresh = async (id?: string) => {
    try {
      await api.refreshCalendars(id);
      await changed();
    } catch (e) {
      failed(e, "Couldn't refresh");
    }
  };

  const remove = async (s: CalendarSource) => {
    const sure = await ask({
      title: `Remove ${s.name}?`,
      body: [s.owner ? "Its events leave this workspace's calendar. Meeting notes made from them stay." : "Its events leave the calendar for everyone in this workspace. Meeting notes made from them stay."],
      actions: [{ label: "Remove", value: "remove", kind: "danger" }],
    });
    if (sure !== "remove") return;
    try {
      await api.unsubscribe(s.id);
      toast({ icon: "trash", text: `Removed ${s.name}` });
      await changed();
    } catch (e) {
      failed(e, "Couldn't remove it");
    }
  };

  const empty = () =>
    el(
      "div",
      { class: "cal-src-empty" },
      el("p", {}, "No calendars yet. A calendar app can share any calendar as a link to an ", el("b", {}, "ICS"), " file (a ", el("b", {}, "webcal"), " link is the same thing). Paste one here and its events show up in Common Ink, read again every half hour."),
      el(
        "ul",
        {},
        el("li", {}, el("b", {}, "Google Calendar: "), "Settings, pick the calendar, then “Secret address in iCal format”."),
        el("li", {}, el("b", {}, "Outlook: "), "Settings, Calendar, Shared calendars, “Publish a calendar”, then the ICS link."),
        el("li", {}, el("b", {}, "Apple Calendar: "), "share the calendar and turn on “Public Calendar”, then copy its link."),
      ),
      canEdit ? null : el("p", {}, "Only editors can add calendars to this workspace."),
    );

  async function render() {
    let all: CalendarSource[];
    try {
      all = await calendars();
    } catch (e) {
      list.replaceChildren(el("p", { class: "cal-src-bad" }, e instanceof Error ? e.message : "Couldn't load the calendars"));
      return;
    }
    const had = list.contains(document.activeElement) ? (document.activeElement?.closest(".cal-src")?.getAttribute("data-id") ?? null) : null;
    list.replaceChildren(...(all.length ? all.map(row) : [empty()]));
    refreshAll.hidden = all.length < 2;
    if (had) [...list.querySelectorAll<HTMLElement>(".cal-src")].find((n) => n.dataset.id === had)?.querySelector("button")?.focus();
    await google.render(all);
  }

  // ---------------------------------------------------------------- the dialog
  const refreshAll = el("button", { type: "button", class: "qw-btn", hidden: true, onclick: () => void refresh() }, icon("reset", 14), "Refresh all");
  const close = () => {
    page.remove();
    document.removeEventListener("keydown", onKey, true);
    closeOpen = null;
    if (back?.isConnected) back.focus({ preventScroll: true });
  };
  const onKey = (e: KeyboardEvent) => {
    if (document.querySelector(".ask")) return; // the Remove question has the keys
    if (e.key === "Escape" && !(e.target as Element).closest?.(".tag-rename")) {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "Tab") {
      const stops = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => !n.closest("[hidden]"));
      const at = stops.indexOf(document.activeElement as HTMLElement);
      const next = e.shiftKey ? (at <= 0 ? stops.length - 1 : at - 1) : at === stops.length - 1 ? 0 : at + 1;
      e.preventDefault();
      stops[next]?.focus();
    }
  };
  const box = el(
    "div",
    { class: "agents-box cal-src-box", role: "dialog", "aria-modal": "true", "aria-labelledby": "cal-src-title", tabindex: "-1" },
    el("div", { class: "agents-head" }, icon("calendar", 16), el("h2", { id: "cal-src-title" }, "Calendars"), el("button", { class: "icon-btn small", type: "button", title: "Close (Esc)", "aria-label": "Close", onclick: close }, icon("close", 15))),
    canEdit ? form : null,
    list,
    el("div", { class: "cal-src-foot" }, refreshAll),
    google.root,
  );
  const page = el("div", { id: "agents-page", class: "cal-src-page", onmousedown: (e: Event) => e.target === page && close() }, box);
  document.addEventListener("keydown", onKey, true);
  document.body.append(page);
  closeOpen = close;
  (canEdit && opts.subscribe ? url : box).focus();
  void render().then(() => opts.google && page.isConnected && google.focus());
}
