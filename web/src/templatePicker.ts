// Choosing a template and answering its questions: the picker (type to filter, arrows and Enter)
// and the {{ask:…}} form. Making a note or inserting the text is the caller's (see main.ts).
import { el, icon } from "./dom.ts";
import { fuzzyScore } from "./fuzzy.ts";
import type { TemplateInfo } from "../../src/core/templates.ts";

/** A modal on the page; `done` closes it. Escape or a click outside is `cancel`. */
function modal(title: string, children: HTMLElement[], cancel: () => void) {
  const box = el("div", { class: "ask-box tpl-box", role: "dialog", "aria-modal": "true", "aria-label": title }, el("h2", {}, title), ...children);
  const overlay = el("div", { class: "ask", onmousedown: (e: MouseEvent) => e.target === overlay && close(true) }, box);
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    close(true);
  };
  const close = (cancelled = false) => {
    overlay.remove();
    document.removeEventListener("keydown", onKey, true);
    if (cancelled) cancel();
  };
  document.body.append(overlay);
  document.addEventListener("keydown", onKey, true);
  return { box, close };
}

/** Pick one of `templates`; null if called off. */
export function pickTemplate(templates: TemplateInfo[], title: string): Promise<TemplateInfo | null> {
  return new Promise((resolve) => {
    const filter = el("input", { placeholder: "Find a template…", "aria-label": "Find a template", autocomplete: "off", spellcheck: "false" });
    const list = el("div", { class: "tpl-list", role: "listbox", "aria-label": "Templates" });
    let shown: TemplateInfo[] = [];
    let active = 0;
    const pick = (t: TemplateInfo) => (m.close(), resolve(t));
    const draw = () => {
      const q = filter.value.trim();
      shown = q ? templates.map((t) => ({ t, s: fuzzyScore(q, t.name) })).filter((x) => x.s >= 0).sort((a, b) => b.s - a.s).map((x) => x.t) : templates;
      active = Math.min(active, Math.max(0, shown.length - 1));
      list.replaceChildren(
        ...(shown.length
          ? shown.map((t, i) =>
              el(
                "button",
                { type: "button", class: `tpl-item${i === active ? " is-active" : ""}`, role: "option", "aria-selected": String(i === active), onmousedown: (e: Event) => e.preventDefault(), onclick: () => pick(t) },
                icon("file", 15),
                el("b", {}, t.name),
                el("span", { class: "tpl-hint" }, [t.asks.length ? `asks ${t.asks.map((a) => a.label).join(", ")}` : "", t.appliesTo.length ? `for ${t.appliesTo.map((f) => `${f}/`).join(", ")}` : ""].filter(Boolean).join(" · ")),
              ),
            )
          : [el("p", { class: "tpl-none" }, templates.length ? "No template matches." : "No templates yet. A template is any note in Templates/.")]),
      );
    };
    filter.addEventListener("input", () => ((active = 0), draw()));
    filter.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (shown.length) active = (active + (e.key === "ArrowDown" ? 1 : shown.length - 1)) % shown.length;
        draw();
      } else if (e.key === "Enter" && shown[active]) {
        e.preventDefault();
        pick(shown[active]);
      }
    });
    const m = modal(title, [filter, list], () => resolve(null));
    draw();
    filter.focus();
  });
}

/**
 * Ask a template's questions (and the new note's title, with `title`), before it's filled in. A
 * blank answer is left out, so the template's default fills it or the placeholder stays to fill in
 * later. A template with nothing to ask resolves at once. Null if called off.
 */
export function askFor(t: TemplateInfo, opts: { title: boolean }): Promise<{ title?: string; answers: Record<string, string> } | null> {
  if (!t.asks.length && !opts.title) return Promise.resolve({ title: undefined, answers: {} });
  return new Promise((resolve) => {
    const field = (name: string, label: string, placeholder: string) =>
      el("label", {}, el("span", {}, label), el("input", { name, placeholder, autocomplete: "off", "aria-label": label }));
    const titleField = opts.title ? field("__title", "Title", t.title ? `From the template: ${t.title}` : t.name) : null;
    const fields = t.asks.map((a) => field(a.label, a.label, a.fallback));
    const form = el("form", { class: "tpl-form" }, ...(titleField ? [titleField] : []), ...fields);
    const submit = () => {
      m.close();
      const value = (name: string) => [...form.querySelectorAll("input")].find((i) => i.name === name)!.value.trim();
      const answers = Object.fromEntries(t.asks.map((a) => [a.label, value(a.label)]).filter(([, v]) => v));
      resolve({ title: opts.title ? value("__title") || undefined : undefined, answers });
    };
    form.addEventListener("submit", (e) => (e.preventDefault(), submit()));
    form.addEventListener("keydown", (e) => e.key === "Enter" && (e.preventDefault(), submit()));
    const actions = el(
      "div",
      { class: "ask-actions" },
      el("button", { type: "button", class: "qw-btn", onclick: () => (m.close(), resolve(null)) }, "Cancel"),
      el("button", { type: "button", class: "qw-btn primary", onclick: submit }, opts.title ? "Create" : "Insert"),
    );
    const m = modal(t.name, [form, actions], () => resolve(null));
    // The first question has the keyboard; the title can come from the template, so it's asked last in effect.
    (form.querySelector<HTMLInputElement>(fields.length ? "input:not([name='__title'])" : "input") ?? form.querySelector("input"))?.focus();
  });
}
