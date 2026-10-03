// Shared chrome for interactive widgets: the card, its header, and the settings form that
// writes the widget's args back into the markdown line. Its fields (fieldRows) are shared with
// the smart folder editor, so a query field added once shows up in both.
import type { TagCount } from "../api.ts";
import { el, icon } from "../dom.ts";
import { tagPicker } from "../tagPicker.ts";
import { tagList } from "../../../src/core/query.ts";
import { formatDuration, parseDuration, serializeDirective } from "./args.ts";
import type { EditorContext } from "../editor/blocks.ts";
import { calendars, colorVar } from "../calendar/data.ts";

export interface Field {
  key: string;
  label: string;
  /** `calendars`: which of the workspace's calendars to show, as source IDs; none chosen is all of them. */
  type: "text" | "duration" | "toggle" | "select" | "calendars";
  placeholder?: string;
  presets?: string[];
  /** Toggles: the value written when off. Omitted from the markdown when on. */
  off?: string;
  /** Selects: [value, label] pairs. The first is the default, which is left out of the markdown. */
  options?: Array<[string, string]>;
  /** A text field that suggests values: tags in use (with the tag picker), or folders. */
  picker?: "tag" | "folder";
  /** Text fields: what's wrong with a value, or null. A widget's form shows it in place of its preview, and can't be saved until it's fixed. */
  check?(value: string): string | null;
  /** Text fields: a link beside the box, such as the query syntax's "?". */
  help?(): HTMLElement;
}

/** What field pickers suggest from. */
export interface FieldSources {
  tags(): TagCount[];
  folders(): string[];
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
  /** Show the widget's markdown line in the note, with the cursor on it (none on the Tasks and Today pages). */
  editSource?(): void;
  remeasure(): void;
  /** Open a note (path or [[name]]), optionally at a line; `side`: to the side (Cmd/Ctrl-click). */
  open(target: string, line?: number, side?: boolean): void;
  /** Show what carries a tag (a tag clicked in the widget). */
  openTag(tag: string): void;
  /** Offer to keep a note query (`tag=work sort=title`) as a smart folder, named `name` to start with. */
  saveSmartFolder(query: string, name: string, anchor: HTMLElement): void;
  /** Tags and folders for the settings form's pickers. */
  sources: FieldSources;
  /** Show a person's tasks. */
  openPerson(name: string): void;
  /** The note editor the widget is in (none on the Tasks and Today pages): its note names and tags, for suggestions. */
  editor?: EditorContext;
  /** The person can read this workspace but not change it. */
  readOnly?: boolean;
  /** What a list shows when there are no tasks at all (the Tasks page: where tasks come from). */
  empty?(): HTMLElement;
}

export interface WidgetSpec {
  name: string;
  title: string;
  /** The header's words, when they depend on the args ("Writing days in Journal"); `title` otherwise. */
  heading?(args: Record<string, string>): string;
  icon: string;
  hint: string;
  keywords: string;
  fields: Field[];
  defaults: Record<string, string>;
  /** A button in the settings form that does something with the args being edited (not yet saved). */
  configAction?: { label: string; icon: string; run(args: Record<string, string>, env: WidgetEnv, anchor: HTMLElement): void };
  /** The args as the settings form shows them, when that differs from how they're written (see the notes view, query.ts). */
  formArgs?(args: Record<string, string>): Record<string, string>;
  /**
   * A widget that is one of several kinds, picked by an arg (::view's `show`). The kind's spec
   * stands in for this one everywhere: its header, fields, defaults, settings button and drawing.
   * The settings form starts with the choice of kind; this spec's own fields and mount go unused.
   */
  kinds?: WidgetKinds;
  /** Build the widget body; return a cleanup function. */
  mount(body: HTMLElement, env: WidgetEnv, card: HTMLElement): () => void;
}

export interface WidgetKinds {
  /** The arg that picks the kind (`show`). */
  key: string;
  /** Its row's label in the settings form. */
  label: string;
  /** [value, label] for each kind. The first is the default, which is left out of the markdown. */
  options: Array<[string, string]>;
  /** The spec for the kind these args pick (one that says so, for a value that names none). */
  of(args: Record<string, string>): WidgetSpec;
}

