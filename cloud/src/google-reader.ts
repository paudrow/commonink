// How a workspace reads one person's Google calendar (a source of kind "google"). Google's events are
// kept as Google sent them (`google_events`), changed incrementally with its sync token, and handed to
// the calendar as iCalendar text, which expands them like any feed. Write-back adds a link to the
// meeting note to the event's description, and only when the person turned it on and granted it.
import type { SourceReader } from "../../src/core/calendar.ts";
import type { SqlDb } from "../../src/core/store.ts";
import { connectionInfo, googleApi } from "./connections.ts";
import type { Env } from "./env.ts";
import { eventsToIcs, GoogleError, instanceId, toGoogle, withNoteLink, type GoogleEvent } from "./google.ts";

/** Google syncs cheaply (only changes come back), so it's read more often than a feed. */
const EVERY = 10 * 60_000;

/** A Google error as words for the calendar's status line. */
const problem = (e: unknown) =>
  e instanceof Error && e.message.startsWith("feed:") ? e : new Error(`feed:Google Calendar: ${e instanceof GoogleError ? e.message : "couldn't be reached"}`);

export function googleReader(env: Env, db: SqlDb): SourceReader {
  /** Adding and changing events needs Google's edit scope, asked for the first time it's needed (as write-back asks). */
  const mayWrite = async (user: string) => {
    if (!(await connectionInfo(env, user))?.canWrite) throw new Error("feed:Allow Common Ink to edit your Google events first, then try again");
  };
  db.exec("CREATE TABLE IF NOT EXISTS google_events(source TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(source, id))");
  const kept = (source: string) => db.all<{ data: string }>("SELECT data FROM google_events WHERE source = ? ORDER BY id", source).map((r) => JSON.parse(r.data) as GoogleEvent);

  return {
    every: EVERY,

    async read(src) {
      const api = googleApi(env, src.owner!, db);
      const calendar = String(src.config.calendar);
      let token = (src.state.syncToken as string | undefined) ?? null;
      let got;
      try {
        got = await api.changes(calendar, token);
      } catch (e) {
        if (!(e instanceof GoogleError && e.status === 410)) throw problem(e);
        token = null; // the sync token expired: read everything again
        got = await api.changes(calendar, null).catch((e2) => Promise.reject(problem(e2)));
      }
      if (token && !got.events.length && src.fresh) return { status: "unchanged" };
      db.tx(() => {
        if (!token) db.run("DELETE FROM google_events WHERE source = ?", src.id);
        for (const e of got.events) {
          // A deleted event comes back cancelled with no series; a cancelled instance still cancels its slot.
          if (e.status === "cancelled" && !e.recurringEventId) db.run("DELETE FROM google_events WHERE source = ? AND id = ?", src.id, e.id);
          else db.run("INSERT INTO google_events(source, id, data) VALUES (?,?,?) ON CONFLICT(source, id) DO UPDATE SET data = excluded.data", src.id, e.id, JSON.stringify(e));
        }
      });
      const zone = got.zone ?? (src.state.zone as string | null) ?? null;
      return { status: "ok", text: eventsToIcs(kept(src.id), zone, got.name), state: { syncToken: got.syncToken, zone } };
    },

    writable: (src) => src.config.accessRole === undefined || src.config.accessRole === "owner" || src.config.accessRole === "writer",

    async createEvent(src, draft) {
      await mayWrite(src.owner!);
      try {
        const made = await googleApi(env, src.owner!, db).insert(String(src.config.calendar), toGoogle(draft));
        return { uid: made.iCalUID ?? made.id };
      } catch (e) {
        throw problem(e);
      }
    },

    async updateEvent(src, item, patch) {
      await mayWrite(src.owner!);
      const id = instanceId(kept(src.id), item.uid, item.instance);
      if (!id) throw new Error("feed:Google Calendar: that event isn't there any more");
      try {
        await googleApi(env, src.owner!, db).patch(String(src.config.calendar), id, toGoogle(patch));
      } catch (e) {
        throw problem(e);
      }
    },

    async deleteEvent(src, item) {
      await mayWrite(src.owner!);
      const id = instanceId(kept(src.id), item.uid, item.instance);
      if (!id) return;
      try {
        await googleApi(env, src.owner!, db).remove(String(src.config.calendar), id);
      } catch (e) {
        throw problem(e);
      }
    },

    removed(src) {
      db.run("DELETE FROM google_events WHERE source = ?", src.id);
    },

    async linkNote(src, item, url) {
      if (!(await connectionInfo(env, src.owner!))?.canWrite) throw new Error("feed:Allow Common Ink to edit your Google events first: turn on Link meeting notes in Calendars");
      const calendar = String(src.config.calendar);
      const id = instanceId(kept(src.id), item.uid, item.instance);
      if (!id) throw new Error("feed:Google Calendar: that event isn't there any more");
      const api = googleApi(env, src.owner!, db);
      try {
        const ev = await api.event(calendar, id);
        await api.patch(calendar, id, { description: withNoteLink(ev.description, url) });
      } catch (e) {
        throw problem(e);
      }
    },
  };
}
