// The quick-add bar: type a task the way you'd say it and press Enter. It's the task input every
// place a task is typed uses (taskInput.ts): phrases light up, the chips below show what will be
// written, and a click on a lit phrase keeps it as words. The same parser (src/core/quickAdd.ts)
// runs here as you type and on the server when the task is written. Opened from a note, Tab
// switches where the task goes between today's daily note and that note.
import { api } from "./api.ts";
import { el, icon } from "./dom.ts";
import { today } from "./taskChips.ts";
import { targetOf } from "./taskCommand.ts";
import { HINT, taskInput, type TaskInput } from "./taskInput.ts";

export interface QuickAddOptions {
  /** A task was written: where it went. */
  added(r: { path: string; line: number; text: string }): void;
  /** Open a note (the "Added to …" link). */
  open(path: string, line?: number): void;
  /** Escape out of the bar (the floating one closes). */
  escape?(): void;
  /** The note it was opened from: Tab sends the task there instead of today's daily note. */
  note?: string;
}

/** The shortcut that opens the bar from anywhere, the editor included: ⌘⇧. (Ctrl+Shift+. elsewhere). */
export const SHORTCUT = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘⇧." : "Ctrl+Shift+.";
export const isQuickAddKey = (e: KeyboardEvent) => (e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && e.code === "Period";

/** A quick-add bar; focus it with the returned `focus`. */
export function quickAddBar(opts: QuickAddOptions): { root: HTMLElement; focus(): void; destroy(): void } {
  /** What the bar last did ("Added to …"), until you type again. */
  let status: HTMLElement | null = null;
  let toNote = false;
  let input!: TaskInput; // set just below; the input draws its preview (and so the target) as it's made

  const where = () => targetOf(input?.parsed()?.target ?? null, toNote, opts.note, today());
  const targetChip = opts.note
    ? el("button", { type: "button", class: "qa-target", title: "Where it goes (Tab switches)", onmousedown: (e: Event) => e.preventDefault(), onclick: () => toggleTarget() })
    : null;
  const drawTarget = () => targetChip?.replaceChildren(icon(toNote && !input?.parsed()?.target ? "file" : "calendar", 12), where().label);
  const toggleTarget = () => {
    if (!opts.note) return false;
    toNote = !toNote;
    input.render();
    return true;
  };

  /** A task is on its way to the server: another Enter now would add it twice. */
  let adding = false;
  const submit = async (text: string, ignore: string[]) => {
    if (!input.parsed()?.words || adding) return;
    adding = true;
    try {
      const r = await api.addTask(text, ignore, where().to);
      input.clear();
      status = el(
        "span",
        { class: "qa-done" },
        icon("check", 13),
        "Added to ",
        el("button", { type: "button", class: "qa-link", onclick: () => opts.open(r.path, r.line) }, r.path.replace(/\.md$/, "")),
      );
      input.render();
      opts.added(r);
    } catch (e) {
      input.preview.replaceChildren(el("span", { class: "qa-error" }, e instanceof Error ? e.message : "Couldn't add the task"));
    } finally {
      adding = false;
    }
  };

  input = taskInput({
    targets: true,
    submit,
    // Esc clears what's typed, and on an empty bar leaves it (the floating one closes).
    cancel: () => (input.value() ? input.clear() : opts.escape?.()),
    tab: toggleTarget,
    where: () => (drawTarget(), where().label),
    idle: () => (drawTarget(), status ?? el("span", { class: "qa-hint" }, HINT, el("kbd", {}, "Enter"), " adds · ", el("kbd", {}, SHORTCUT), " opens this anywhere")),
    typed: () => (status = null),
  });
  const root = el("div", { class: "qa" }, el("div", { class: "qa-field" }, icon("plus", 15), input.dom, targetChip), input.preview);
  return { root, focus: () => input.focus(), destroy: () => input.destroy() };
}

/** The quick-add bar floating over whatever's open. Enter adds and closes it. */
export function openQuickAdd(opts: Omit<QuickAddOptions, "escape">) {
  if (document.querySelector(".qa-float")) return;
  const back = document.activeElement as HTMLElement | null;
  const close = () => {
    float.remove();
    setTimeout(() => bar.destroy()); // after the key that closed it is handled
    document.removeEventListener("mousedown", outside, true);
    back?.focus?.(); // back to the note (and its Vim mode) or wherever it was opened from
  };
  const bar = quickAddBar({ ...opts, added: (r) => (opts.added(r), close()), escape: close });
  const float = el("div", { class: "qa-float", role: "dialog", "aria-label": "Add a task" }, bar.root);
  const outside = (e: MouseEvent) => !float.contains(e.target as Node) && close();
  document.addEventListener("mousedown", outside, true);
  document.body.append(float);
  bar.focus();
}
