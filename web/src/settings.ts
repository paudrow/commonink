// Settings (⌘, or "Open settings" in ⌘⇧P), as VS Code does it: a search box that filters as you type,
// then every setting by section, each with a title, a line on what it does, and its control. main.ts
// supplies the values and what changing each one does; a change applies at once and the list redraws.
import { el, icon } from "./dom.ts";
import { formatKeys } from "./keys.ts";
import { trapKeys } from "./modal.ts";
import { localSteps } from "./connectAgent.ts";
import { button } from "./widgets/core.ts";

export type Section = "Appearance" | "Editor" | "Keyboard" | "Agents";
export const SECTIONS: Section[] = ["Appearance", "Editor", "Keyboard", "Agents"];

export type Theme = "system" | "light" | "dark";

export type Control =
  | { kind: "toggle"; on: boolean; set(on: boolean): void }
  | { kind: "choice"; value: string; options: Array<{ value: string; label: string }>; set(value: string): void }
  | { kind: "button"; label: string; run(): void }
  | { kind: "custom"; render(): HTMLElement[] };

export interface Setting {
  id: string;
  section: Section;
  title: string;
  description: string;
  /** More words search finds it by. */
  keywords?: string;
  /** Shown but greyed out: it only matters once another setting is on. */
  disabled?: boolean;
  control: Control;
}

/** What the settings need from the app: each value, and how to change it. */
export interface SettingsApp {
  theme: Theme;
  setTheme(theme: Theme): void;
  lineNumbers: boolean;
  setLineNumbers(on: boolean): void;
  codeWrap: boolean;
  setCodeWrap(on: boolean): void;
  htmlMode: "preview" | "source";
  setHtmlMode(mode: "preview" | "source"): void;
  vim: boolean;
  setVim(on: boolean): void;
  vimDisplayLines: boolean;
  setVimDisplayLines(on: boolean): void;
  /** Locally, where the vault and the `quire` command are, for the agent setup; online, null. */
  localVault: { vault?: string; projectRoot?: string } | null;
  shortcuts(): void;
  connectAgent(): void;
}

export function appSettings(app: SettingsApp): Setting[] {
  return [
    {
      id: "theme",
      section: "Appearance",
      title: "Theme",
      description: "Light, dark, or whichever your system uses.",
      keywords: "dark light mode colors appearance",
      control: {
        kind: "choice",
        value: app.theme,
        options: [
          { value: "system", label: "System" },
          { value: "light", label: "Light" },
          { value: "dark", label: "Dark" },
        ],
        set: (v) => app.setTheme(v as Theme),
      },
    },
    {
      id: "line-numbers",
      section: "Editor",
      title: "Line numbers",
      description: "Number the lines beside a note's text. Vim's :set nu does the same.",
      keywords: "gutter nu number",
      control: { kind: "toggle", on: app.lineNumbers, set: app.setLineNumbers },
    },
    {
      id: "code-wrap",
      section: "Editor",
      title: "Wrap code",
      description: "Wrap long lines in code blocks instead of scrolling them. A block marked wrap or nowrap keeps its own.",
      keywords: "code blocks long lines scroll nowrap word wrap",
      control: { kind: "toggle", on: app.codeWrap, set: app.setCodeWrap },
    },
    {
      id: "html-mode",
      section: "Editor",
      title: "HTML notes",
      description: `Show HTML notes as the page they make, or as their source. ${formatKeys("Mod-e")} switches while one is open.`,
      keywords: "html source preview code",
      control: {
        kind: "choice",
        value: app.htmlMode,
        options: [
          { value: "preview", label: "Preview" },
          { value: "source", label: "Source" },
        ],
        set: (v) => app.setHtmlMode(v as "preview" | "source"),
      },
    },
    {
      id: "vim",
      section: "Keyboard",
      title: "Vim keys",
      description: "Edit notes and tasks with Vim's keys and modes.",
      keywords: "vim keybindings modal editing",
      control: { kind: "toggle", on: app.vim, set: app.setVim },
    },
    {
      id: "vim-display-lines",
      section: "Keyboard",
      title: "Vim: j and k by screen line",
      description: "With Vim keys on, j and k move by the line on screen (gj, gk), not the line in the file.",
      keywords: "vim gj gk wrap wrapped visual display lines movement",
      disabled: !app.vim,
      control: { kind: "toggle", on: app.vimDisplayLines, set: app.setVimDisplayLines },
    },
    {
      id: "shortcuts",
      section: "Keyboard",
      title: "Keyboard shortcuts",
      description: "Every shortcut, by where it works. Press ? anywhere you aren't typing.",
      keywords: "keys keybindings hotkeys cheat sheet help",
      control: { kind: "button", label: "Show shortcuts", run: app.shortcuts },
    },
    app.localVault
      ? {
          id: "connect-agent",
          section: "Agents",
          title: "Connect an agent",
          description: "Let Claude Code, Claude Desktop, Cursor or another MCP client read and edit this vault. Its edits show up here live.",
          keywords: "agent mcp claude cursor connect ai assistant",
          control: { kind: "custom", render: () => localSteps(app.localVault!) },
        }
      : {
          id: "connect-agent",
          section: "Agents",
          title: "Connected agents",
          description: "The agents you've connected over MCP, and how to connect another.",
          keywords: "agent mcp claude cursor connect ai assistant revoke",
          control: { kind: "button", label: "Connected agents…", run: app.connectAgent },
        },
  ];
}

