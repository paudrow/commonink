// A note's properties (its front matter) as a table you edit in place: one row per property, with
// the control its type calls for (src/core/schema.ts says the type): a checkbox, a dropdown, a date
// picker, chips for lists, tags and people, with suggestions as you type. "Add property" offers what
// this note can still have. A change rewrites only that property's line, so the YAML stays as it
// was everywhere else, and it stays one click away (YAML) for anything the table can't show.
//
// Each row says what type its property is. The app's own properties have theirs; a property of your
// own is whatever the workspace settings declare it (`properties:` in Config/Settings.md), else
// guessed from its value. Clicking the type picks another, which is written to the settings, so
// every note's table (and agents, through list_properties) agree on it.
import { EditorView, WidgetType } from "@codemirror/view";
import { KIND_NAME, linkTarget, PROPERTY_TYPES, propKind, scanFrontmatter, schemaFor, SETTINGS_NOTE, typeInfo, typeSettable, withoutValue, withValue, type PropertyTypes, type PropKind, type PropSchema, type SettingValue, type TypeInfo, type Value } from "../../../src/core/schema.ts";
import { displayName, el, icon } from "../dom.ts";
import { fuzzyScore } from "../fuzzy.ts";
import { contactLink, ensureContact, people, rankPeople } from "../people.ts";
import { editorContext } from "./blocks.ts";
import { typeText } from "./properties.ts";
import { setPropertyType } from "../propertyTypes.ts";
import { toast } from "../toast.ts";

/** The property to focus once the table is drawn again (one was just added). */
let focusNext: string | null = null;

/** Write `key` = `value` (or remove it, with null) into the note, changing only what differs. */
function commit(view: EditorView, key: string, value: SettingValue | null) {
  const md = view.state.doc.toString();
  const next = value === null ? withoutValue(md, key) : withValue(md, key, value);
  if (next === md) return;
  let from = 0;
  while (from < md.length && from < next.length && md[from] === next[from]) from++;
  let a = md.length;
  let b = next.length;
  while (a > from && b > from && md[a - 1] === next[b - 1]) a--, b--;
  view.dispatch({ changes: { from, to: a, insert: next.slice(from, b) }, userEvent: "input.properties" });
}

/** Each type's icon, beside its name on a row. */
const TYPE_ICON: Record<string, string> = { text: "edit", number: "sigma", checkbox: "task", date: "calendar", list: "list", people: "user", person: "user", tags: "hash", "one of": "check", YAML: "braces" };

/** The menu of types for `key`, under its type chip: picking one declares it for every note. */
function typeMenu(anchor: HTMLElement, key: string, now: TypeInfo) {
  document.querySelector(".prop-type-menu")?.remove();
  const close = () => (menu.remove(), document.removeEventListener("mousedown", outside, true), document.removeEventListener("keydown", onKey, true));
  const outside = (e: Event) => !menu.contains(e.target as Node) && close();
  const onKey = (e: KeyboardEvent) => e.key === "Escape" && (e.preventDefault(), e.stopPropagation(), close());
  const pick = (type: string) => {
    close();
    setPropertyType(key, type).catch((e) => toast({ text: `Couldn't change ${key}'s type`, detail: e instanceof Error ? e.message : String(e) }));
  };
  const item = (type: string, label: string, ic: string, on: boolean) =>
    el("button", { type: "button", role: "menuitemradio", "aria-checked": String(on), class: `fp-item${on ? " is-active" : ""}`, onmousedown: (e: Event) => (e.preventDefault(), pick(type)) }, icon(ic, 14), el("span", {}, label), on ? icon("check", 13) : null);
  const declared = now.source === "declared";
  const menu = el(
    "div",
    { class: "folder-picker prop-suggest prop-type-menu", role: "menu", "aria-label": `${key}'s type` },
    el("div", { class: "prop-type-head" }, `${key} is a… (for every note, in ${SETTINGS_NOTE})`),
    el(
      "div",
      { class: "fp-list" },
      ...PROPERTY_TYPES.map((t) => item(t, t, TYPE_ICON[t], declared && now.type === t)),
      item("auto", declared ? "Guess from its value" : `Guessed: ${now.type}`, "spark", !declared),
    ),
  );
  document.body.append(menu);
  const r = anchor.getBoundingClientRect();
  Object.assign(menu.style, { top: `${r.bottom + 4}px`, left: `${Math.max(8, Math.min(r.left, innerWidth - 300))}px` });
  document.addEventListener("mousedown", outside, true);
  document.addEventListener("keydown", onKey, true);
  (menu.querySelector(".fp-item") as HTMLElement | null)?.focus();
}

