// Modal dialogs, all one shell: a title with an X in the header, Esc or a click outside closes it,
// Tab and Shift-Tab stay inside it, the focus goes back where it was after, and a footer (when it
// has one) is Cancel and then the main button. Settings, Shortcuts, Agents, Workspace settings,
// Share, Calendar, the template picker, Print and the questions below are all this. The questions
// are the app's own ask, confirm, text prompt and "here's the link", in place of the browser's
// prompt(), confirm() and alert(): they look like the rest of the app, follow dark mode, don't
// block the page, and work from the keyboard and with a screen reader.
import { el, icon } from "./dom.ts";
import { formatKeys, withKeys } from "./keys.ts";

const FOCUSABLE = "button:not([disabled]), summary, [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

/** Tab and Shift-Tab go round `box`'s controls without leaving it. */
function cycle(box: HTMLElement, e: KeyboardEvent) {
  const stops = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => !n.closest("[hidden]"));
  const at = stops.indexOf(document.activeElement as HTMLElement);
  const next = e.shiftKey ? (at <= 0 ? stops.length - 1 : at - 1) : at === stops.length - 1 ? 0 : at + 1;
  e.preventDefault();
  stops[next]?.focus();
}

export interface ModalOptions {
  /** The header's title, and what a screen reader calls the dialog. */
  title: string;
  icon?: string;
  /** More in the header, before the X (a shortcut, a help button). */
  head?: Array<Node | null>;
  content: Array<Node | null>;
  /** The footer's buttons after Cancel, the main one last. With none, there's no footer: the X closes it. */
  actions?: HTMLElement[];
  /** Cancel's label ("Done" where there's nothing to call off). */
  cancel?: string;
  /** The backdrop's id. Opening a dialog with the id of one that's open replaces it. */
  id?: string;
  /** Each dialog's own look: the backdrop's, the box's and the header's classes. */
  pageClass?: string;
  boxClass?: string;
  headClass?: string;
  role?: "dialog" | "alertdialog";
  titleId?: string;
  describedBy?: string;
  /** Takes the keyboard first; else the box itself. */
  focus?: HTMLElement;
  /** Escape here is the field's own (a rename being typed), not the dialog's. */
  ownsEscape?(target: Element): boolean;
  /** Called off: the X, Cancel, Esc or a click outside. Unless given, that just closes it. */
  onDismiss?(): void;
  /** It went, however it went. */
  onClose?(): void;
}

export interface Modal {
  page: HTMLElement;
  box: HTMLElement;
  close(): void;
}

interface Live extends Modal {
  back: HTMLElement | null;
}

/** Open dialogs, the newest last: only the newest hears the keys. */
const stack: Live[] = [];
let made = 0;

export function openModal(o: ModalOptions): Modal {
  let back = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
  const old = o.id ? stack.find((m) => m.page.id === o.id) : undefined;
  if (old) {
    back = old.back; // in its place, so the focus goes back where the first one found it
    old.back = null;
    old.close();
  }
  const titleId = o.titleId ?? `modal-title-${++made}`;
  const dismiss = () => (o.onDismiss ? o.onDismiss() : me.close());
  const onKey = (e: KeyboardEvent) => {
    if (stack.at(-1) !== me) return; // a dialog over this one has the keys
    if (e.key === "Escape" && !o.ownsEscape?.(e.target as Element)) {
      e.preventDefault();
      e.stopPropagation();
      dismiss();
    } else if (e.key === "Tab") {
      e.stopPropagation();
      cycle(box, e);
    }
  };
  const footer = o.actions?.length || o.cancel ? el("div", { class: "ask-actions" }, el("button", { type: "button", class: "qw-btn", onclick: dismiss }, o.cancel ?? "Cancel"), ...(o.actions ?? [])) : null;
  const box = el(
    "div",
    { class: o.boxClass ?? "ask-box", role: o.role ?? "dialog", "aria-modal": "true", "aria-labelledby": titleId, "aria-describedby": o.describedBy, tabindex: "-1" },
    el(
      "div",
      { class: o.headClass ?? "modal-head" },
      o.icon ? icon(o.icon, 16) : null,
      el("h2", { id: titleId }, o.title),
      ...(o.head ?? []),
      el("button", { class: "icon-btn small modal-x", type: "button", title: withKeys("Close", "Escape"), "aria-label": "Close", onclick: dismiss }, icon("close", 15)),
    ),
    ...o.content,
    footer,
  );
  const page = el("div", { id: o.id, class: o.pageClass ?? "ask", onmousedown: (e: MouseEvent) => e.target === page && dismiss() }, box);
  const me: Live = {
    page,
    box,
    back,
    close() {
      const at = stack.indexOf(me);
      if (at < 0) return;
      stack.splice(at, 1);
      page.remove();
      document.removeEventListener("keydown", onKey, true);
      if (me.back?.isConnected) me.back.focus({ preventScroll: true });
      o.onClose?.();
    },
  };
  stack.push(me);
  // Ours are the first keys to hear about: nothing under the dialog sees Esc or Tab while it's up.
  document.addEventListener("keydown", onKey, true);
  document.body.append(page);
  (o.focus ?? box).focus();
  return me;
}

