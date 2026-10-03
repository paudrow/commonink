// Settings (⌘, or "Open settings" in ⌘⇧P), as VS Code does it: a search box that filters as you type,
// then every setting by section, each with a title, a line on what it does, and its control. main.ts
// supplies the values and what changing each one does; a change applies at once and the list redraws.
import { el, icon } from "./dom.ts";
import { formatKeys } from "./keys.ts";
import { openModal } from "./modal.ts";
import { localSteps } from "./connectAgent.ts";
import { button } from "./widgets/core.ts";
import type { OptionalItem } from "./sidebar.ts";
import { INKS, progressText, type InkId, type InkStats } from "./inks.ts";
import type { Billing } from "./api.ts";
import { PRESETS, type PresetId } from "../../src/core/presets.ts";

export type Section = "Appearance" | "Sidebar" | "Editor" | "Keyboard" | "Agents" | "Workspace" | "Integrations" | "Plan" | "Danger zone";
/** Whose a setting is, as VS Code splits User and Workspace: yours (this browser, or your settings file), or everyone's here. */
export type Scope = "user" | "workspace";
export const scopeOf = (s: Setting): Scope => (s.section === "Workspace" ? "workspace" : "user");
export const SECTIONS: Section[] = ["Appearance", "Sidebar", "Editor", "Keyboard", "Agents", "Workspace", "Integrations", "Plan", "Danger zone"];

/**
 * Accounts connected to other services, in one place (online, where the server has Google): what's
 * connected, what each is allowed, and connecting or disconnecting. Calendar and Contacts keep their
 * own shortcuts to connect; this is where all of them are.
 */
export interface Integrations {
  /** Google on this server, and the person's connection; null where it has none. */
  status(): Promise<{ mode: string; connection: { account: string; canWrite: boolean; contacts: "none" | "read" | "write" } | null } | null>;
  connectCalendar(): void;
  connectContacts(write: boolean): void;
  disconnect(): Promise<void>;
}

export type Theme = "system" | "light" | "dark";

export type Control =
  | { kind: "toggle"; on: boolean; set(on: boolean): void }
  | { kind: "choice"; value: string; options: Array<{ value: string; label: string }>; set(value: string): void }
  | { kind: "button"; label: string; run(): void; danger?: boolean }
  /** A line of text, handed over when it's changed and you leave it (or press Enter). */
  | { kind: "text"; value: string; placeholder?: string; set(value: string): void }
  | { kind: "custom"; render(): HTMLElement[] };

export interface Setting {
  id: string;
  section: Section;
  title: string;
  description: string;
  /** More words search finds it by. */
  keywords?: string;
  /** Its key in the settings file (Config/Users/<you>.md, or Config/Settings.md for the workspace's). */
  key?: string;
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
  /** Whether the workspace is gamified (gamify.ts), and whether you may change that: anyone who can edit its notes. */
  gamified: { on: boolean; canChange: boolean };
  setGamified(on: boolean): void;
  /** How agents are told to organize the vault (presets.ts), or null if it hasn't been picked. */
  organizing: PresetId | null;
  setOrganizing(id: PresetId): void;
  /** Whether the workspace's hidden folders show among the sidebar's folders anyway. */
  showHidden: boolean;
  setShowHidden(on: boolean): void;
  /** The folders the sidebar hides, for everyone here (hiddenFolders.ts), and whether you may change them. */
  hiddenFolders: { list: string[]; canChange: boolean };
  setHiddenFolders(list: string[]): void;
  /** Locally, where the vault and the `commonink` command are, for the agent setup; online, null. */
  localVault: { vault?: string; projectRoot?: string } | null;
  shortcuts(): void;
  connectAgent(): void;
  /** Online, where billing is set up: your plan (null while it loads, or where there's none). */
  billing: Billing | null;
  subscribe(interval: "month" | "year"): void;
  manageBilling(): void;
  /** Open the note every agent reads first (Config/AGENTS.md, or a root AGENTS.md from before Config/). */
  agentInstructions(): void;
  /** Online, opens Delete your account (deleteAccount.ts), which asks you to type your email; locally, null. */
  deleteAccount: (() => void) | null;
  /** Online: connected accounts (Integrations). Locally, none. */
  integrations?: Integrations | null;
}