/** A row's type: its icon and name, and, for a property of your own, a button that changes it. */
function typeChip(path: string, key: string, info: TypeInfo, readOnly: boolean): HTMLElement {
  const why =
    info.source === "built in"
      ? `${key} is one of Common Ink's own properties, so it's always ${info.type === "one of" ? "one of a few values" : `a ${info.type}`}.`
      : info.source === "declared"
        ? `${key} is a ${info.type} in every note: ${SETTINGS_NOTE} says so (properties:).`
        : `${key} looks like ${info.type === "YAML" ? "nested YAML" : `a ${info.type}`} from its value. Nothing declares its type yet.`;
  const can = !readOnly && typeSettable(path, key);
  const chip = el(
    can ? "button" : "span",
    { ...(can ? { type: "button" } : {}), class: `prop-type is-${info.source.replace(" ", "-")}`, title: can ? `${why}\n\nClick to choose its type for every note.` : why },
    icon(TYPE_ICON[info.type] ?? "sliders", 11),
    el("span", {}, info.type),
  );
  if (can) chip.addEventListener("mousedown", (e) => (e.preventDefault(), e.stopPropagation(), typeMenu(chip, key, info)));
  return chip;
}

interface Option {
  value: string;
  label: string;
  detail?: string;
  icon?: string;
  /** Turn the pick into the value to write (a member becomes a contact first). */
  resolve?: () => Promise<string>;
}

/**
 * Suggestions under `input` as you type: arrows move, Enter or a click picks. `free`: Enter with
 * nothing suggested takes what's typed.
 */
function suggest(input: HTMLInputElement, source: (q: string) => Promise<Option[]> | Option[], onPick: (value: string) => void, free = true) {
  let box: HTMLElement | null = null;
  let items: Option[] = [];
  let active = 0;
  let asked = 0;
  const close = () => (box?.remove(), (box = null));
  const pick = async (o: Option | undefined) => {
    const typed = input.value.trim();
    close();
    if (o) onPick(o.resolve ? await o.resolve() : o.value);
    else if (free && typed) onPick(typed);
    input.value = "";
  };
  const render = () => {
    if (!items.length) return close();
    if (!box) {
      box = el("div", { class: "folder-picker prop-suggest", role: "listbox" });
      document.body.append(box);
    }
    const r = input.getBoundingClientRect();
    Object.assign(box.style, { top: `${r.bottom + 4}px`, left: `${Math.min(r.left, innerWidth - 300)}px` });
    box.replaceChildren(
      el(
        "div",
        { class: "fp-list" },
        ...items.map((o, i) =>
          el(
            "button",
            { type: "button", class: `fp-item${i === active ? " is-active" : ""}`, onmousedown: (e: Event) => (e.preventDefault(), pick(o)) },
            o.icon ? icon(o.icon, 14) : null,
            el("span", {}, o.label),
            o.detail ? el("span", { class: "fp-here" }, o.detail) : null,
          ),
        ),
      ),
    );
  };
  const refresh = async () => {
    const n = ++asked;
    const found = await source(input.value.trim());
    if (n !== asked || document.activeElement !== input) return;
    items = found.slice(0, 8);
    active = 0;
    render();
  };
  input.addEventListener("focus", refresh);
  input.addEventListener("input", refresh);
  input.addEventListener("blur", () => setTimeout(close, 0));
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!items.length) return;
      e.preventDefault();
      active = (active + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      render();
    } else if (e.key === "Enter" || (e.key === "," && free && input.value.trim())) {
      e.preventDefault();
      pick(box ? items[active] : undefined);
    } else if (e.key === "Escape") {
      if (box) e.preventDefault(), e.stopPropagation(), close();
    }
  });
}

/** Options from `values`, best match for `q` first. */
const ranked = (q: string, values: Option[]) =>
  q
    ? values
        .map((o) => ({ o, s: fuzzyScore(q, o.label) }))
        .filter((x) => x.s >= 0)
        .sort((a, b) => b.s - a.s)
        .map((x) => x.o)
    : values;

