// Named versions (#66): a name on one version of a note ("Sent to Alex", "v1"), to compare with or go
// back to any time. The app says "version"; the code, API and agent tools say "label". Naming asks for
// a name (and, if you like, why the version matters). "Name this version…" is a command (⌘K, :version
// or :label in Vim) and a button in the note's History, where named versions stand as pins to compare,
// restore, rename and unname (history.ts). They live in the change log (core).
import { api, ApiError, type Label } from "./api.ts";
import { authorName, el, timeAgo } from "./dom.ts";
import { ask } from "./modal.ts";
import type { ToastSpec } from "./toast.ts";

/** The longest name a label takes (core LABEL_NAME_MAX). */
const NAME_MAX = 80;

/** Ask for a label's name and description. Null if called off. */
export async function askLabelName(o: { title: string; action: string; name?: string; description?: string | null; hint?: string }): Promise<{ name: string; description: string } | null> {
  const name = el("input", { class: "lb-input", type: "text", maxlength: String(NAME_MAX), placeholder: "v1, Sent to Alex, Before the rewrite…", value: o.name ?? "", "aria-label": "Name", autocomplete: "off", spellcheck: "false" });
  const description = el("textarea", { class: "lb-input lb-description", rows: "2", maxlength: "500", placeholder: "Why this version matters (optional)", "aria-label": "Description" }, o.description ?? "");
  const pending = ask({
    title: o.title,
    body: [...(o.hint ? [o.hint] : []), el("label", { class: "lb-field" }, el("span", {}, "Name"), name), el("label", { class: "lb-field" }, el("span", {}, "Description"), description)],
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
 * Label a version of the note at `path`: as it is now, or with `at`, as it was right after that change.
 * Says so in a toast, with a way to see it in History.
 */
export async function labelVersion(path: string, hooks: { toast(t: ToastSpec): void; show?(label: Label): void }, at?: number): Promise<Label | null> {
  const got = await askLabelName({ title: at ? "Name the version after this change" : "Name this version", action: "Save", hint: at ? undefined : "Name the note as it is now, to compare with or go back to later." });
  if (!got) return null;
  try {
    const label = await api.label(path, got.name, { description: got.description || undefined, at });
    const show = hooks.show;
    const text = `Named this version “${label.name}”`;
    hooks.toast(show ? { icon: "label", text, actionLabel: "Show", action: () => show(label) } : { icon: "label", text });
    return label;
  } catch (e) {
    hooks.toast({ text: e instanceof ApiError ? e.message : "Couldn't name this version" });
    return null;
  }
}

/** Rename a label, or change its description. */
export async function renameLabel(label: Label, toast: (t: ToastSpec) => void): Promise<Label | null> {
  const got = await askLabelName({ title: "Rename this version", action: "Save", name: label.name, description: label.description });
  if (!got) return null;
  return api.renameLabel(label.id, got.name, got.description || null).catch((e) => (toast({ text: e instanceof ApiError ? e.message : "Couldn't rename it" }), null));
}

/** Take the name off a version, after asking. The note and its history stay as they are. */
export async function deleteLabel(label: Label, toast: (t: ToastSpec) => void): Promise<boolean> {
  const ok = await ask({
    title: `Remove the name “${label.name}”?`,
    body: ["Only the name goes: the note and its history stay as they are."],
    actions: [{ label: "Remove name", value: "yes", kind: "danger" }],
  });
  if (!ok) return false;
  return api.deleteLabel(label.id).then(
    () => (toast({ icon: "check", text: `Removed the name “${label.name}”` }), true),
    () => (toast({ text: "Couldn't remove that name" }), false),
  );
}

/** "Sep 12 by Sam" for a label: when and who, as History says it. */
export const labeledBy = (m: Label) => `${timeAgo(m.ts)} by ${authorName(m)}`;
