// Where a task goes from the quick-add bar (today's daily note, or the note the bar was opened
// from; `→ [[Note]]` beats both). No screen here, so it's tested in node.

/** Where the bar's task goes, and what to call it: the → [[Note]] in its words, else the note it was opened from (Tab), else today's daily note. */
export function targetOf(named: string | null, toNote: boolean, note: string | undefined, today: string): { label: string; to: string | undefined } {
  if (named) return { label: named, to: undefined };
  if (toNote && note) return { label: note.replace(/\.md$/, "").split("/").pop()!, to: note };
  return { label: `Journal/${today}`, to: undefined };
}