/** The settings a search finds: those with every word of it in their section, title, description or keywords. */
export function matchSettings(query: string, settings: Setting[]): Setting[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return settings;
  return settings.filter((s) => {
    const options = s.control.kind === "choice" ? s.control.options.map((o) => o.label).join(" ") : "";
    const text = `${s.section} ${s.title} ${s.description} ${s.keywords ?? ""} ${options}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });
}

function controlFor(s: Setting, id: string, describedBy: string): HTMLElement {
  const c = s.control;
  if (c.kind === "toggle") {
    return el("input", { type: "checkbox", id, class: "st-check", checked: c.on, disabled: s.disabled, "aria-describedby": describedBy, onchange: (e: Event) => c.set((e.target as HTMLInputElement).checked) });
  }
  if (c.kind === "choice") {
    return el(
      "select",
      { id, class: "st-select", disabled: s.disabled, "aria-describedby": describedBy, onchange: (e: Event) => c.set((e.target as HTMLSelectElement).value) },
      ...c.options.map((o) => el("option", { value: o.value, selected: o.value === c.value }, o.label)),
    );
  }
  if (c.kind === "button") {
    const b = button(c.label, null, c.run);
    b.id = id;
    b.setAttribute("aria-describedby", describedBy);
    return b;
  }
  return el("div", { id, class: "st-custom qw-guide-how" }, ...c.render());
}

function row(s: Setting): HTMLElement {
  const id = `st-${s.id}`;
  const desc = el("span", { class: "st-desc", id: `${id}-desc` }, s.description);
  const control = controlFor(s, id, desc.id);
  const title = s.control.kind === "toggle" || s.control.kind === "choice" ? el("label", { class: "st-title", for: id }, s.title) : el("h4", { class: "st-title" }, s.title);
  // A checkbox sits beside its description, as VS Code has it, and the whole line toggles it. Other controls go under.
  title.id = `${id}-title`;
  if (s.control.kind === "toggle") control.setAttribute("aria-labelledby", title.id); // its name is the title, not the title and the line too
  const body = s.control.kind === "toggle" ? [title, el("label", { class: "st-inline" }, control, desc)] : [title, desc, control];
  return el("div", { class: `st-row${s.disabled ? " is-disabled" : ""}`, "data-setting": s.id }, ...body);
}

let current: { focus(): void } | null = null;

/** Open Settings (or, when it's open, go to its search box), with `query` in the search box. */
export function openSettings(settings: () => Setting[], opts: { query?: string } = {}) {
  if (current) return current.focus();
  const back = document.activeElement as HTMLElement | null;
  const search = el("input", {
    type: "search",
    class: "st-search",
    placeholder: "Search settings",
    "aria-label": "Search settings",
    "aria-controls": "st-list",
    autocomplete: "off",
    spellcheck: "false",
    value: opts.query ?? "",
  }) as HTMLInputElement;
  const found = el("span", { class: "st-found", role: "status" });
  const list = el("div", { class: "st-list", id: "st-list" });

  const settingOf = (node: EventTarget | null) => (node instanceof Element ? node.closest<HTMLElement>("[data-setting]")?.dataset.setting : undefined);
  /** Draw the settings the search finds, with the focus back on `focused`'s control. */
  const render = (focused = settingOf(document.activeElement)) => {
    const shown = matchSettings(search.value, settings());
    const sections = SECTIONS.flatMap((section) => {
      const rows = shown.filter((s) => s.section === section);
      return rows.length ? [el("section", { class: "st-section", "aria-labelledby": `st-h-${section}` }, el("h3", { id: `st-h-${section}` }, section), ...rows.map(row))] : [];
    });
    list.replaceChildren(...(sections.length ? sections : [el("p", { class: "st-empty" }, "No settings match.")]));
    found.textContent = search.value.trim() ? `${shown.length} ${shown.length === 1 ? "setting" : "settings"} found` : "";
    if (focused) list.querySelector<HTMLElement>(`[data-setting="${focused}"] :is(input, select, button)`)?.focus();
  };
  // A change applies at once; redraw so dependent settings (Vim's j and k) follow.
  // Some changes move the focus (Source puts it in an open HTML note's editor): it comes back here.
  list.addEventListener("change", (e) => queueMicrotask(() => render(settingOf(e.target))));
  search.addEventListener("input", () => render());
  search.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowDown") return;
    e.preventDefault();
    list.querySelector<HTMLElement>("input, select, button, summary")?.focus();
  });

  const close = () => {
    page.remove();
    current = null;
    if (back?.isConnected) back.focus({ preventScroll: true });
  };
  const box = el(
    "div",
    { class: "st-box", role: "dialog", "aria-modal": "true", "aria-labelledby": "st-title", tabindex: "-1" },
    el(
      "div",
      { class: "st-head" },
      icon("gear", 16),
      el("h2", { id: "st-title" }, "Settings"),
      el("kbd", { class: "st-keys", "aria-hidden": "true" }, formatKeys("Mod-,")),
      el("button", { class: "icon-btn small", type: "button", "aria-label": "Close", title: "Close (Esc)", onclick: close }, icon("close", 15)),
    ),
    el("div", { class: "st-bar" }, search, found),
    list,
  );
  const page = el("div", { id: "settings", onmousedown: (e: Event) => e.target === page && close() }, box);
  trapKeys(page, box, close);
  document.body.append(page);
  render();
  // On a touch screen, don't bring up the keyboard until you tap the search box.
  (matchMedia("(pointer: coarse)").matches ? box : search).focus();
  current = { focus: () => search.focus() };
}

