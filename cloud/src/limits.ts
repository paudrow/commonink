// Rate limits: a counter per key in D1, whose window starts at its first hit. Every limited action is
// rare next to reads (a sign-in, an invite, an upload, a link card), so one D1 write each costs
// little, and D1 counts the same everywhere (production, Previews, local development and tests) over
// windows of any length.
import { json } from "../../src/core/api.ts";

const MINUTE = 60_000;

/** What's limited, and how much. The key says per whom. */
export const LIMITS = {
  signIn: { max: 60, per: 10 * MINUTE, message: "Too many sign-in attempts from your network." },
  // With sign-up open, new accounts per address, so one network can't make them by the hundred.
  signUp: { max: 10, per: 60 * MINUTE, message: "That's a lot of new accounts from your network." },
  invite: { max: 20, per: 60 * MINUTE, message: "That's a lot of invite links for one hour." },
  upload: { max: 120, per: 60 * MINUTE, message: "That's a lot of uploads for one hour." },
  unfurl: { max: 120, per: MINUTE, message: "Too many link previews at once." },
  workspace: { max: 10, per: 60 * MINUTE, message: "That's a lot of new workspaces for one hour." },
  register: { max: 20, per: 60 * MINUTE, message: "Too many apps registered from your network." },
  shareLink: { max: 300, per: 10 * MINUTE, message: "Too many tries at links that don't work from your network." },
  share: { max: 200, per: 60 * MINUTE, message: "That's a lot of sharing for one hour." },
  // Each subscription, refresh or Google calendar added fetches a calendar from somewhere else.
  calendar: { max: 60, per: 60 * MINUTE, message: "That's a lot of calendar subscribing and refreshing for one hour." },
  // Each one uploads a note to Google Drive, and a PDF takes Drive four calls.
  drive: { max: 60, per: 60 * MINUTE, message: "That's a lot of saving to Google Drive for one hour." },
} as const;

/**
 * Workspace routes limited per person, whichever way they come: the app's API (index.ts) or a CLI
 * command (cli.ts) with that route. (Shares are counted in the workspace, invites in admin.ts.)
 */
export const ROUTE_LIMITS: Record<string, keyof typeof LIMITS> = {
  "POST /upload": "upload",
  "POST /calendar/sources": "calendar",
  "POST /calendar/refresh": "calendar",
  // Open to viewers, and each one reads the whole calendar from Google on the app's quota.
  "POST /calendar/google": "calendar",
  // Each sync asks Google, as a calendar refresh does, so they share its budget.
  "POST /contacts/google/sync": "calendar",
};

/**
 * Count one `action` by `who`. Returns a 429 to send back once they're over the limit, or null.
 * `as` picks the 429's form: JSON for the API, plain text for the sign-in pages.
 */
export async function limit(db: D1Database, action: keyof typeof LIMITS, who: string, as: "json" | "text" = "json"): Promise<Response | null> {
  const now = Date.now();
  // SQLite computes every SET from the row as it was, so both columns see the old `started`.
  const row = await db
    .prepare(
      `INSERT INTO rate_limits(key, started, hits) VALUES (?1, ?2, 1) ON CONFLICT(key) DO UPDATE SET
         hits = CASE WHEN started <= ?2 - ?3 THEN 1 ELSE hits + 1 END,
         started = CASE WHEN started <= ?2 - ?3 THEN ?2 ELSE started END
       RETURNING hits, started`,
    )
    .bind(`${action}:${who}`, now, LIMITS[action].per)
    .first<{ hits: number; started: number }>();
  // Windows last an hour at most, so a day-old counter is dead. Clearing them now and then is enough.
  if (Math.random() < 0.01) await db.prepare("DELETE FROM rate_limits WHERE started < ?").bind(now - 86400_000).run();
  return refusal(action, row!, now, as);
}

/** Whether `who` is over the limit for `action` already, without counting this as one: the 429 if so. */
export async function limited(db: D1Database, action: keyof typeof LIMITS, who: string): Promise<Response | null> {
  const now = Date.now();
  const row = await db.prepare("SELECT hits, started FROM rate_limits WHERE key = ? AND started > ?").bind(`${action}:${who}`, now - LIMITS[action].per).first<{ hits: number; started: number }>();
  return row ? refusal(action, row, now, "json") : null;
}

function refusal(action: keyof typeof LIMITS, row: { hits: number; started: number }, now: number, as: "json" | "text") {
  const { max, per, message } = LIMITS[action];
  if (row.hits <= max) return null;
  const wait = Math.ceil((row.started + per - now) / 1000);
  const error = `${message} Try again in ${wait < 90 ? `${wait} seconds` : `${Math.ceil(wait / 60)} minutes`}.`;
  const res = as === "json" ? json({ error }, 429) : new Response(error, { status: 429, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  res.headers.set("Retry-After", String(wait));
  return res;
}
