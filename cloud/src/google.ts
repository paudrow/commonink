// Google Calendar, read into the same shape as an ICS feed: its events come back as JSON, become
// VEVENTs, and src/core/ics.ts expands them like any other feed, so recurrence, exceptions and time
// zones work one way everywhere. Syncing is incremental: the first read lists every event, later
// reads send the sync token Google gave last time and get only what changed. No Workers imports, so
// tests run this against a fake Google.

export const GOOGLE = {
  auth: "https://accounts.google.com/o/oauth2/v2/auth",
  token: "https://oauth2.googleapis.com/token",
  revoke: "https://oauth2.googleapis.com/revoke",
  api: "https://www.googleapis.com/calendar/v3",
};
export type GoogleEndpoints = typeof GOOGLE;

export type GoogleMode = "real" | "mock" | "off";

/** Real Google when it's configured; the stand-in (google-mock.ts) only where developer sign-in is on, which production never is. */
export function googleMode(env: { GOOGLE_CLIENT_ID?: string; GOOGLE_CLIENT_SECRET?: string; INTEGRATIONS_KEY?: string; DEV_LOGIN?: string }): GoogleMode {
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.INTEGRATIONS_KEY) return "real";
  return env.DEV_LOGIN === "1" ? "mock" : "off";
}

export const SCOPES = {
  read: "https://www.googleapis.com/auth/calendar.readonly",
  write: "https://www.googleapis.com/auth/calendar.events",
};

