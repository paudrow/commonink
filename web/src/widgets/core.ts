// Shared chrome for interactive widgets: the card, its header, and the settings form that
// writes the widget's args back into the markdown line.
import { el, icon } from "../dom.ts";
import { formatDuration, parseDuration, serializeDirective } from "./args.ts";

export interface Field {
  key: string;
  label: string;
  type: "text" | "duration" | "toggle";
  placeholder?: string;
  presets?: string[];
  /** Toggles: the value written when off. Omitted from the markdown when on. */
  off?: string;
}

export interface WidgetEnv {
  args: Record<string, string>;
  note: string;
  /** True right after the widget was inserted from the / menu. */
  openConfig: boolean;
  /** Rewrite this widget's markdown line with new args. */
  update(args: Record<string, string>): void;
  /** Run fn with this widget's state id; if the markdown has none yet, one is written first. */
  withId(fn: (id: string) => void): void;
  focusEditor(): void;
  remeasure(): void;
  /** Open a note (path or [[name]]), optionally at a line. */
  open(target: string, line?: number): void;
}

export interface WidgetSpec {
  name: string;
  title: string;
  icon: string;
  hint: string;
  keywords: string;
  fields: Field[];
  defaults: Record<string, string>;
  /** Build the widget body; return a cleanup function. */
  mount(body: HTMLElement, env: WidgetEnv, card: HTMLElement): () => void;
}

export function renderWidget(spec: WidgetSpec, env: WidgetEnv): { dom: HTMLElement; destroy: () => void } {
  const gear = el("button", { class: "qw-icon", type: "button", title: "Settings" }, icon("sliders", 15));
  const head = el(
    "div",
    { class: "qw-head" },
    el("span", { class: "qw-kind" }, icon(spec.icon, 13), spec.title),
    env.args.label ? el("span", { class: "qw-label" }, env.args.label) : null,
    el("span", { class: "spacer" }),
    gear,
  );
  const body = el("div", { class: "qw-body" });
  const root = el("div", { class: `qw qw-${spec.name}` }, head, body);

  let form: HTMLElement | null = null;
  const close = () => {
    form?.remove();
    form = null;
    root.classList.remove("is-configuring");
    env.remeasure();
  };
  const open = () => {
    if (form) return close();
    form = configForm(spec, env.args, {
      save: (args) => {
        env.update(args);
        env.focusEditor();
      },
      cancel: () => {
        close();
        env.focusEditor();
      },
    });
    root.append(form);
    root.classList.add("is-configuring");
    env.remeasure();
    requestAnimationFrame(() => form?.querySelector<HTMLInputElement>("input:not([type=checkbox])")?.focus());
  };
  gear.addEventListener("mousedown", (e) => e.preventDefault());
  gear.addEventListener("click", open);

  const cleanup = spec.mount(body, env, root);
  if (env.openConfig) open();
  return { dom: root, destroy: cleanup };
}

export function button(label: string, iconName: string | null, onClick: () => void, cls = ""): HTMLButtonElement {
  const b = el("button", { class: `qw-btn ${cls}`.trim(), type: "button" });
  // Only touch the DOM when the label changes: widgets re-render several times a second, and
  // replacing the children under the pointer would swallow clicks.
  const set = (text: string, ico: string | null) => {
    if (b.dataset.label === `${ico}|${text}`) return;
    b.dataset.label = `${ico}|${text}`;
    b.replaceChildren(...(ico ? [icon(ico, 14)] : []), el("span", {}, text));
  };
  set(label, iconName);
  b.addEventListener("mousedown", (e) => e.preventDefault()); // keep the editor's selection where it is
  b.addEventListener("click", onClick);
  (b as any).set = set;
  return b;
}
export const setButton = (b: HTMLButtonElement, label: string, ico: string | null) => (b as any).set(label, ico);

function configForm(
  spec: WidgetSpec,
  args: Record<string, string>,
  on: { save(args: Record<string, string>): void; cancel(): void },
): HTMLElement {
  const values: Record<string, string> = { ...spec.defaults, ...args };
  const preview = el("code", { class: "qw-md" });
  const save = el("button", { class: "qw-btn primary", type: "submit" }, "Save");

  const normalized = () => {
    const out: Record<string, string> = {};
    for (const f of spec.fields) {
      const v = (values[f.key] ?? "").trim();
      if (f.type === "duration") out[f.key] = formatDuration(parseDuration(v) ?? 0);
      else if (f.type === "toggle") {
        if (v === f.off) out[f.key] = v;
      } else if (v) out[f.key] = v;
    }
    if (args.id) out.id = args.id;
    return out;
  };
  const refresh = () => {
    const valid = spec.fields.every((f) => f.type !== "duration" || parseDuration(values[f.key]) !== null);
    save.disabled = !valid;
    preview.textContent = valid ? serializeDirective({ name: spec.name, args: normalized() }) : "Duration like 25m, 1h30m or 4:30";
    preview.classList.toggle("is-error", !valid);
  };

  const rows = spec.fields.map((f) => {
    if (f.type === "toggle") {
      const box = el("input", { type: "checkbox" });
      box.checked = values[f.key] !== f.off;
      box.addEventListener("change", () => {
        values[f.key] = box.checked ? "on" : f.off!;
        refresh();
      });
      return el("label", { class: "qw-field is-toggle" }, el("span", { class: "qw-field-label" }, f.label), el("span", { class: "qw-switch" }, box, el("span", {})));
    }
    const input = el("input", { type: "text", value: values[f.key] ?? "", placeholder: f.placeholder ?? "", spellcheck: "false" });
    input.addEventListener("input", () => {
      values[f.key] = input.value;
      refresh();
    });
    const presets = f.presets?.length
      ? el(
          "div",
          { class: "qw-presets" },
          ...f.presets.map((p) =>
            el(
              "button",
              {
                type: "button",
                class: "qw-chip",
                onmousedown: (e: Event) => e.preventDefault(),
                onclick: () => {
                  input.value = p;
                  values[f.key] = p;
                  refresh();
                },
              },
              p,
            ),
          ),
        )
      : null;
    return el("label", { class: "qw-field" }, el("span", { class: "qw-field-label" }, f.label), el("span", { class: "qw-field-control" }, input, presets));
  });

  const form = el(
    "form",
    { class: "qw-config" },
    ...rows,
    el(
      "div",
      { class: "qw-config-foot" },
      preview,
      el("span", { class: "spacer" }),
      el("button", { class: "qw-btn", type: "button", onclick: on.cancel }, "Cancel"),
      save,
    ),
  );
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!save.disabled) on.save(normalized());
  });
  form.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      on.cancel();
    }
    e.stopPropagation();
  });
  refresh();
  return form;
}
