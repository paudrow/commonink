// Saves of one note's whole text, one after another, for a view that edits a note it doesn't hold
// open in an editor (a board shown outside its note). No DOM: tested on its own.

/**
 * `push` queues a save of `text`; each runs after the last. A save that fails (the note changed
 * underneath, or the network did) is followed by `reload`, and the saves queued behind it are
 * dropped: they were made on text the reload replaced, and would write over the other change.
 */
export function saveChain(save: (text: string) => Promise<unknown>, reload: () => Promise<unknown>) {
  let queue: Promise<unknown> = Promise.resolve();
  let pending = 0;
  /** Counts the reloads: a save queued before one is stale. */
  let epoch = 0;
  return {
    /** How many saves are queued or on their way. */
    get pending() {
      return pending;
    },
    push(text: string): Promise<unknown> {
      pending++;
      const at = epoch;
      queue = queue
        .then(() => (at === epoch ? save(text) : undefined))
        .catch(() => {
          epoch++;
          return reload();
        })
        .finally(() => pending--);
      return queue;
    },
  };
}