/** Each sidebar item that waits until it's in use: its name, and what puts it in the sidebar by itself. */
const WAITING: Array<{ item: OptionalItem; name: string; when: string; keywords: string }> = [
  { item: "contacts", name: "Contacts", when: "you add someone", keywords: "people crm" },
  { item: "calendar", name: "Calendar", when: "you add a calendar or an event", keywords: "events meetings schedule" },
  { item: "assets", name: "Assets", when: "you upload a file", keywords: "files images uploads attachments" },
  { item: "smart", name: "Views", when: "you save one", keywords: "saved searches queries smart folders" },
];

export function appSettings(app: SettingsApp): Setting[] {
  const game = app.gamified.on;
  // A new workspace's sidebar leaves these out until they're in use; each can stay there from the start instead.
  // Not gamified, the sidebar has them all from the start, so there's nothing to pin.
  const sidebar = !game ? [] : WAITING.map(
    ({ item, name, when, keywords }): Setting => ({
      id: `sidebar-${item}`,
      key: "always_show",
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
      key: "theme",
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
      id: "ink",
      key: "ink",
      section: "Appearance",
      title: "Ink",
      description: game ? "The color of links, ticks and highlights. Indigo is yours from the start; use the app to earn the others." : "The color of links, ticks and highlights.",
      keywords: "accent color colour palette unlock sepia viridian vermilion cobalt iron gall",
      control: { kind: "custom", render: () => [inkPicker(app)] },
    },
    ...sidebar,
    {
      id: "show-hidden",
      key: "show_hidden_folders",
      section: "Sidebar",
      title: "Show hidden folders",
      description: `The workspace hides ${app.hiddenFolders.list.length ? app.hiddenFolders.list.join(", ") : "no folders"} from the sidebar's folders. On, they show anyway, dimmed. The row under the folders does the same.`,
      keywords: "hidden folders config templates settings.md yaml sidebar show unhide",
      control: { kind: "toggle", on: app.showHidden, set: app.setShowHidden },
    },
    {
      id: "line-numbers",
      key: "line_numbers",
      section: "Editor",
      title: "Line numbers",
      description: "Number the lines beside a note's text. Vim's :set nu does the same.",
      keywords: "gutter nu number",
      control: { kind: "toggle", on: app.lineNumbers, set: app.setLineNumbers },
    },
    {
      id: "code-wrap",
      key: "wrap_code",
      section: "Editor",
      title: "Wrap code",
      description: "Wrap long lines in code blocks instead of scrolling them. A block marked wrap or nowrap keeps its own.",
      keywords: "code blocks long lines scroll nowrap word wrap",
      control: { kind: "toggle", on: app.codeWrap, set: app.setCodeWrap },
    },
    {
      id: "html-mode",
      key: "html_notes",
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
      key: "vim",
      section: "Keyboard",
      title: "Vim keys",
      description: "Edit notes and tasks with Vim's keys and modes.",
      keywords: "vim keybindings modal editing",
      control: { kind: "toggle", on: app.vim, set: app.setVim },
    },
    {
      id: "vim-display-lines",
      key: "vim_display_lines",
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
    ...(!game ? [] : [{
      id: "shortcut-tips",
      key: "shortcut_tips",
      section: "Keyboard",
      title: "Shortcut tips",
      description: "When you've clicked a button that has a keyboard shortcut a few times, a tip says once which keys do the same.",
      keywords: "keys hints hotkeys learn toast",
      control: { kind: "toggle", on: app.shortcutTips, set: app.setShortcutTips },
    } satisfies Setting]),
    app.localVault
      ? {
          id: "connect-agent",
          section: "Agents",
          title: "Connect an agent",
          description: "Let Claude Code, Claude Desktop, Cursor or another MCP client read and edit this workspace. Its edits show up here live.",
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
    {
      id: "agent-instructions",
      section: "Workspace",
      title: "Agent instructions",
      description: "What every agent here reads before it works in this workspace: how to file, name and write notes. It's AGENTS.md in the Config folder, a note you edit like any other.",
      keywords: "agents.md agent ai instructions conventions rules claude cursor mcp prompt heuristics",
      control: { kind: "button", label: "Open AGENTS.md", run: app.agentInstructions },
    },
    {
      id: "gamified",
      key: "gamified",
      section: "Workspace",
      title: "Unlock as you go",
      description: app.gamified.canChange
        ? "For everyone in this workspace. On, the sidebar grows as you use it, inks are earned, tips teach shortcuts and clearing Today gets a small celebration. Off, everything is there from the start, with nothing to unlock and no celebrations."
        : `${game ? "On" : "Off"} for this workspace: ${game ? "the sidebar grows as you use it, inks are earned, and tips and small celebrations show up" : "everything is there from the start"}. You can view this workspace but not change it.`,
      keywords: "gamification gamified game progressive disclosure unlock earn rewards celebrate tips beginner simple everything admin owner",
      disabled: !app.gamified.canChange,
      control: { kind: "toggle", on: game, set: app.setGamified },
    },
    {
      id: "hidden-folders",
      key: "hidden_folders",
      section: "Workspace",
      title: "Hidden folders",
      description: "Folders the sidebar leaves out, with the folders in them, for everyone here. Separate them with commas. Search, Notes, links and agents still find their notes.",
      keywords: "hide hidden folders config templates sidebar tree",
      disabled: !app.hiddenFolders.canChange,
      control: {
        kind: "text",
        value: app.hiddenFolders.list.join(", "),
        placeholder: "Config, Templates",
        set: (v) => app.setHiddenFolders([...new Set(v.split(",").map((f) => f.trim().replace(/^\/+|\/+$/g, "")).filter(Boolean))]),
      },
    },
    {
      id: "organizing",
      key: "organizing",
      section: "Workspace",
      title: "Organizing style",
      description: `How your agents file notes: ${PRESETS.filter((p) => p.rules).map((p) => p.name).join(", ")}, or no rules. Changing it rewrites the Organizing section of Config/AGENTS.md and leaves the rest of that note alone.`,
      keywords: "para second brain zettelkasten journal folders organize organization agents.md preset structure",
      disabled: !app.gamified.canChange,
      control: {
        kind: "choice",
        value: app.organizing ?? "none",
        options: PRESETS.map((p) => ({ value: p.id, label: p.id === "none" ? "No rules" : p.name })),
        set: (v) => app.setOrganizing(v as PresetId),
      },
    },
    ...(app.integrations
      ? [
          {
            id: "google",
            section: "Integrations" as const,
            title: "Google",
            description: "Your Google account: Calendar shows your calendars, Contacts keeps People/ in step with your address book. Only you see your calendars; synced contacts are the workspace's.",
            keywords: "google calendar contacts account connect disconnect integration sync oauth",
            control: { kind: "custom" as const, render: () => googleRow(app.integrations!) },
          },
        ]
      : []),
    ...planSettings(app),
    ...(app.deleteAccount
      ? [
          {
            id: "delete-account",
            section: "Danger zone",
            title: "Delete your account",
            description: "Deletes your account for good, with your own workspaces and every note and file in them. You'll see what goes and what stays, can export everything first, and type your email to confirm. It can't be undone.",
            keywords: "delete remove close erase account gdpr leave danger",
            control: { kind: "button", label: "Delete account…", run: app.deleteAccount, danger: true },
          } satisfies Setting,
        ]
      : []),
  ];
}

const day = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });

/** What your plan is, in a sentence. */
export function planText(b: Billing): string {
  const p = b.plan;
  const paid = p.interval ? b.plans[p.interval].label : "";
  switch (p.status) {
    case "free":
      return "Everything is free on this server.";
    case "trial":
      return `Your free trial runs until ${day(p.trialEnds!)}. Subscribe any time to keep editing after that.`;
    case "active":
      return p.cancelling
        ? `You subscribe at ${paid} until ${day(p.periodEnd!)}, when it ends. Resume it from Manage billing.`
        : `You subscribe at ${paid}${p.periodEnd ? `, renewing ${day(p.periodEnd)}` : ""}. Thank you.`;
    case "past_due":
      return `Your last payment didn't go through. Update your card by ${day(p.graceEnds!)} to keep editing.`;
    case "lapsed":
      return "Your plan has ended, so the workspaces you own are read-only: everyone can still read and export them. Subscribe to edit again.";
  }
}

/** Plan: your plan, and the way to subscribe or manage it. Only where billing is set up. */
function planSettings(app: SettingsApp): Setting[] {
  const b = app.billing;
  if (!b?.on) return [];
  const keywords = "plan billing subscription subscribe pay payment price pricing stripe card invoice receipt trial cancel upgrade";
  const subscribed = b.plan.status === "active" || b.plan.status === "past_due";
  const settings: Setting[] = [{ id: "plan", section: "Plan", title: "Your plan", description: planText(b), keywords, control: { kind: "custom", render: () => [] } }];
  if (!subscribed) {
    settings.push(
      { id: "subscribe-year", section: "Plan", title: `Yearly: ${b.plans.year.label}`, description: "Billed once a year. Every workspace you own, with everyone you invite.", keywords, control: { kind: "button", label: "Subscribe yearly", run: () => app.subscribe("year") } },
      { id: "subscribe-month", section: "Plan", title: `Monthly: ${b.plans.month.label}`, description: "Billed every month. Cancel any time.", keywords, control: { kind: "button", label: "Subscribe monthly", run: () => app.subscribe("month") } },
    );
  }
  if (b.plan.customer) {
    settings.push({ id: "manage-billing", section: "Plan", title: "Manage billing", description: "Change your card or plan, see invoices, or cancel, on Stripe.", keywords, control: { kind: "button", label: "Manage billing…", run: app.manageBilling } });
  }
  return settings;
}

/** The Google row: who's connected, what Calendar and Contacts may do, and the buttons to change it. Filled in once the server answers. */
function googleRow(int: Integrations): HTMLElement[] {
  const box = el("div", { class: "st-integration" }, el("span", { class: "st-desc" }, "Checking…"));
  const line = (name: string, state: string, ...actions: Array<HTMLElement | null>) =>
    el("div", { class: "st-int-line" }, el("span", { class: "st-int-name" }, name), el("span", { class: "st-desc" }, state), ...actions.filter((a): a is HTMLElement => !!a));
  const fill = () =>
    void int.status().then(
      (s) => {
        if (!s || s.mode === "off") return box.replaceChildren(el("span", { class: "st-desc" }, "Google isn't set up on this server: its owner sets GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and INTEGRATIONS_KEY."));
        const c = s.connection;
        const contacts = c?.contacts ?? "none";
        box.replaceChildren(
          el("span", { class: "st-desc" }, c ? `Connected as ${c.account}.${s.mode === "mock" ? " (A stand-in for Google on this Preview.)" : ""}` : "Not connected."),
          line("Calendar", !c ? "Off" : c.canWrite ? "Reads your calendars, and links meeting notes to events" : "Reads your calendars", !c ? button("Connect", null, int.connectCalendar) : null),
          line(
            "Contacts",
            contacts === "write" ? "Syncs into People/, and sends edits here back" : contacts === "read" ? "Syncs into People/ (read only)" : "Off",
            contacts === "none" ? button("Connect", null, () => int.connectContacts(false)) : contacts === "read" ? button("Allow editing", null, () => int.connectContacts(true)) : null,
          ),
          c ? el("div", { class: "st-int-line" }, button("Disconnect Google", null, () => void int.disconnect().then(fill))) : "",
        );
      },
      () => box.replaceChildren(el("span", { class: "st-desc" }, "Couldn't check Google. Try again later.")),
    );
  fill();
  return [box];
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
  if (c.kind === "text") {
    return el("input", {
      type: "text",
      id,
      class: "st-text",
      value: c.value,
      placeholder: c.placeholder,
      spellcheck: "false",
      autocomplete: "off",
      disabled: s.disabled,
      "aria-describedby": describedBy,
      onchange: (e: Event) => c.set((e.target as HTMLInputElement).value),
    });
  }
  if (c.kind === "button") {
    const b = button(c.label, null, c.run, c.danger ? "danger" : "");
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
  const key = s.key ? el("code", { class: "st-key", title: "Its name in the settings file" }, s.key) : null;
  const title = s.control.kind === "toggle" || s.control.kind === "choice" || s.control.kind === "text" ? el("label", { class: "st-title", for: id }, s.title) : el("h4", { class: "st-title" }, s.title);
  // A checkbox sits beside its description, as VS Code has it, and the whole line toggles it. Other controls go under.
  title.id = `${id}-title`;
  if (s.control.kind === "toggle") control.setAttribute("aria-labelledby", title.id); // its name is the title, not the title and the line too
  const head = key ? el("div", { class: "st-name" }, title, key) : title;
  const body = s.control.kind === "toggle" ? [head, el("label", { class: "st-inline" }, control, desc)] : [head, desc, control];
  return el("div", { class: `st-row${s.disabled ? " is-disabled" : ""}`, "data-setting": s.id }, ...body);
}

let current: { focus(): void; render(): void; close(): void } | null = null;

/** Redraw Settings, if it's open: for a change that applies once the server has it (a workspace's setting). */
export function refreshSettings() {
  current?.render();
}

/** Close Settings, if it's open. */
export function closeSettings() {
  current?.close();
}

/** Open Settings (or, when it's open, go to its search box), with `query` in the search box. */
export function openSettings(settings: () => Setting[], opts: { query?: string; scope?: Scope; openFile?(scope: Scope): void } = {}) {
  let scope: Scope = opts.scope ?? "user";
  if (current) return current.focus();
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
  // User and Workspace, as in VS Code, each with its settings file a click away.
  const tab = (t: Scope, label: string) =>
    el("button", { type: "button", role: "tab", class: "st-tab", "aria-controls": "st-list", onclick: () => ((scope = t), render(), search.focus()) }, label);
  const tabs: Record<Scope, HTMLElement> = { user: tab("user", "User"), workspace: tab("workspace", "Workspace") };
  const fileBtn = el("button", { type: "button", class: "st-file", onclick: () => (close(), opts.openFile?.(scope)) }, icon("code", 14), "Open settings file");
  fileBtn.hidden = !opts.openFile;
  const list = el("div", { class: "st-list", id: "st-list" });

  const settingOf = (node: EventTarget | null) => (node instanceof Element ? node.closest<HTMLElement>("[data-setting]")?.dataset.setting : undefined);
  /** Draw the settings the search finds, with the focus back on `focused`'s control. */
  const render = (focused = settingOf(document.activeElement)) => {
    const matched = matchSettings(search.value, settings());
    // A search that only finds the other tab's settings goes there.
    if (search.value.trim() && !matched.some((s) => scopeOf(s) === scope) && matched.length) scope = scopeOf(matched[0]);
    const shown = matched.filter((s) => scopeOf(s) === scope);
    for (const [t, b] of Object.entries(tabs)) b.setAttribute("aria-selected", String(t === scope));
    fileBtn.title = scope === "user" ? "Open your settings file (Config/Users/…)" : "Open the workspace's settings file (Config/Settings.md)";
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

  const modal = openModal({
    title: "Settings",
    icon: "gear",
    head: [el("kbd", { class: "st-keys", "aria-hidden": "true" }, formatKeys("Mod-,"))],
    content: [
      el("div", { class: "st-tabs" }, el("div", { role: "tablist", "aria-label": "Whose settings", class: "st-tablist" }, tabs.user, tabs.workspace), fileBtn),
      el("div", { class: "st-bar" }, search, found),
      list,
    ],
    id: "settings",
    pageClass: "",
    boxClass: "st-box",
    headClass: "st-head",
    titleId: "st-title",
    // On a touch screen, don't bring up the keyboard until you tap the search box.
    focus: matchMedia("(pointer: coarse)").matches ? undefined : search,
    onClose: () => (current = null),
  });
  const close = () => modal.close();
  render();
  current = { focus: () => search.focus(), render: () => render(), close };
}

