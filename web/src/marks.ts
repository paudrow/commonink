// Marked versions (#66): a name on one version of a note ("Sent to Alex", "v1"), to compare with or go
// back to any time. Marking asks for a name (and, if you like, why the version matters); the note's
// Versions menu in the top bar lists its marks and marks the version it's at now. History shows marks
// as pins, and compares and restores (history.ts). The marks themselves live in the change log (core).
import { api, ApiError, type Mark } from "./api.ts";
import { authorName, el, icon, timeAgo } from "./dom.ts";
import { ask } from "./trash.ts";
import type { ToastSpec } from "./toast.ts";

/** The longest name a mark takes (core MARK_NAME_MAX). */
const NAME_MAX = 80;

/** Ask for a mark's name and description. Null if called off. */
export async function askMarkName(o: { title: string; action: string; name?: string; description?: string | null; hint?: string }): Promise<{ name: string; description: string } | null> {
  const name = el("input", { class: "mk-input", type: "text", maxlength: String(NAME_MAX), placeholder: "v1, Sent to Alex, Before the rewrite…", value: o.name ?? "", "aria-label": "Name", autocomplete: "off", spellcheck: "false" });
  const description = el("textarea", { class: "mk-input mk-description", rows: "2", maxlength: "500", placeholder: "Why this version matters (optional)", "aria-label": "Description" }, o.description ?? "");
  const pending = ask({
    title: o.title,
    body: [...(o.hint ? [o.hint] : []), el("label", { class: "mk-field" }, el("span", {}, "Name"), name), el("label", { class: "mk-field" }, el("span", {}, "Description"), description)],
    actions: [{ label: o.action, value: "save", kind: "primary" }],
  });
  const save = document.querySelector<HTMLButtonElement>(".ask-box .qw-btn.primary")!;
  const sync = () => (save.disabled = !name.value.trim());
  sync();
  name.addEventListener("input", sync);
  name.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && name.value.trim()) {
      e.preventDefault();
      save.click();
    }
  });
  name.focus();
  name.select();
  return (await pending) === "save" ? { name: name.value.trim(), description: description.value.trim() } : null;
}

/**
 * Mark a version of the note at `path`: as it is now, or with `at`, as it was right after that change.
 * Says so in a toast, with a way to see it in History.
 */
export async function markVersion(path: string, hooks: { toast(t: ToastSpec): void; show?(mark: Mark): void }, at?: number): Promise<Mark | null> {
  const got = await askMarkName({ title: at ? "Mark the version after this change" : "Mark this version", action: "Mark", hint: at ? undefined : "Name the note as it is now, to compare with or go back to later." });
  if (!got) return null;
  try {
    const mark = await api.mark(path, got.name, { description: got.description || undefined, at });
    const show = hooks.show;
    const text = `Marked this version “${mark.name}”`;
    hooks.toast(show ? { icon: "bookmark", text, actionLabel: "Show", action: () => show(mark) } : { icon: "bookmark", text });
    return mark;
  } catch (e) {
    hooks.toast({ text: e instanceof ApiError ? e.message : "Couldn't mark this version" });
    return null;
  }
}

/** Rename a mark, or change its description. */
export async function renameMark(mark: Mark, toast: (t: ToastSpec) => void): Promise<Mark | null> {
  const got = await askMarkName({ title: "Rename this marked version", action: "Save", name: mark.name, description: mark.description });
  if (!got) return null;
  return api.renameMark(mark.id, got.name, got.description || null).catch((e) => (toast({ text: e instanceof ApiError ? e.message : "Couldn't rename it" }), null));
}

/** Take the name off a version, after asking. The note and its history stay as they are. */
export async function deleteMark(mark: Mark, toast: (t: ToastSpec) => void): Promise<boolean> {
  const ok = await ask({
    title: `Delete the mark “${mark.name}”?`,
    body: ["Only the name goes: the note and its history stay as they are."],
    actions: [{ label: "Delete mark", value: "yes", kind: "danger" }],
  });
  if (!ok) return false;
  return api.deleteMark(mark.id).then(
    () => (toast({ icon: "check", text: `Deleted the mark “${mark.name}”` }), true),
    () => (toast({ text: "Couldn't delete that mark" }), false),
  );
}

/** "Sep 12 by Sam" for a mark: when and who, as History says it. */
export const markedBy = (m: Mark) => `${timeAgo(m.ts)} by ${authorName(m)}`;

/**
 * The note's Versions menu, under the top bar's button: Mark this version…, then its marks, each of
 * which opens in History to compare or restore.
 */
export function versionsMenu(anchor: HTMLElement, path: string, hooks: { toast(t: ToastSpec): void; show(mark: Mark): void; readOnly: boolean }) {
  const had = document.querySelector(".mk-menu");
  had?.remove();
  if (had && anchor.getAttribute("aria-expanded") === "true") return void anchor.setAttribute("aria-expanded", "false");
  const list = el("div", { class: "fp-list", role: "menu", "aria-label": "Versions" });
  const box = el("div", { class: "folder-picker mk-menu" }, el("div", { class: "fp-head" }, icon("bookmark", 15), el("span", {}, "Marked versions")), list);
  const r = anchor.getClientRects().length ? anchor.getBoundingClientRect() : { bottom: 48, right: window.innerWidth };
  Object.assign(box.style, { top: `${r.bottom + 6}px`, right: `${Math.max(12, window.innerWidth - r.right)}px` });
  const close = (refocus = false) => {
    box.remove();
    anchor.setAttribute("aria-expanded", "false");
    document.removeEventListener("mousedown", outside, true);
    if (refocus) anchor.focus();
  };
  const outside = (e: MouseEvent) => !box.contains(e.target as Node) && !anchor.contains(e.target as Node) && close();
  const item = (label: string, ico: string, run: () => void, extra?: HTMLElement | null) =>
    el("button", { type: "button", role: "menuitem", class: "fp-item", onclick: () => (close(), run()) }, icon(ico, 14), el("span", {}, label), extra ?? null);
  const render = (marks: Mark[] | null) =>
    list.replaceChildren(
      ...(hooks.readOnly ? [] : [item("Mark this version…", "plus", () => void markVersion(path, hooks)), el("div", { class: "fp-sep" })]),
      ...(marks === null
        ? [el("div", { class: "fp-empty" }, "Loading…")]
        : marks.length
          ? marks.map((m) => item(m.name, "bookmark", () => hooks.show(m), el("span", { class: `mk-when${m.current ? " is-now" : ""}` }, m.current ? "now" : timeAgo(m.ts))))
          : [el("div", { class: "fp-empty" }, "No marked versions yet")]),
    );
  box.addEventListener("keydown", (e) => {
    const items = [...list.querySelectorAll<HTMLElement>(".fp-item")];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const to = { ArrowDown: at + 1, ArrowUp: at - 1 }[e.key];
    if (to !== undefined) {
      e.preventDefault();
      items[(to + items.length) % items.length]?.focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    }
  });
  render(null);
  document.body.append(box);
  anchor.setAttribute("aria-expanded", "true");
  document.addEventListener("mousedown", outside, true);
  list.querySelector<HTMLElement>(".fp-item")?.focus();
  void api.marks(path).then(
    (m) => box.isConnected && (render(m), list.querySelector<HTMLElement>(".fp-item")?.focus()),
    () => box.isConnected && render([]),
  );
}
