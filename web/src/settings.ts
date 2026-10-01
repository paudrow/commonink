// Settings (⌘, or "Open settings" in ⌘⇧P), as VS Code does it: a search box that filters as you type,
// then every setting by section, each with a title, a line on what it does, and its control. main.ts
// supplies the values and what changing each one does; a change applies at once and the list redraws.
import { el, icon } from "./dom.ts";
import { formatKeys } from "./keys.ts";
import { trapKeys } from "./modal.ts";
import { localSteps } from "./connectAgent.ts";
import { button } from "./widgets/core.ts";
import type { OptionalItem } from "./sidebar.ts";
import { INKS, progressText, type InkId, type InkStats } from "./inks.ts";

export type Section = "Appearance" | "Sidebar" | "Editor" | "Keyboard" | "Agents";
export const SECTIONS: Section[] = ["Appearance", "Sidebar", "Editor", "Keyboard", "Agents"];

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
  /** The accent color in use, the inks earned, and the counts toward the rest (null until counted). */
  ink: { current: InkId; earned: InkId[]; stats: InkStats | null };
  setInk(ink: InkId): void;
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
  shortcutTips: boolean;
  setShortcutTips(on: boolean): void;
  /** The sidebar items kept showing before they're in use. */
  sidebarPinned: Partial<Record<OptionalItem, boolean>>;
  setSidebarPinned(item: OptionalItem, on: boolean): void;
  /** Locally, where the vault and the `commonink` command are, for the agent setup; online, null. */
  localVault: { vault?: string; projectRoot?: string } | null;
  shortcuts(): void;
  connectAgent(): void;
}

/** Each sidebar item that waits until it's in use: its name, and what puts it in the sidebar by itself. */
const WAITING: Array<{ item: OptionalItem; name: string; when: string; keywords: string }> = [
  { item: "contacts", name: "Contacts", when: "you add someone", keywords: "people crm" },
  { item: "calendar", name: "Calendar", when: "you add a calendar or an event", keywords: "events meetings schedule" },
  { item: "assets", name: "Assets", when: "you upload a file", keywords: "files images uploads attachments" },
  { item: "smart", name: "Smart folders", when: "you save one", keywords: "saved searches queries" },
];

export function appSettings(app: SettingsApp): Setting[] {
  // A new workspace's sidebar leaves these out until they're in use; each can stay there from the start instead.
  const sidebar = WAITING.map(
    ({ item, name, when, keywords }): Setting => ({
      id: `sidebar-${item}`,
      section: "Sidebar",
      title: `Always show ${name}`,
      description: `The sidebar shows ${name} once ${when}. Turn this on to keep it there even before then.`,
      keywords: `sidebar navigation hide show empty pin ${keywords}`,
      control: { kind: "toggle", on: !!app.sidebarPinned[item], set: (on) => app.setSidebarPinned(item, on) },
    }),
  );
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
    ...sidebar,
    {
      id: "ink",
      section: "Appearance",
      title: "Ink",
      description: "The color of links, ticks and highlights. Indigo is yours from the start; use the app to earn the others.",
      keywords: "accent color colour palette unlock sepia viridian vermilion cobalt iron gall",
      control: { kind: "custom", render: () => [inkPicker(app)] },
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
    {
      id: "shortcut-tips",
      section: "Keyboard",
      title: "Shortcut tips",
      description: "When you've clicked a button that has a keyboard shortcut a few times, a tip says once which keys do the same.",
      keywords: "keys hints hotkeys learn toast",
      control: { kind: "toggle", on: app.shortcutTips, set: app.setShortcutTips },
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

/**
 * The Ink setting: a swatch for each ink, as a radio group (arrow keys move and pick, as in any
 * group of radio buttons). A locked ink is dimmed with a lock, and says what earns it and how far
 * along you are; it can be reached, to read that, but not picked.
 */
function inkPicker(app: SettingsApp): HTMLElement {
  const { current, earned, stats } = app.ink;
  const pick = (b: HTMLElement) => {
    const id = b.dataset.ink as InkId;
    if (!earned.includes(id)) return;
    app.setInk(id);
    for (const o of options) {
      o.setAttribute("aria-checked", String(o === b));
      o.tabIndex = o === b ? 0 : -1;
    }
  };
  const options = INKS.map((ink) => {
    const open = earned.includes(ink.id);
    const count = open ? null : progressText(ink, stats);
    const goal = open ? null : el("span", { class: "ink-goal", id: `ink-goal-${ink.id}` }, ink.goal);
    const progress = count ? el("span", { class: "ink-count", id: `ink-count-${ink.id}` }, count) : null;
    return el(
      "button",
      {
        type: "button",
        role: "radio",
        class: `ink-option${open ? "" : " is-locked"}`,
        "data-ink": ink.id,
        "aria-checked": String(ink.id === current),
        "aria-disabled": open ? undefined : "true",
        "aria-describedby": [goal?.id, progress?.id].filter(Boolean).join(" ") || undefined,
        tabindex: ink.id === current ? "0" : "-1",
        title: open ? ink.name : `${ink.name}: ${ink.goal}${count ? ` (${count})` : ""}`,
        onclick: (e: Event) => pick(e.currentTarget as HTMLElement),
      },
      el("span", { class: "ink-swatch", "aria-hidden": "true" }, open ? icon("check", 14) : icon("lock", 12)),
      el("span", { class: "ink-name" }, ink.name),
      goal,
      progress,
    );
  });
  const group = el("div", { class: "ink-picker", role: "radiogroup", "aria-labelledby": "st-ink-title", "aria-describedby": "st-ink-desc" }, ...options);
  group.addEventListener("keydown", (e) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    const at = options.indexOf(e.target as HTMLButtonElement);
    if (!step || at < 0) return;
    e.preventDefault();
    const next = options[(at + step + options.length) % options.length];
    next.focus();
    pick(next);
  });
  return group;
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

