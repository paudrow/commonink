// Quick-add's pieces that don't need a screen: the Vim `:task` command, and where a task goes from
// the bar (today's daily note, or the note the bar was opened from; `→ [[Note]]` beats both).

interface Added {
  path: string;
  line: number;
  text: string;
}

/**
 * `:task <words>` adds the task straight away (the quick-add parser, the default target) and says
 * so with an Undo; a bare `:task` opens the bar instead.
 */
export async function runTaskCommand(
  args: string,
  deps: {
    add(text: string): Promise<Added>;
    remove(r: Added): Promise<void>;
    openBar(): void;
    toast(t: { text: string; actionLabel?: string; action?: () => void }): void;
  },
) {
  const text = args.trim();
  if (!text) return deps.openBar();
  const r = await deps.add(text);
  deps.toast({ text: `Added "- [ ] ${r.text}" to ${r.path.replace(/\.md$/, "")}`, actionLabel: "Undo", action: () => void deps.remove(r) });
}

/** Where the bar's task goes, and what to call it: the → [[Note]] in its words, else the note it was opened from (Tab), else today's daily note. */
export function targetOf(named: string | null, toNote: boolean, note: string | undefined, today: string): { label: string; to: string | undefined } {
  if (named) return { label: named, to: undefined };
  if (toNote && note) return { label: note.replace(/\.md$/, "").split("/").pop()!, to: note };
  return { label: `Journal/${today}`, to: undefined };
}