/** The spec that draws these args: the kind they pick for a widget with kinds (::view), or the spec itself. */
export const specFor = (spec: WidgetSpec, args: Record<string, string>): WidgetSpec => spec.kinds?.of(args) ?? spec;

/** The args a kind reads: all but the one that picked it. */
function kindArgs(spec: WidgetSpec, args: Record<string, string>): Record<string, string> {
  if (!spec.kinds) return args;
  const { [spec.kinds.key]: _, ...rest } = args;
  return rest;
}

export function renderWidget(spec: WidgetSpec, env: WidgetEnv): { dom: HTMLElement; destroy: () => void } {
  // A ::view draws as its kind (a list of notes, a month…), with that kind's header and class.
  const kind = specFor(spec, env.args);
  const gear = el("button", { class: "qw-icon", type: "button", title: "Settings" }, icon("sliders", 15));
  const source =
    env.editSource && !env.readOnly
      ? el("button", { class: "qw-icon", type: "button", title: "Edit as text", "aria-label": "Edit as text", onmousedown: (e: Event) => e.preventDefault(), onclick: env.editSource }, icon("code", 15))
      : null;
  const head = el(
    "div",
    { class: "qw-head" },
    el("span", { class: "qw-kind" }, icon(kind.icon, 13), kind.heading?.(env.args) ?? kind.title),
    env.args.label ? el("span", { class: "qw-label" }, env.args.label) : null,
    el("span", { class: "spacer" }),
    source,
    env.readOnly || (!kind.fields.length && !spec.kinds) ? null : gear,
  );
  const body = el("div", { class: "qw-body" });
  const root = el("div", { class: `qw qw-${kind.name}` }, head, body);

  let form: HTMLElement | null = null;
  const close = () => {
    form?.remove();
    form = null;
    root.classList.remove("is-configuring");
    env.remeasure();
  };
  const open = () => {
    if (form) return close();
    form = configForm(spec, env, {
      // Save closes the form itself: a save that leaves the line as it was doesn't redraw the widget.
      save: (args) => {
        close();
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

  // A kind reads its own args, without `show`; one that rewrites its line keeps the `show` it had.
  const keep = spec.kinds && env.args[spec.kinds.key] !== undefined ? { [spec.kinds.key]: env.args[spec.kinds.key] } : {};
  const kindEnv: WidgetEnv = kind === spec ? env : { ...env, args: kindArgs(spec, env.args), update: (next) => env.update({ ...keep, ...next }) };
  const cleanup = kind.mount(body, kindEnv, root);
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
  env: WidgetEnv,
  on: { save(args: Record<string, string>): void; cancel(): void },
): HTMLElement {
  const args = env.args;
  let values = formValues(spec, args);
  // The kind being edited (::view's Show); the spec itself for a widget of one kind.
  let kind = specFor(spec, values);
  const preview = el("code", { class: "qw-md" });
  const save = el("button", { class: "qw-btn primary", type: "submit" }, "Save");

  const normalized = () => formResult(spec, values, args.id);
  const refresh = () => {
    const problem = kind.fields.map((f) => f.check?.(values[f.key] ?? "")).find(Boolean);
    const valid = !problem && kind.fields.every((f) => f.type !== "duration" || parseDuration(values[f.key]) !== null);
    save.disabled = !valid;
    preview.textContent = valid ? serializeDirective({ name: spec.name, args: normalized() }) : (problem ?? "Duration like 25m, 1h30m or 4:30");
    preview.classList.toggle("is-error", !valid);
  };

  // Show first, then the kind's own fields. Picking another kind swaps them, keeping only what it reads too.
  const showRow = () => {
    if (!spec.kinds) return [];
    const key = spec.kinds.key;
    const was = values[key] ?? ""; // the select has already written the new kind into values
    return fieldRows([kindField(spec.kinds)], values, () => {
      const to = values[key];
      if (specFor(spec, values) === kind) return refresh();
      values = switchKind(spec, { ...values, [key]: was }, to);
      kind = specFor(spec, values);
      draw();
      env.remeasure();
    }, env.sources);
  };
  const foot = () =>
    el(
      "div",
      { class: "qw-config-foot" },
      preview,
      el("span", { class: "spacer" }),
      kind.configAction
        ? el("button", { class: "qw-btn", type: "button", onclick: (e: Event) => kind.configAction!.run(kindArgs(spec, normalized()), env, e.currentTarget as HTMLElement) }, icon(kind.configAction.icon, 13), kind.configAction.label)
        : null,
      el("button", { class: "qw-btn", type: "button", onclick: on.cancel }, "Cancel"),
      save,
    );
  const form = el("form", { class: "qw-config" });
  const draw = () => {
    form.replaceChildren(...showRow(), ...fieldRows(kind.fields, values, refresh, env.sources), foot());
    refresh();
  };
  draw();
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
  return form;
}

/** The choice of kind, as a settings form row: a select whose first option is left out of the markdown. */
const kindField = (kinds: WidgetKinds): Field => ({ key: kinds.key, label: kinds.label, type: "select", options: kinds.options });

/** What a widget's settings form starts with: its kind's defaults, under the args as that form shows them. */
export function formValues(spec: WidgetSpec, args: Record<string, string>): Record<string, string> {
  const kind = specFor(spec, args);
  return { ...kind.defaults, ...(kind.formArgs?.(args) ?? args) };
}

/**
 * A settings form's values as the widget's args in the markdown: the kind first (left out when
 * it's the first, so a list of notes is a bare `::view`), then the kind's fields, then the id.
 */
export function formResult(spec: WidgetSpec, values: Record<string, string>, id?: string): Record<string, string> {
  const kind = specFor(spec, values);
  return { ...(spec.kinds ? fieldValues([kindField(spec.kinds)], values) : {}), ...fieldValues(kind.fields, values), ...(id ? { id } : {}) };
}

/**
 * The form's values once the kind changes to `to`: the new kind's defaults, and what was set for
 * fields the new kind has too (a title, a folder, a tag), unless it has a default of its own there
 * (a month's folder is the journal's) or the value was just the old kind's default. Args the new
 * kind doesn't read go.
 */
export function switchKind(spec: WidgetSpec, values: Record<string, string>, to: string): Record<string, string> {
  const key = spec.kinds?.key ?? "";
  const from = specFor(spec, values);
  const kind = specFor(spec, { [key]: to });
  const chosen = (k: string) => !!values[k]?.trim() && values[k] !== from.defaults[k];
  const kept = kind.fields.filter((f) => f.key !== key && chosen(f.key) && !(f.key in kind.defaults)).map((f) => [f.key, values[f.key]]);
  return { [key]: to, ...kind.defaults, ...Object.fromEntries(kept) };
}

/** The fields' values as they go in the markdown: durations tidied, defaults (on toggles, first options) and blanks left out. */
export function fieldValues(fields: Field[], values: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) {
    const v = (values[f.key] ?? "").trim();
    if (f.type === "duration") out[f.key] = formatDuration(parseDuration(v) ?? 0);
    else if (f.type === "toggle") {
      if (v === f.off) out[f.key] = v;
    } else if (f.type === "select") {
      if (v && v !== f.options?.[0]?.[0]) out[f.key] = v;
    } else if (v) out[f.key] = v;
  }
  return out;
}

let listSeq = 0;

/** A labeled row per field, editing `values` in place and calling `changed` after each edit. */
export function fieldRows(fields: Field[], values: Record<string, string>, changed: () => void, sources: FieldSources): HTMLElement[] {
  const set = (key: string, v: string) => {
    values[key] = v;
    changed();
  };
  return fields.map((f) => {
    const row = (...control: Array<HTMLElement | null>) =>
      el("label", { class: "qw-field" }, el("span", { class: "qw-field-label" }, f.label), el("span", { class: "qw-field-control" }, ...control));
    if (f.type === "toggle") {
      const box = el("input", { type: "checkbox" });
      box.checked = values[f.key] !== f.off;
      box.addEventListener("change", () => set(f.key, box.checked ? "on" : f.off!));
      return el("label", { class: "qw-field is-toggle" }, el("span", { class: "qw-field-label" }, f.label), el("span", { class: "qw-switch" }, box, el("span", {})));
    }
    if (f.type === "calendars") return calendarPicker(f, values, (v) => set(f.key, v));
    if (f.type === "select") {
      const select = el("select", { class: "qw-select" }, ...(f.options ?? []).map(([v, label]) => el("option", { value: v }, label)));
      select.value = values[f.key] || f.options?.[0]?.[0] || "";
      select.addEventListener("change", () => set(f.key, select.value));
      return row(select);
    }
    const input = el("input", { type: "text", value: values[f.key] ?? "", placeholder: f.placeholder ?? "", spellcheck: "false" });
    input.addEventListener("input", () => set(f.key, input.value));
    const pick = (v: string) => {
      input.value = v;
      set(f.key, v);
    };
    let helper: HTMLElement | null = null;
    if (f.picker === "folder") {
      const id = `qw-list-${++listSeq}`;
      input.setAttribute("list", id);
      helper = el("datalist", { id }, ...sources.folders().map((folder) => el("option", { value: folder })));
    } else if (f.picker === "tag") {
      const button: HTMLButtonElement = el(
        "button",
        {
          type: "button",
          class: "qw-pick",
          title: "Pick a tag",
          onmousedown: (e: Event) => e.preventDefault(),
          // A picked tag joins the ones already there: a note needs them all.
          onclick: () =>
            tagPicker(button, {
              tags: sources.tags().filter((t) => t.notes > 0),
              count: (t) => t.notes,
              onPick: (t) => {
                const had = tagList(input.value);
                pick(had.some((x) => x.replace(/^#/, "").toLowerCase() === t.toLowerCase()) ? input.value : [...had, t].join(", "));
              },
            }),
        },
        icon("hash", 13),
      );
      helper = button;
    }
    const presets = f.presets?.length
      ? el(
          "div",
          { class: "qw-presets" },
          ...f.presets.map((p) => el("button", { type: "button", class: "qw-chip", onmousedown: (e: Event) => e.preventDefault(), onclick: () => pick(p) }, p)),
        )
      : null;
    if (f.help) helper = el("span", { class: "qw-help" }, helper, f.help());
    return row(helper ? el("span", { class: "qw-picked" }, input, helper) : input, presets);
  });
}

/**
 * Which calendars to show: "All calendars", then each one, checked. Everything checked is written as
 * nothing (so a calendar added later shows too); at least one stays checked.
 */
function calendarPicker(f: Field, values: Record<string, string>, set: (v: string) => void): HTMLElement {
  const list = el("div", { class: "qw-cals" }, el("span", { class: "qw-cals-note" }, "Loading the calendars…"));
  const check = (label: string, box: HTMLInputElement, color?: string) =>
    el("label", { class: "qw-cal" }, box, color ? el("span", { class: "cal-dot", style: { background: colorVar(color) }, "aria-hidden": "true" }) : null, el("span", {}, label));
  void calendars()
    .then((all) => {
      if (!all.length) return list.replaceChildren(el("span", { class: "qw-cals-note" }, "No calendars yet: subscribe to one on the Calendar page."));
      const chosen = new Set((values[f.key] ?? "").split(",").filter(Boolean));
      const every = el("input", { type: "checkbox" });
      const boxes = all.map((s) => {
        const box = el("input", { type: "checkbox", value: s.id });
        box.checked = !chosen.size || chosen.has(s.id);
        return { s, box };
      });
      const write = () => {
        const on = boxes.filter((b) => b.box.checked);
        every.checked = on.length === boxes.length;
        set(on.length === boxes.length ? "" : on.map((b) => b.s.id).join(","));
      };
      every.checked = boxes.every((b) => b.box.checked);
      every.addEventListener("change", () => {
        for (const b of boxes) b.box.checked = true;
        write();
      });
      for (const b of boxes)
        b.box.addEventListener("change", () => {
          if (!boxes.some((x) => x.box.checked)) b.box.checked = true; // showing none would show nothing
          write();
        });
      list.replaceChildren(check("All calendars", every), ...boxes.map((b) => check(b.s.name, b.box, b.s.color)));
    })
    .catch(() => list.replaceChildren(el("span", { class: "qw-cals-note" }, "Couldn't load the calendars")));
  return el("div", { class: "qw-field", role: "group", "aria-label": f.label }, el("span", { class: "qw-field-label" }, f.label), el("span", { class: "qw-field-control" }, list));
}
