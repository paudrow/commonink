// Name a smart folder, change its query, share it or keep it just yours, or delete it. The query is
// written the way ::query's args are (`tag=work sort=title`); the server checks it.
import { el, icon } from "./dom.ts";

export interface SmartFolderDraft {
  id?: string;
  name: string;
  query: string;
  shared: boolean;
}

export function smartFolderEditor(
  anchor: HTMLElement,
  draft: SmartFolderDraft,
  opts: { canShare: boolean; save(f: SmartFolderDraft): Promise<void>; remove?(): Promise<void> },
) {
  document.querySelector(".sf-editor")?.remove();
  const name = el("input", { type: "text", value: draft.name, placeholder: "Client work, This week…", spellcheck: "false" });
  const query = el("input", { type: "text", value: draft.query, placeholder: 'tag=work folder=Projects q="launch" sort=title', spellcheck: "false" });
  const justMe = el("input", { type: "checkbox" });
  justMe.checked = !draft.shared || !opts.canShare;
  justMe.disabled = !opts.canShare;
  const error = el("div", { class: "task-pop-error", hidden: true });
  const row = (label: string, ...control: Array<HTMLElement | string>) =>
    el("div", { class: "qw-field" }, el("span", { class: "qw-field-label" }, label), el("span", { class: "qw-field-control task-pop-control" }, ...control));
  const form = el(
    "form",
    { class: "qw-config task-pop sf-editor", role: "dialog", "aria-label": draft.id ? "Edit smart folder" : "New smart folder" },
    el("div", { class: "task-pop-title" }, icon("spark", 14), draft.id ? "Smart folder" : "Save as smart folder"),
    row("Name", name),
    row("Query", query),
    el(
      "label",
      { class: "sf-just-me", title: opts.canShare ? "" : "Viewers can keep smart folders of their own" },
      justMe,
      el("span", {}, "Just me"),
      el("span", { class: "sf-hint" }, opts.canShare ? "Otherwise everyone in the workspace sees it" : "You can view this workspace, so it's yours only"),
    ),
    error,
    el(
      "div",
      { class: "qw-config-foot" },
      opts.remove ? el("button", { class: "qw-btn", type: "button", onclick: () => void run(opts.remove!) }, icon("close", 13), "Delete") : null,
      el("span", { class: "spacer" }),
      el("button", { class: "qw-btn", type: "button", onclick: () => close() }, "Cancel"),
      el("button", { class: "qw-btn primary", type: "submit" }, "Save"),
    ),
  );
  const r = anchor.getBoundingClientRect();
  Object.assign(form.style, { top: `${Math.min(r.bottom + 6, innerHeight - 300)}px`, left: `${Math.max(12, Math.min(r.left, innerWidth - 352))}px` });

  const close = () => {
    form.remove();
    document.removeEventListener("mousedown", outside, true);
  };
  const outside = (e: MouseEvent) => {
    if (!form.contains(e.target as Node) && !anchor.contains(e.target as Node)) close();
  };
  const run = async (fn: () => Promise<void>) => {
    try {
      await fn();
      close();
    } catch (err) {
      error.hidden = false;
      error.textContent = err instanceof Error ? err.message : "Couldn't save the smart folder";
    }
  };
  form.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") close();
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    void run(() => opts.save({ id: draft.id, name: name.value.trim(), query: query.value.trim(), shared: !justMe.checked }));
  });
  document.addEventListener("mousedown", outside, true);
  document.body.append(form);
  name.focus();
  name.select();
}