export interface AskAction {
  label: string;
  value: string;
  kind?: "primary" | "danger";
}

export interface AskOptions {
  title: string;
  body: Array<string | HTMLElement>;
  actions: AskAction[];
  /** Takes the keyboard first (a field in `body`); else the main button. */
  focus?: HTMLElement;
  /** The button that calls it off ("Cancel"). */
  cancel?: string;
}

/** Draw an ask dialog; its buttons, and what it resolves to. */
function open(o: AskOptions & { extra?: HTMLElement[] }): { box: HTMLElement; buttons: HTMLButtonElement[]; result: Promise<string | null> } {
  let resolve!: (v: string | null) => void;
  const result = new Promise<string | null>((r) => (resolve = r));
  const done = (v: string | null) => (m.close(), resolve(v));
  const buttons = o.actions.map((a) => el("button", { type: "button", class: `qw-btn${a.kind ? ` ${a.kind}` : ""}`, onclick: () => done(a.value) }, a.label));
  const said = o.body.find((b) => typeof b === "string");
  const saidId = `ask-said-${++made}`;
  const m = openModal({
    title: o.title,
    role: "alertdialog",
    describedBy: said ? saidId : undefined,
    content: o.body.map((b) => (typeof b === "string" ? el("p", { id: b === said ? saidId : undefined }, b) : b)),
    actions: [...buttons, ...(o.extra ?? [])],
    cancel: o.cancel ?? "Cancel",
    focus: o.focus ?? buttons.find((b) => b.classList.contains("primary")) ?? buttons[0],
    onDismiss: () => done(null),
  });
  return { box: m.box, buttons, result };
}

/**
 * A small modal with a message and buttons. Resolves to the chosen button's value, or null on
 * Cancel, the X, Escape or a click outside.
 */
export function ask(o: AskOptions): Promise<string | null> {
  return open(o).result;
}

/**
 * Ask before doing something: true if they said go. A `danger` one (deleting, disconnecting) has a
 * red button; either way its button has the focus, so Enter says yes and Esc says no.
 */
export async function confirmAction(o: { title: string; body?: string | string[]; action: string; danger?: boolean }): Promise<boolean> {
  const body = o.body === undefined ? [] : typeof o.body === "string" ? [o.body] : o.body;
  return (await ask({ title: o.title, body, actions: [{ label: o.action, value: "go", kind: o.danger ? "danger" : "primary" }] })) === "go";
}

/** Ask for a line of text, starting from `value`. Enter takes it; null if called off or left empty. */
export async function askText(o: { title: string; label: string; action: string; value?: string; placeholder?: string; hint?: string }): Promise<string | null> {
  const input = el("input", { type: "text", value: o.value ?? "", placeholder: o.placeholder, "aria-label": o.label, autocomplete: "off", spellcheck: "false" });
  const { buttons, result } = open({ title: o.title, body: [...(o.hint ? [o.hint] : []), input], actions: [{ label: o.action, value: "ok", kind: "primary" }], focus: input });
  const ok = buttons[0];
  const sync = () => (ok.disabled = !input.value.trim());
  sync();
  input.addEventListener("input", sync);
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.isComposing) return;
    e.preventDefault();
    if (!ok.disabled) ok.click();
  });
  input.select();
  return (await result) === "ok" ? input.value.trim() || null : null;
}

/** Put text on the clipboard: the Clipboard API, else a copy of what's selected in `field`. Whether it worked. */
async function copyText(text: string, field?: HTMLInputElement): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    if (!field) return false;
    field.focus();
    field.select();
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    }
  }
}

/**
 * Show a link to copy by hand, already selected in a read-only field, with a Copy button: for when
 * the browser wouldn't let us copy it.
 */
export async function showLink(o: { title: string; url: string; note?: string }): Promise<void> {
  const field = el("input", { type: "text", value: o.url, readonly: true, "aria-label": "Link", spellcheck: "false", onfocus: () => field.select() });
  const copy = el("button", { type: "button", class: "qw-btn primary" }, icon("copy", 14), "Copy");
  copy.addEventListener("click", async () => {
    const ok = await copyText(o.url, field);
    copy.replaceChildren(icon(ok ? "check" : "copy", 14), ok ? "Copied" : `Press ${formatKeys("Mod-c")} to copy`);
    if (!ok) field.select();
  });
  const { result } = open({ title: o.title, body: [...(o.note ? [o.note] : []), field], actions: [], extra: [copy], cancel: "Done", focus: field });
  field.select();
  await result;
}

/**
 * Copy a link. If the browser won't (no permission, an insecure page), show it to copy by hand.
 * True if it's on the clipboard, so the caller can say "Link copied".
 */
export async function copyLink(url: string, o: { title: string; note?: string }): Promise<boolean> {
  if (await copyText(url)) return true;
  await showLink({ ...o, url });
  return false;
}
