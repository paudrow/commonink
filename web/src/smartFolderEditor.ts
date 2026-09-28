// Name a smart folder, set its query, share it or keep it just yours, or delete it. The query's
// fields are the ::query widget's (QUERY_FIELDS, built by the same fieldRows), so the two editors
// stay the same as query terms are added. What's saved is the query as text; the server checks it.
import { api } from "./api.ts";
import { el, icon } from "./dom.ts";
import { fieldRows, fieldValues, type Field, type FieldSources } from "./widgets/core.ts";
import { QUERY_FIELDS } from "./widgets/query.ts";
import { formatAttrs, parseAttrs, queryProblem, toQuery } from "../../src/core/query.ts";

export interface SmartFolderDraft {
  id?: string;
  name: string;
  query: string;
  shared: boolean;
}

const NAME: Field = { key: "name", label: "Name", type: "text", placeholder: "Client work, This week…" };

export function smartFolderEditor(
  anchor: HTMLElement,
  draft: SmartFolderDraft,
  opts: { canShare: boolean; sources: FieldSources; save(f: SmartFolderDraft): Promise<void>; remove?(): Promise<void> },
) {
  document.querySelector(".sf-editor")?.remove();
  const values: Record<string, string> = { ...parseAttrs(draft.query), name: draft.name };
  const query = () => formatAttrs(fieldValues(QUERY_FIELDS, values));
  const count = el("div", { class: "sf-count", "aria-live": "polite" });
  let timer = 0;
  let seq = 0;
  const recount = () => {
    clearTimeout(timer);
    timer = window.setTimeout(async () => {
      const mine = ++seq;
      const problem = queryProblem(query());
      if (problem) return void ((count.textContent = problem), count.classList.add("is-error"));
      const page = await api.feed({ ...toQuery(parseAttrs(query())), scope: "active", limit: 1 }).catch(() => null);
      if (mine !== seq || !page) return;
      count.classList.remove("is-error");
      count.textContent = page.total === 1 ? "1 note matches" : `${page.total} notes match`;
    }, 200);
  };
  const justMe = el("input", { type: "checkbox" });
  justMe.checked = !draft.shared || !opts.canShare;
  justMe.disabled = !opts.canShare;
  const error = el("div", { class: "task-pop-error", hidden: true });
  const form = el(
    "form",
    { class: "qw-config task-pop sf-editor", role: "dialog", "aria-label": draft.id ? "Edit smart folder" : "New smart folder" },
    el("div", { class: "task-pop-title" }, icon("folderSearch", 14), draft.id ? "Smart folder" : draft.query ? "Save as smart folder" : "New smart folder"),
    ...fieldRows([NAME, ...QUERY_FIELDS], values, recount, opts.sources),
    count,
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
  Object.assign(form.style, { top: `${Math.max(12, Math.min(r.bottom + 6, innerHeight - 400))}px`, left: `${Math.max(12, Math.min(r.left, innerWidth - 372))}px` });

  const close = () => {
    clearTimeout(timer);
    form.remove();
    document.removeEventListener("mousedown", outside, true);
  };
  // The tag picker opens outside the form; picking from it isn't a click away.
  const outside = (e: MouseEvent) => {
    const t = e.target as Node;
    if (!form.contains(t) && !anchor.contains(t) && !(t as Element).closest?.(".tag-picker")) close();
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
    if (e.key === "Escape") {
      close();
      anchor.focus(); // back where the keyboard was
    }
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    void run(() => opts.save({ id: draft.id, name: (values.name ?? "").trim(), query: query(), shared: !justMe.checked }));
  });
  document.addEventListener("mousedown", outside, true);
  document.body.append(form);
  recount();
  const first = form.querySelector<HTMLInputElement>("input");
  first?.focus();
  first?.select();
}
