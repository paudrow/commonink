// Google Calendar, online: whether this server has it, the person's connection, and the Calendars
// dialog's Google section. A person's Google calendars show only to them, in the workspaces they add
// them to. Common Ink reads them, and writes to one only to add a link to a meeting note, and only
// where its owner turned that on (write-back). Connecting leaves the app for Google (or, on Previews,
// its stand-in) and comes back to /calendar?google=<outcome> (main.ts).
import { api, ApiError, type CalendarSource, type GoogleCalendar, type GoogleStatus } from "../api.ts";
import { el, icon } from "../dom.ts";
import { toast } from "../toast.ts";
import { ask } from "../modal.ts";
import { calendarChanged, calendarWorkspace } from "./data.ts";

let loading: Promise<GoogleStatus | null> | null = null;
let known: GoogleStatus | null = null;

/** Google on this server, or null where it has none (the local app answers 404). */
export function googleStatus(): Promise<GoogleStatus | null> {
  if (!calendarWorkspace()) return Promise.resolve((known = null)); // the local app: no accounts, no Google
  loading ??= api.google().then(
    (s) => (known = s),
    (e) => {
      loading = null; // a failure isn't kept: the next ask tries again
      if (e instanceof ApiError && e.status === 404) return (known = null);
      throw e;
    },
  );
  return loading;
}
/** What the last answer said, for what can't wait for one (the palette). */
export const googleKnown = () => known;
/** The connection changed: ask again. */
export function googleChanged() {
  loading = null;
  void googleStatus().catch(() => null);
}

/** Where connecting starts; Google sends the person back to the Calendar in this workspace. `write` also asks to edit events. */
export const connectUrl = (write = false) => `/auth/google/calendar?w=${encodeURIComponent(calendarWorkspace())}${write ? "&write=1" : ""}`;

/** Where connecting Google Contacts starts; Google sends the person back to Contacts. `write` also asks to edit contacts. */
export const contactsConnectUrl = (write = false) => `/auth/google/calendar?for=contacts&w=${encodeURIComponent(calendarWorkspace())}${write ? "&write=1" : ""}`;

/** Disconnect Google, after asking: Calendar and Contacts both stop (Settings → Integrations). */
export async function disconnectGoogle() {
  const account = known?.connection?.account ?? "your Google account";
  const sure = await ask({
    title: "Disconnect Google?",
    body: [`Common Ink stops reading ${account}. Your Google calendars leave every workspace you added them to, and Contacts stops syncing. Meeting notes and contacts' notes stay.`],
    actions: [{ label: "Disconnect", value: "go", kind: "danger" }],
  });
  if (sure !== "go") return;
  try {
    await api.disconnectGoogle();
    toast({ icon: "calendar", text: "Google is disconnected" });
  } catch (e) {
    toast({ text: e instanceof ApiError ? e.message : "Couldn't disconnect Google", alert: true });
  }
  googleChanged();
  calendarChanged();
}

/** Leave the app for Google's consent page. An object, so tests can see where it would go. */
export const leave = { to: (url: string) => location.assign(url) };

const OUTCOMES: Record<string, string> = {
  connected: "Google Calendar is connected",
  denied: "Google Calendar wasn't connected: access wasn't allowed",
  failed: "Couldn't connect Google Calendar. Try again.",
};
/** What coming back from connecting (?google=…) says, or null for an address that isn't one. */
export const googleOutcome = (outcome: string | null) => (outcome && OUTCOMES[outcome]) || null;

/** Whether an error from writing back asks for permission to edit events. */
export const needsWrite = (error: string) => /^Allow Common Ink to edit/i.test(error);

/** This Google calendar's source here, if it's been added (the server names the calendar of one's own). */
const sourceOf = (cal: GoogleCalendar, sources: CalendarSource[]) => sources.find((s) => s.kind === "google" && s.calendar === cal.id);

const toggle = (label: string, on: boolean, run: () => void, extra: Record<string, string> = {}) =>
  el("button", { type: "button", role: "switch", class: "cal-switch", "aria-checked": String(on), onclick: run, ...extra }, el("span", { class: "cal-switch-track", "aria-hidden": "true" }), el("span", {}, label));

/**
 * The dialog's Google section. `render` draws it for the sources the dialog lists; `changed` runs
 * after anything here changes them (and draws the dialog again).
 */
