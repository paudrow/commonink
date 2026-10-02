// Modal dialogs: the app's own ask, confirm, text prompt and "here's the link" in place of the
// browser's prompt(), confirm() and alert(), so they look like the rest of the app, follow dark
// mode, don't block the page, and work from the keyboard and with a screen reader. Esc or a click
// outside calls a dialog off, Tab stays inside it, and the focus goes back where it was after.
import { el, icon } from "./dom.ts";
import { IS_MAC } from "./panes.ts";

const FOCUSABLE = "button:not([disabled]), summary, [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

/** Tab and Shift-Tab go round `box`'s controls without leaving it. */
function cycle(box: HTMLElement, e: KeyboardEvent) {
  const stops = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => !n.closest("[hidden]"));
  const at = stops.indexOf(document.activeElement as HTMLElement);
  const next = e.shiftKey ? (at <= 0 ? stops.length - 1 : at - 1) : at === stops.length - 1 ? 0 : at + 1;
  e.preventDefault();
  stops[next]?.focus();
}

/** A modal dialog's keys: Esc closes it, and Tab and Shift-Tab go round its controls without leaving. */
export function trapKeys(page: HTMLElement, box: HTMLElement, close: () => void) {
  page.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "Tab") cycle(box, e);
  });
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

let asked = 0;

/** Draw an ask dialog; its buttons, and what it resolves to. */
function open(o: AskOptions): { box: HTMLElement; buttons: HTMLButtonElement[]; result: Promise<string | null> } {
  let done!: (v: string | null) => void;
  const result = new Promise<string | null>((resolve) => {
    const back = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    done = (v) => {
      if (!overlay.isConnected) return;
      overlay.remove();
      document.removeEventListener("keydown", onKey, true);
      if (back?.isConnected) back.focus();
      resolve(v);
    };
  });
  // Ours are the first keys to hear about: nothing under the dialog sees Esc or Tab while it's up.
  // With a dialog over this one, they're the newer one's.
  const onKey = (e: KeyboardEvent) => {
    if (overlay !== [...document.querySelectorAll(".ask")].at(-1)) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      done(null);
    } else if (e.key === "Tab") {
      e.stopPropagation();
      cycle(box, e);
    }
  };
  const buttons = o.actions.map((a) => el("button", { type: "button", class: `qw-btn${a.kind ? ` ${a.kind}` : ""}`, onclick: () => done(a.value) }, a.label));
  const said = o.body.find((b) => typeof b === "string");
  const saidId = `ask-said-${++asked}`;
  const box = el(
    "div",
    { class: "ask-box", role: "alertdialog", "aria-modal": "true", "aria-label": o.title, "aria-describedby": said ? saidId : undefined },
    el("h2", {}, o.title),
    ...o.body.map((b) => (typeof b === "string" ? el("p", { id: b === said ? saidId : undefined }, b) : b)),
    el("div", { class: "ask-actions" }, el("button", { type: "button", class: "qw-btn", onclick: () => done(null) }, o.cancel ?? "Cancel"), ...buttons),
  );
  const overlay = el("div", { class: "ask", onmousedown: (e: MouseEvent) => e.target === overlay && done(null) }, box);
  document.body.append(overlay);
  document.addEventListener("keydown", onKey, true);
  (o.focus ?? buttons.find((b) => b.classList.contains("primary")) ?? buttons[0])?.focus();
  return { box, buttons, result };
}

/**
 * A small modal with a message and buttons. Resolves to the chosen button's value, or null on
 * Cancel, Escape or a click outside.
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
  const { box, result } = open({ title: o.title, body: [...(o.note ? [o.note] : []), field], actions: [], cancel: "Done", focus: field });
  box.querySelector(".ask-actions")!.append(copy);
  copy.addEventListener("click", async () => {
    const ok = await copyText(o.url, field);
    copy.replaceChildren(icon(ok ? "check" : "copy", 14), ok ? "Copied" : `Press ${IS_MAC ? "⌘C" : "Ctrl+C"} to copy`);
    if (!ok) field.select();
  });
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
