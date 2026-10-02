// Rate limits: a counter per key in D1, whose window starts at its first hit. Every limited action is
// rare next to reads (a sign-in, an invite, an upload, a link card), so one D1 write each costs
// little, and D1 counts the same everywhere (production, Previews, local development and tests) over
// windows of any length.
import { json } from "../../src/core/api.ts";

const MINUTE = 60_000;

/** What's limited, and how much. The key says per whom. */
export const LIMITS = {
  signIn: { max: 60, per: 10 * MINUTE, message: "Too many sign-in attempts from your network." },
  invite: { max: 20, per: 60 * MINUTE, message: "That's a lot of invite links for one hour." },
  upload: { max: 120, per: 60 * MINUTE, message: "That's a lot of uploads for one hour." },
  unfurl: { max: 120, per: MINUTE, message: "Too many link previews at once." },
  workspace: { max: 10, per: 60 * MINUTE, message: "That's a lot of new workspaces for one hour." },
  register: { max: 20, per: 60 * MINUTE, message: "Too many apps registered from your network." },
  shareLink: { max: 300, per: 10 * MINUTE, message: "Too many shared-link requests from your network." },
  share: { max: 200, per: 60 * MINUTE, message: "That's a lot of sharing for one hour." },
  // Each subscription or refresh fetches a feed from somewhere else on the internet.
  calendar: { max: 60, per: 60 * MINUTE, message: "That's a lot of calendar subscribing and refreshing for one hour." },
  // Each one uploads a note to Google Drive, and a PDF takes Drive four calls.
  drive: { max: 60, per: 60 * MINUTE, message: "That's a lot of saving to Google Drive for one hour." },
} as const;

/**
 * Count one `action` by `who`. Returns a 429 to send back once they're over the limit, or null.
 * `as` picks the 429's form: JSON for the API, plain text for the sign-in pages.
 */
export async function limit(db: D1Database, action: keyof typeof LIMITS, who: string, as: "json" | "text" = "json"): Promise<Response | null> {
  const { max, per, message } = LIMITS[action];
  const now = Date.now();
  // SQLite computes every SET from the row as it was, so both columns see the old `started`.
  const row = await db
    .prepare(
      `INSERT INTO rate_limits(key, started, hits) VALUES (?1, ?2, 1) ON CONFLICT(key) DO UPDATE SET
         hits = CASE WHEN started <= ?2 - ?3 THEN 1 ELSE hits + 1 END,
         started = CASE WHEN started <= ?2 - ?3 THEN ?2 ELSE started END
       RETURNING hits, started`,
    )
    .bind(`${action}:${who}`, now, per)
    .first<{ hits: number; started: number }>();
  // Windows last an hour at most, so a day-old counter is dead. Clearing them now and then is enough.
  if (Math.random() < 0.01) await db.prepare("DELETE FROM rate_limits WHERE started < ?").bind(now - 86400_000).run();
  if (row!.hits <= max) return null;
  const wait = Math.ceil((row!.started + per - now) / 1000);
  const error = `${message} Try again in ${wait < 90 ? `${wait} seconds` : `${Math.ceil(wait / 60)} minutes`}.`;
  const res = as === "json" ? json({ error }, 429) : new Response(error, { status: 429, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  res.headers.set("Retry-After", String(wait));
  return res;
}
