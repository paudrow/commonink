// The text each change log row keeps from before its change (`changes.before`), stored compactly.
// A note's rows with a text form a chain, newest first. The newest row keeps its text whole; each
// older row keeps only a delta (delta.ts) from the next newer row's text, named by `base_id`. Every
// KEYFRAME_EVERY rows one stays whole, so reading any text applies at most that many deltas less
// one. Newest-whole makes the common reads (History's latest entries, restore, Undo) a single row.
import { applyDelta, makeDelta } from "./delta.ts";
import type { SqlDb } from "./store.ts";

/** At most this many rows in a row read through one whole text. Measured in bench/changelog.ts. */
export const KEYFRAME_EVERY = 64;

/** The text change #id kept from before it, or null. `seen` shares rebuilt texts between reads of one note's rows. */
export function readBefore(db: SqlDb, id: number, seen = new Map<number, string>()): string | null {
  const deltas: Array<{ id: number; before: string }> = [];
  let text: string | null = null;
  for (let at: number | null = id; text === null; ) {
    const hit = seen.get(at);
    if (hit !== undefined) {
      text = hit;
      break;
    }
    const row: { before: string | null; base_id: number | null } | undefined = db.get("SELECT before, base_id FROM changes WHERE id = ?", at);
    if (!row || row.before === null) return null;
    if (row.base_id === null) text = row.before;
    else {
      deltas.push({ id: at, before: row.before });
      at = row.base_id;
    }
  }
  for (let i = deltas.length - 1; i >= 0; i--) {
    text = applyDelta(text, deltas[i].before);
    seen.set(deltas[i].id, text);
  }
  seen.set(id, text);
  return text;
}

/**
 * Change #id was just written with its whole text: store the note's previous newest text as a
 * delta from it, unless that one is due to stay whole or the delta saves nothing.
 */
export function chainBefore(db: SqlDb, id: number, noteId: string | null) {
  if (!noteId) return;
  const text = db.get<{ before: string | null }>("SELECT before FROM changes WHERE id = ?", id)?.before;
  if (text == null) return;
  const prev = db.get<{ id: number; before: string; base_id: number | null }>(
    "SELECT id, before, base_id FROM changes WHERE note_id = ? AND id < ? AND before IS NOT NULL ORDER BY id DESC LIMIT 1",
    noteId, id,
  );
  if (!prev || prev.base_id !== null || runBehind(db, noteId, prev.id) >= KEYFRAME_EVERY) return;
  const delta = makeDelta(text, prev.before);
  if (delta.length < prev.before.length) db.run("UPDATE changes SET before = ?, base_id = ? WHERE id = ?", delta, id, prev.id);
}

/** How many of a note's rows read through row #id's whole text: it, and the deltas just older than it. */
function runBehind(db: SqlDb, noteId: string, id: number): number {
  const whole = db.get<{ id: number | null }>(
    "SELECT max(id) AS id FROM changes WHERE note_id = ? AND id < ? AND before IS NOT NULL AND base_id IS NULL",
    noteId, id,
  )?.id ?? 0;
  return db.get<{ n: number }>("SELECT count(*) AS n FROM changes WHERE note_id = ? AND id > ? AND id <= ? AND before IS NOT NULL", noteId, whole, id)!.n;
}

/** Forget the texts of the rows `where` picks. A row outside them whose delta reads through one keeps its text whole. */
export function dropBefores(db: SqlDb, where: string, ...args: unknown[]) {
  db.tx(() => {
    const gone = new Set(db.all<{ id: number }>(`SELECT id FROM changes WHERE ${where}`, ...args).map((r) => r.id));
    const seen = new Map<number, string>();
    for (const id of gone) {
      for (const r of db.all<{ id: number }>("SELECT id FROM changes WHERE base_id = ?", id)) {
        if (!gone.has(r.id)) db.run("UPDATE changes SET before = ?, base_id = NULL WHERE id = ?", readBefore(db, r.id, seen), r.id);
      }
    }
    for (const id of gone) db.run("UPDATE changes SET before = NULL, base_id = NULL WHERE id = ?", id);
  });
}

/**
 * Store a note's older texts as deltas, newest first, the way chainBefore stores new ones. For a
 * change log from before deltas: each note in its own transaction, so an upgrade that stops
 * partway keeps what it finished, and the next run picks up the rest.
 */
export function compactNote(db: SqlDb, noteId: string) {
  db.tx(() => {
    const rows = db.all<{ id: number; before: string; base_id: number | null }>(
      "SELECT id, before, base_id FROM changes WHERE note_id = ? AND before IS NOT NULL ORDER BY id DESC",
      noteId,
    );
    const seen = new Map<number, string>();
    let newer: { id: number; text: string } | null = null;
    let behind = 0;
    for (const r of rows) {
      const text = r.base_id === null ? r.before : readBefore(db, r.id, seen)!;
      seen.set(r.id, text);
      if (r.base_id !== null) behind++;
      else if (newer && behind < KEYFRAME_EVERY - 1) {
        const delta = makeDelta(newer.text, text);
        if (delta.length < text.length) {
          db.run("UPDATE changes SET before = ?, base_id = ? WHERE id = ?", delta, newer.id, r.id);
          behind++;
        } else behind = 0;
      } else behind = 0;
      newer = { id: r.id, text };
    }
  });
}