/** Contacts, then workspace members without one, for `q`. Picking a member makes their contact. */
async function personOptions(q: string, taken: string[]): Promise<Option[]> {
  const { contacts, members } = await people().catch(() => ({ contacts: [], members: [] }));
  return rankPeople(q, contacts, members)
    .map((p): Option => {
      if (p.contact) return { value: contactLink(p.contact.path), label: p.name, detail: p.detail, icon: "user" };
      return { value: "", label: p.name, detail: "member", icon: "user", resolve: async () => contactLink(await ensureContact(p.name, p.member?.email)) };
    })
    .filter((o) => !o.value || !taken.includes(o.value));
}

class PropertyTableWidget extends WidgetType {
  /** `bad`: each property with a problem (schema.ts), and what it is. */
  constructor(
    readonly yaml: string,
    readonly path: string,
    readonly bad: Record<string, string>,
    readonly types: PropertyTypes,
  ) {
    super();
  }
  eq(o: PropertyTableWidget) {
    return o.yaml === this.yaml && o.path === this.path && JSON.stringify(o.bad) === JSON.stringify(this.bad) && JSON.stringify(o.types) === JSON.stringify(this.types);
  }
  ignoreEvent() {
    return true;
  }
  toDOM(view: EditorView) {
    const readOnly = view.state.readOnly;
    const schema = schemaFor(this.path, this.types);
    const src = `---\n${this.yaml}\n---\n`;
    const scan = scanFrontmatter(src);
    const fields = scan?.fields ?? [];
    const rows: HTMLElement[] = [];
    const seen = new Set<string>();
    for (const f of fields) {
      if (seen.has(f.key)) continue; // a key set twice: the first one is what's read (its problem says so)
      seen.add(f.key);
      const prop = schema.properties[f.key];
      const kind = propKind(f.key, prop, f.value);
      const problem = this.bad[f.key];
      const keyEl = el("button", { type: "button", class: "prop-key-name", title: prop ? `${prop.description}\n\nClick to edit as YAML.` : "Click to edit as YAML." }, f.key);
      keyEl.addEventListener("mousedown", (e) => {
        e.preventDefault();
        const line = view.state.doc.line(Math.min(view.state.doc.lines, src.slice(0, f.from).split("\n").length));
        view.dispatch({ selection: { anchor: line.to }, scrollIntoView: true });
        view.focus();
      });
      const control = kind === "raw" ? el("code", { class: "prop-raw", title: "Nested values: edit them as YAML" }, src.slice(f.value.from, f.value.to).trim() || "…") : this.control(view, f.key, kind, prop, f.value, readOnly);
      const remove = readOnly
        ? null
        : el("button", { type: "button", class: "prop-remove", title: `Remove ${f.key}`, onmousedown: (e: Event) => (e.preventDefault(), commit(view, f.key, null)) }, icon("close", 13));
      rows.push(
        el(
          "div",
          { class: problem ? "prop is-bad" : "prop", "data-key": f.key },
          el("div", { class: "prop-key" }, keyEl, typeChip(this.path, f.key, typeInfo(this.path, f.key, f.value, this.types), readOnly)),
          el("div", { class: "prop-cell" }, control, problem ? el("div", { class: "prop-problem" }, problem) : null),
          remove ?? el("span", {}),
        ),
      );
    }
    // A settings file lists the settings it doesn't set yet, each with what it does: what you can set is in front of you.
    const unset = readOnly || schema.additionalProperties ? [] : Object.entries(schema.properties).filter(([k]) => !seen.has(k) && !SKIP.has(k));
    if (unset.length) rows.push(el("div", { class: "prop-unset-head" }, "You can also set"));
    for (const [k, p] of unset)
      rows.push(
        el(
          "div",
          { class: "prop is-unset", "data-key": k },
          el("span", { class: "prop-key" }, k),
          el("div", { class: "prop-cell" }, el("span", { class: "prop-unset-type" }, typeText(p)), el("span", { class: "prop-unset-desc" }, p.description)),
          // A map (the property types) is set from a note's table, a type at a time.
          p.type === "object" ? el("span", {}) : el("button", { type: "button", class: "qw-btn prop-unset-add", title: `Set ${k}`, onmousedown: (e: Event) => (e.preventDefault(), addKey(view, k, p)) }, "Add"),
        ),
      );
    const foot = el(
      "div",
      { class: "prop-foot" },
      readOnly ? null : this.adder(view, schema.properties, seen),
      el("button", { type: "button", class: "prop-yaml", title: "Edit the properties as YAML", onmousedown: (e: Event) => (e.preventDefault(), reveal(view)) }, icon("code", 13), "YAML"),
    );
    const wrap = el("div", { class: "cm-properties-block" }, el("div", { class: "cm-properties is-table", role: "group", "aria-label": "Properties" }, ...rows, foot));
    // Keys typed in a control stay in it, not in the editor's own shortcuts.
    wrap.addEventListener("keydown", (e) => e.stopPropagation());
    if (focusNext) {
      const key = focusNext;
      focusNext = null;
      requestAnimationFrame(() => (wrap.querySelector(`[data-key="${CSS.escape(key)}"] .prop-cell :is(input, select)`) as HTMLElement | null)?.focus());
    }
    return wrap;
  }

