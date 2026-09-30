// Saves of one note's whole text, one after another, for a view that edits a note it doesn't hold
// open in an editor (a board shown outside its note). No DOM: tested on its own.

/**
 * `push` queues a save of `text`; each runs after the last. A save that fails (the note changed
 * underneath, or the network did) is followed by `reload`.
 */
export function saveChain(save: (text: string) => Promise<unknown>, reload: () => Promise<unknown>) {
  let queue: Promise<unknown> = Promise.resolve();
  let pending = 0;
  return {
    /** How many saves are queued or on their way. */
    get pending() {
      return pending;
    },
    push(text: string): Promise<unknown> {
      pending++;
      queue = queue
        .then(() => save(text))
        .catch(() => reload())
        .finally(() => pending--);
      return queue;
    },
  };
}