/** The parts of a Google Calendar event we read (https://developers.google.com/calendar/api/v3/reference/events). */
export interface GoogleEvent {
  id: string;
  iCalUID?: string;
  status?: "confirmed" | "tentative" | "cancelled";
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  start?: GoogleTime;
  end?: GoogleTime;
  recurrence?: string[];
  recurringEventId?: string;
  originalStartTime?: GoogleTime;
  organizer?: { email?: string; displayName?: string };
  attendees?: Array<{ email?: string; displayName?: string; responseStatus?: string }>;
}
export interface GoogleTime {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

export interface GoogleCalendar {
  id: string;
  summary: string;
  primary: boolean;
  accessRole: "owner" | "writer" | "reader" | "freeBusyReader";
  timeZone: string | null;
}

/** What syncing needs from Google: the real API (GoogleClient) or, on Previews, a stand-in (google-mock.ts). */
export interface GoogleApi {
  calendars(): Promise<GoogleCalendar[]>;
  /** Events changed since `syncToken` (every event, without one), the token for next time, and the calendar's zone. A 410 means start again without a token. */
  changes(calendar: string, syncToken: string | null): Promise<{ events: GoogleEvent[]; syncToken: string; zone: string | null; name: string | null }>;
  event(calendar: string, eventId: string): Promise<GoogleEvent>;
  /** Set an event's description, and nothing else about it. */
  describe(calendar: string, eventId: string, description: string): Promise<void>;
}

/** An error from Google, with its status (401: the token is no good; 410: the sync token expired). */
export class GoogleError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

// ------------------------------------------------------------------ events as iCalendar

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const param = (s: string) => `"${s.replace(/["\r\n]/g, "")}"`;
const oneLine = (s: string) => s.replace(/[\r\n]/g, "");
const PARTSTAT: Record<string, string> = { accepted: "ACCEPTED", declined: "DECLINED", tentative: "TENTATIVE" };

/** A time as a DTSTART-style property: all day, as a wall time in its zone, or in UTC. */
function timeProp(name: string, t: GoogleTime | undefined, zone: string | null): string | null {
  if (!t) return null;
  if (t.date && /^\d{4}-\d{2}-\d{2}$/.test(t.date)) return `${name};VALUE=DATE:${t.date.replace(/-/g, "")}`;
  const at = t.dateTime ? Date.parse(t.dateTime) : NaN;
  if (Number.isNaN(at)) return null;
  const tz = t.timeZone ?? zone;
  if (tz) {
    try {
      const p = Object.fromEntries(
        new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
          .formatToParts(at)
          .map((x) => [x.type, x.value]),
      );
      return `${name};TZID=${oneLine(tz)}:${p.year}${p.month}${p.day}T${p.hour}${p.minute}${p.second}`;
    } catch {}
  }
  return `${name}:${new Date(at).toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "")}`;
}

/**
 * Google's events for one calendar as an iCalendar feed; `zone` is the calendar's own. A series keeps
 * its RRULE and EXDATEs, and each changed or cancelled instance becomes an override of it.
 */
export function eventsToIcs(events: GoogleEvent[], zone: string | null, name: string | null = null): string {
  const out = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Common Ink//Google Calendar//EN", ...(name ? [`X-WR-CALNAME:${esc(name)}`] : [])];
  for (const e of events) {
    const start = timeProp("DTSTART", e.start, zone);
    const instanceOf = e.recurringEventId ? timeProp("RECURRENCE-ID", e.originalStartTime, zone) : null;
    // A deleted one-off has no start: there's nothing to show. A cancelled instance still cancels its slot.
    if (!start && !instanceOf) continue;
    const lines = [
      "BEGIN:VEVENT",
      `UID:${esc(e.iCalUID ?? e.id)}`,
      start ?? instanceOf!.replace("RECURRENCE-ID", "DTSTART"),
      timeProp("DTEND", e.end, zone),
      instanceOf,
      ...(e.recurringEventId ? [] : (e.recurrence ?? []).filter((r) => /^(RRULE|EXDATE|RDATE)[:;]/i.test(r)).map(oneLine)),
      `STATUS:${(e.status ?? "confirmed").toUpperCase()}`,
      e.summary !== undefined ? `SUMMARY:${esc(e.summary)}` : null,
      e.location ? `LOCATION:${esc(e.location)}` : null,
      e.description ? `DESCRIPTION:${esc(e.description)}` : null,
      e.htmlLink ? `URL:${oneLine(e.htmlLink)}` : null,
      e.organizer?.email ? `ORGANIZER${e.organizer.displayName ? `;CN=${param(e.organizer.displayName)}` : ""}:mailto:${oneLine(e.organizer.email)}` : null,
      ...(e.attendees ?? [])
        .filter((a) => a.email)
        .map((a) => `ATTENDEE${a.displayName ? `;CN=${param(a.displayName)}` : ""};PARTSTAT=${PARTSTAT[a.responseStatus ?? ""] ?? "NEEDS-ACTION"}:mailto:${oneLine(a.email!)}`),
      "END:VEVENT",
    ];
    out.push(...lines.filter((l): l is string => l !== null));
  }
  out.push("END:VCALENDAR", "");
  return out.join("\r\n");
}

/**
 * Google's ID for one instance of an event: the event's own ID for a one-off, else the series' ID
 * and the instance's original start ("abc_20261005T163000Z", "abc_20261005" all day).
 */
export function instanceId(events: GoogleEvent[], uid: string, instance: string | null): string | null {
  const same = events.filter((e) => (e.iCalUID ?? e.id) === uid);
  if (!instance) return same.find((e) => !e.recurringEventId)?.id ?? null;
  const series = same.find((e) => !e.recurringEventId);
  const override = same.find((e) => e.recurringEventId && e.id.endsWith(`_${instance}`));
  return override?.id ?? (series ? `${series.id}_${instance}` : null);
}

// ------------------------------------------------------------------ writing back

const MARK = "\u2014 Common Ink \u2014";

/**
 * An event's description with a link to its meeting note in a block of our own at the end. The block
 * is replaced, not added to, so linking again changes nothing. The note's text never goes to Google.
 */
export function withNoteLink(description: string | undefined, url: string): string {
  const text = description ?? "";
  const at = text.startsWith(`${MARK}\n`) ? 0 : text.indexOf(`\n\n${MARK}\n`);
  const base = (at < 0 ? text : text.slice(0, at)).replace(/\s+$/, "");
  const block = `${MARK}\nMeeting notes: ${url}`;
  return base ? `${base}\n\n${block}` : block;
}

// ------------------------------------------------------------------ the API

export class GoogleClient implements GoogleApi {
  constructor(
    private token: () => Promise<string>,
    private endpoints: GoogleEndpoints = GOOGLE,
    private fetcher: typeof fetch = (...a) => fetch(...a),
  ) {}

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await this.fetcher(`${this.endpoints.api}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${await this.token()}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    if (!res.ok) throw new GoogleError(data.error?.message ?? `Google answered ${res.status}`, res.status);
    return data as T;
  }

  async calendars(): Promise<GoogleCalendar[]> {
    const out: GoogleCalendar[] = [];
    let page: string | undefined;
    do {
      const r = await this.call<{ items?: Array<Record<string, any>>; nextPageToken?: string }>(`/users/me/calendarList?maxResults=250${page ? `&pageToken=${encodeURIComponent(page)}` : ""}`);
      for (const c of r.items ?? []) {
        out.push({ id: String(c.id), summary: String(c.summaryOverride ?? c.summary ?? c.id), primary: !!c.primary, accessRole: c.accessRole, timeZone: c.timeZone ?? null });
      }
      page = r.nextPageToken;
    } while (page && out.length < 1000);
    return out;
  }

  async changes(calendar: string, syncToken: string | null) {
    const events: GoogleEvent[] = [];
    let zone: string | null = null;
    let name: string | null = null;
    let page: string | undefined;
    for (let i = 0; i < 40; i++) {
      const q = new URLSearchParams({ maxResults: "2500", showDeleted: "true" });
      if (syncToken) q.set("syncToken", syncToken);
      if (page) q.set("pageToken", page);
      const r = await this.call<{ items?: GoogleEvent[]; nextPageToken?: string; nextSyncToken?: string; timeZone?: string; summary?: string }>(`/calendars/${encodeURIComponent(calendar)}/events?${q}`);
      events.push(...(r.items ?? []));
      zone = r.timeZone ?? zone;
      name = r.summary ?? name;
      if (r.nextSyncToken) return { events, syncToken: r.nextSyncToken, zone, name };
      page = r.nextPageToken;
      if (!page) break;
    }
    throw new GoogleError("Google didn't finish listing the calendar's events", 502);
  }

  event(calendar: string, eventId: string) {
    return this.call<GoogleEvent>(`/calendars/${encodeURIComponent(calendar)}/events/${encodeURIComponent(eventId)}`);
  }

  async describe(calendar: string, eventId: string, description: string) {
    await this.call(`/calendars/${encodeURIComponent(calendar)}/events/${encodeURIComponent(eventId)}`, { method: "PATCH", body: JSON.stringify({ description }) });
  }
}

// ------------------------------------------------------------------ tokens

export interface Grant {
  access: string;
  refresh: string | null;
  expiresAt: number;
  scopes: string[];
  /** The Google account's address, when Google said (the first grant). */
  email: string | null;
}

interface TokenReply {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
}

async function tokenCall(fields: Record<string, string>, endpoints: GoogleEndpoints, fetcher: typeof fetch): Promise<TokenReply> {
  const res = await fetcher(endpoints.token, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json().catch(() => ({}))) as TokenReply;
  if (!res.ok || !data.access_token) throw new GoogleError(data.error_description ?? data.error ?? `Google answered ${res.status}`, res.status);
  return data;
}

/** The address in an ID token Google just handed us over TLS (so its signature needn't be checked here). */
function emailOf(idToken: string | undefined): string | null {
  try {
    const body = idToken?.split(".")[1];
    if (!body) return null;
    const claims = JSON.parse(atob(body.replace(/-/g, "+").replace(/_/g, "/"))) as { email?: string; email_verified?: boolean };
    return claims.email_verified === false ? null : (claims.email ?? null);
  } catch {
    return null;
  }
}

const grantOf = (r: TokenReply, now: number, refresh: string | null): Grant => ({
  access: r.access_token!,
  refresh: r.refresh_token ?? refresh,
  expiresAt: now + (r.expires_in ?? 3600) * 1000,
  scopes: (r.scope ?? "").split(/\s+/).filter(Boolean),
  email: emailOf(r.id_token),
});

export interface OAuthClient {
  id: string;
  secret: string;
  redirect: string;
}

/** Trade the code from Google's consent page for tokens. */
export async function exchangeCode(client: OAuthClient, code: string, verifier: string, endpoints = GOOGLE, fetcher: typeof fetch = (...a) => fetch(...a), now = Date.now()): Promise<Grant> {
  const r = await tokenCall({ grant_type: "authorization_code", code, code_verifier: verifier, client_id: client.id, client_secret: client.secret, redirect_uri: client.redirect }, endpoints, fetcher);
  return grantOf(r, now, null);
}

/** A new access token from the refresh token. A 400 with invalid_grant means the person revoked access. */
export async function refreshGrant(client: Omit<OAuthClient, "redirect">, refresh: string, endpoints = GOOGLE, fetcher: typeof fetch = (...a) => fetch(...a), now = Date.now()): Promise<Grant> {
  const r = await tokenCall({ grant_type: "refresh_token", refresh_token: refresh, client_id: client.id, client_secret: client.secret }, endpoints, fetcher);
  return grantOf(r, now, refresh);
}

/** Tell Google to forget the grant (revoking the refresh token revokes its access tokens too). Best effort. */
export async function revokeGrant(token: string, endpoints = GOOGLE, fetcher: typeof fetch = (...a) => fetch(...a)): Promise<boolean> {
  try {
    const res = await fetcher(endpoints.revoke, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token }), signal: AbortSignal.timeout(10_000) });
    return res.ok;
  } catch {
    return false;
  }
}