export function googleSection(hooks: { changed(): Promise<void> }) {
  const body = el("div", { class: "cal-g-body" }, el("p", { class: "agents-empty" }, "Loading…"));
  const title = el("h3", { id: "cal-g-title", tabindex: "-1" }, icon("globe", 14), "Google Calendar");
  const root = el("section", { class: "cal-google", "aria-labelledby": "cal-g-title", hidden: true }, title, body);
  const failed = (e: unknown, what: string) => toast({ text: e instanceof Error ? e.message : what });
  const busy = async (what: string, run: () => Promise<unknown>) => {
    try {
      await run();
      await hooks.changed();
    } catch (e) {
      failed(e, what);
    }
  };

  const disconnect = async (account: string, drive: boolean) => {
    const sure = await ask({
      title: "Disconnect Google Calendar?",
      body: [`Common Ink stops reading ${account}, and your Google calendars leave every workspace you added them to. Meeting notes you made from their events stay.${drive ? " Saving notes to Google Drive stops too; what you saved there stays." : ""}`],
      actions: [{ label: "Disconnect", value: "go", kind: "danger" }],
    });
    if (sure !== "go") return;
    await busy("Couldn't disconnect Google Calendar", async () => {
      await api.disconnectGoogle();
      googleChanged();
      calendarChanged();
      toast({ icon: "calendar", text: "Google Calendar is disconnected" });
    });
  };

  /** Turn write-back on or off; without leave to edit events yet, Google asks for it first. */
  const writeBack = async (source: CalendarSource, on: boolean, canWrite: boolean) => {
    if (on && !canWrite) {
      const go = await ask({
        title: "Let Common Ink add links to your events?",
        body: ["Google will ask you to allow Common Ink to edit your events. It only adds a link to your meeting note to the event, never the note's text."],
        actions: [{ label: "Continue to Google", value: "go", kind: "primary" }],
      });
      if (go !== "go") return;
      try {
        await api.updateCalendar(source.id, { writeBack: true }); // on when they come back, if Google allows it
      } catch (e) {
        return failed(e, "Couldn't turn that on");
      }
      return leave.to(connectUrl(true));
    }
    await busy("Couldn't change that", () => api.updateCalendar(source.id, { writeBack: on }));
  };

  const row = (cal: GoogleCalendar, sources: CalendarSource[], canWrite: boolean) => {
    const source = sourceOf(cal, sources);
    const name = cal.summary || cal.id;
    return el(
      "div",
      { class: "cal-g-row", role: "listitem" },
      el("span", { class: "cal-g-name" }, name, cal.primary ? el("span", { class: "cal-d-tag" }, "Primary") : null),
      el(
        "div",
        { class: "cal-g-switches" },
        toggle("Show here", !!source, () => void busy(source ? "Couldn't take it off" : "Couldn't add it", () => (source ? api.unsubscribe(source.id) : api.addGoogleCalendar(cal.id, name, cal.accessRole))), { "aria-label": `Show ${name} here` }),
        source ? toggle("Link meeting notes", !!source.writeBack, () => void writeBack(source, !source.writeBack, canWrite), { "aria-label": `Link meeting notes to ${name}'s events` }) : null,
      ),
      source?.writeBack && !canWrite
        ? el("p", { class: "cal-g-hint" }, "Google hasn't allowed this yet. ", el("a", { href: connectUrl(true) }, "Allow it"))
        : null,
    );
  };

  async function render(sources: CalendarSource[]) {
    let status: GoogleStatus | null;
    try {
      status = await googleStatus();
    } catch {
      status = null;
    }
    root.hidden = !status;
    if (!status) return;
    title.replaceChildren(icon("globe", 14), "Google Calendar", status.mode === "mock" ? el("span", { class: "cal-g-demo" }, "(demo stand-in)") : "");
    if (status.mode === "off") return body.replaceChildren(el("p", { class: "cal-g-note" }, "Google isn't configured on this server"));
    const privacy = el("p", { class: "cal-g-note" }, icon("user", 13), "Your Google calendars show only to you here, not to others in this workspace.");
    const c = status.connection;
    if (!c?.calendar) {
      return body.replaceChildren(
        privacy,
        el("p", { class: "cal-g-note" }, "Common Ink reads them. Only if you turn it on for a calendar, it adds a link to your meeting note to the event, never the note's text."),
        el("a", { class: "qw-btn primary cal-g-connect", href: connectUrl() }, icon("calendar", 14), "Connect Google Calendar"),
      );
    }
    const account = el(
      "div",
      { class: "cal-g-account" },
      el("span", {}, "Connected as ", el("b", {}, c.account)),
      el("button", { type: "button", class: "qw-btn", onclick: () => void disconnect(c.account, c.drive) }, "Disconnect"),
    );
    let calendars: GoogleCalendar[];
    try {
      calendars = await api.googleCalendars();
    } catch (e) {
      return body.replaceChildren(account, el("p", { class: "cal-src-bad" }, e instanceof Error ? e.message : "Couldn't reach Google Calendar"));
    }
    body.replaceChildren(
      account,
      privacy,
      calendars.length
        ? el("div", { class: "cal-g-list", role: "list", "aria-label": "Your Google calendars" }, ...calendars.map((cal) => row(cal, sources, c.canWrite)))
        : el("p", { class: "cal-g-note" }, "Your Google account has no calendars."),
    );
  }

  return { root, render, focus: () => (root.scrollIntoView({ block: "nearest" }), title.focus()) };
}