  /** The control for one property's value. */
  control(view: EditorView, key: string, kind: PropKind, prop: PropSchema | undefined, value: Value, readOnly: boolean): HTMLElement {
    const ctx = view.state.facet(editorContext);
    const text = value.kind === "scalar" ? value.text : "";
    const items = value.kind === "list" ? value.items.map((i) => i.text) : value.kind === "scalar" && text ? [text] : [];
    const set = (v: SettingValue) => commit(view, key, v);
    switch (kind) {
      case "boolean": {
        const box = el("input", { type: "checkbox", class: "prop-check", disabled: readOnly, "aria-label": key });
        box.checked = /^true$/i.test(text);
        box.addEventListener("change", () => set(box.checked));
        return box;
      }
      case "enum": {
        const values = prop?.enum ?? [];
        const select = el(
          "select",
          { class: "prop-select", disabled: readOnly, "aria-label": key },
          !values.includes(text) ? el("option", { value: text }, text || "Choose…") : null,
          ...values.map((v) => el("option", { value: v }, v === String(prop?.default) ? `${v} (default)` : v)),
        );
        select.value = text;
        select.addEventListener("change", () => set(select.value));
        return select;
      }
      case "number": {
        const input = el("input", { type: "text", inputmode: "decimal", class: "prop-input prop-number", value: text, disabled: readOnly, "aria-label": key, spellcheck: "false" });
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") e.preventDefault(), input.blur();
          if (e.key === "Escape") (input.value = text), input.blur();
        });
        input.addEventListener("blur", () => input.value.trim() !== text && set(input.value.trim()));
        return input;
      }
      case "date": {
        const ok = !text || /^\d{4}-\d{2}-\d{2}$/.test(text);
        const input = el("input", { type: ok ? "date" : "text", class: "prop-input prop-date", value: text, disabled: readOnly, "aria-label": key });
        input.addEventListener("change", () => input.value !== text && set(input.value));
        return input;
      }
      case "text": {
        const input = el("input", { type: "text", class: "prop-input", value: text, placeholder: prop?.examples?.[0]?.replace(/^"|"$/g, "") ?? "", disabled: readOnly, "aria-label": key, spellcheck: "false" });
        const save = () => input.value !== text && set(input.value);
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") e.preventDefault(), input.blur();
          if (e.key === "Escape") (input.value = text), input.blur();
        });
        input.addEventListener("blur", save);
        return input;
      }
      default: {
        // Lists: tags, people, a list of choices or any list, as chips with a field to add one.
        const one = kind === "person";
        const chips = items.map((item, i) => {
          const target = linkTarget(item);
          const label = kind === "tags" ? `#${item.replace(/^#/, "")}` : target ? displayName(target) : item;
          const open = () => (kind === "tags" ? ctx.openTag(item.replace(/^#/, "")) : target ? ctx.openTarget(target, this.path) : null);
          return el(
            "span",
            { class: `tag is-removable${kind === "tags" || target ? " is-link" : ""}${(kind === "people" || one) && !target ? " is-unlinked" : ""}`, title: target ? `Open ${displayName(target)}` : kind === "tags" ? `Notes tagged #${item}` : null },
            (kind === "people" || one) ? icon("user", 12) : null,
            el("span", { onmousedown: (e: Event) => (e.preventDefault(), open()) }, label),
            readOnly ? null : el("button", { type: "button", title: `Remove ${label}`, onmousedown: (e: Event) => (e.preventDefault(), set(one ? "" : items.filter((_, j) => j !== i))) }, icon("close", 10)),
          );
        });
        const add = (v: string) => {
          const clean = kind === "tags" ? v.replace(/^#/, "").trim() : v.trim();
          if (!clean || items.includes(clean)) return;
          focusNext = key;
          set(one ? clean : [...items, clean]);
        };
        const input = readOnly || (one && items.length)
          ? null
          : el("input", {
              type: "text",
              class: "prop-chip-input",
              placeholder: kind === "tags" ? "Add a tag…" : kind === "people" || one ? "Add someone…" : "Add…",
              "aria-label": `Add to ${key}`,
              spellcheck: "false",
            });
        if (input) {
          const choices = (prop?.items?.enum ?? []).map((v): Option => ({ value: v, label: v, icon: "check" }));
          const source =
            kind === "tags"
              ? (q: string) => ranked(q.replace(/^#/, ""), ctx.tags().filter((t) => !items.includes(t.display)).map((t): Option => ({ value: t.display, label: `#${t.display}`, detail: String(t.notes), icon: "hash" })))
              : kind === "people" || one
                ? (q: string) => personOptions(q, items)
                : (q: string) => ranked(q, choices.filter((o) => !items.includes(o.value)));
          suggest(input, source, add, kind !== "choices");
          input.addEventListener("keydown", (e) => {
            if (e.key === "Backspace" && !input.value && items.length && !one) set(items.slice(0, -1));
          });
        }
        return el("div", { class: "prop-chips" }, ...chips, input);
      }
    }
  }

  /** "Add property": the properties this note can still have, by name, type and what they do; or a name of your own. */
  adder(view: EditorView, known: Record<string, PropSchema>, used: Set<string>): HTMLElement {
    const input = el("input", { type: "text", class: "prop-add-input", placeholder: "Property name", "aria-label": "New property's name", spellcheck: "false" });
    const button = el("button", { type: "button", class: "prop-add" }, icon("plus", 13), "Add property");
    const wrap = el("div", { class: "prop-add-wrap" }, button);
    const open = () => {
      wrap.replaceChildren(input);
      input.focus();
    };
    button.addEventListener("mousedown", (e) => (e.preventDefault(), open()));
    const options = Object.entries(known)
      .filter(([k]) => !used.has(k))
      .map(([k, p]): Option => ({ value: k, label: k, detail: KIND_NAME[propKind(k, p, { kind: "empty", from: 0, to: 0 })], icon: "sliders" }));
    suggest(input, (q) => ranked(q, options), (name) => {
      const key = name.trim().replace(/:$/, "");
      if (!/^[^\s#:-][^:]*$/.test(key)) return;
      if (used.has(key)) return void (focusNext = key, view.dispatch({}));
      addKey(view, key, known[key]);
    });
    input.addEventListener("blur", () => setTimeout(() => !input.isConnected || document.activeElement === input || wrap.replaceChildren(button), 0));
    input.addEventListener("keydown", (e) => e.key === "Escape" && wrap.replaceChildren(button));
    return wrap;
  }
}

/** Settings files list title and tags like any note; they're not settings to suggest. */
const SKIP = new Set(["title", "tags"]);

/** Add `key` with its default (or an empty value) and focus its control. */
function addKey(view: EditorView, key: string, p: PropSchema | undefined) {
  const value: SettingValue = p?.default !== undefined ? (p.default as SettingValue) : p?.type === "boolean" ? false : p?.type === "array" ? [] : p?.enum ? p.enum[0] : "";
  focusNext = key;
  commit(view, key, value);
}

/** Put the cursor in the front matter, which shows it as YAML. */
function reveal(view: EditorView) {
  view.dispatch({ selection: { anchor: view.state.doc.line(Math.min(2, view.state.doc.lines)).to }, scrollIntoView: true });
  view.focus();
}

export function propertyTable(yaml: string, path: string, bad: Record<string, string>, types: PropertyTypes): WidgetType {
  return new PropertyTableWidget(yaml, path, bad, types);
}
