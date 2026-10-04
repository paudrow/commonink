// Phone layout: below 760px a bar along the bottom goes to Today, Notes and Tasks, opens Search, and
// opens the sidebar as a drawer (Menu). The note's less-used top-bar buttons wait in a More menu (⋯),
// which rises from the bottom on a phone: on a computer, its
// history, Move, Archive, Split view and Delete; with a phone or a tablet's touch screen, nearly all
// of them. A floating button makes a note from Notes. The layout itself is in mobile.css.
import { $, el, icon } from "./dom.ts";

const PHONE = "(max-width: 760px)";
/** A phone, or a touch tablet: More holds nearly the whole bar. mobile.css has the same query. */
const TOUCH = "(max-width: 760px), (pointer: coarse) and (max-width: 1100px)";

/**
 * The top-bar buttons that More holds on a phone or a touch tablet, in menu order. mobile.css hides
 * exactly these there. An item presses the button itself, so labels, icons, shortcuts, handlers and
 * which ones show (Delete not for viewers, no history for an asset) stay the button's own.
 */
const OVERFLOW = ["#share-btn", "#note-history-btn", "#move-btn", "#archive-btn", "#split-btn", "#delete-btn", "#focus-btn", "#panel-btn", '#html-toggle [data-mode="preview"]', '#html-toggle [data-mode="source"]'];
/**
 * On a computer, More holds only the note's occasional buttons; Share, Star, Focus mode and the
 * side panel stay in the bar. Split view's button comes back to the bar, lit, while a split is open,
 * so there's a visible way to close it. mobile.css hides these on every screen.
 */
const DESKTOP = new Set(["#note-history-btn", "#move-btn", "#archive-btn", "#split-btn", "#delete-btn"]);

let drawerOpen = false;

const FOCUSABLE = "button:not([disabled]), a[href], input, select, textarea, [tabindex]:not([tabindex='-1'])";
const focusables = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => !n.closest("[hidden]"));

/** Open or close the drawer. While open, it's a modal dialog: the rest of the app is inert. */
function setDrawer(open: boolean) {
  if (open === drawerOpen) return;
  drawerOpen = open;
  const sidebar = $("#sidebar");
  const button = $("#menu-btn");
  document.body.classList.toggle("drawer-open", open);
  button.setAttribute("aria-expanded", String(open));
  $("#scrim").hidden = !open;
  for (const sel of ["#main", "#panel"]) $(sel).toggleAttribute("inert", open);
  if (open) {
    closeMore(false);
    sidebar.setAttribute("role", "dialog");
    sidebar.setAttribute("aria-modal", "true");
    sidebar.setAttribute("aria-label", "Navigation");
    focusables(sidebar)[0]?.focus();
  } else {
    for (const k of ["role", "aria-modal", "aria-label"]) sidebar.removeAttribute(k);
    // Back to the menu button, unless whatever closed the drawer already moved the focus on.
    if (!document.activeElement || document.activeElement === document.body || sidebar.contains(document.activeElement)) button.focus();
  }
}

/** Close the drawer: going somewhere (a page, a note, search) does this. */
export const closeDrawer = () => setDrawer(false);

function onDrawerKey(e: KeyboardEvent) {
  if (!drawerOpen) return;
  const sidebar = $("#sidebar");
  if (e.key === "Escape" && !(e.target as HTMLElement).closest("input, textarea")) {
    e.preventDefault();
    e.stopPropagation();
    setDrawer(false);
  } else if (e.key === "Tab") {
    const all = focusables(sidebar);
    const at = all.indexOf(document.activeElement as HTMLElement);
    const wrap = e.shiftKey ? at === 0 : at === all.length - 1;
    if (!wrap) return;
    e.preventDefault();
    all[e.shiftKey ? all.length - 1 : 0].focus();
  }
}

// ------------------------------------------------------------------ More menu

/** The buttons More offers right now: the ones this screen tucks away that the note shows. */
function moreButtons(): HTMLButtonElement[] {
  const touch = matchMedia(TOUCH).matches;
  const phone = matchMedia(PHONE).matches;
  return OVERFLOW.filter((sel) => (touch ? !(phone && sel === "#split-btn") : DESKTOP.has(sel))) // a phone shows one pane
    .map((sel) => document.querySelector<HTMLButtonElement>(sel))
    .filter((b): b is HTMLButtonElement => !!b && !b.closest("[hidden]") && !b.classList.contains("is-on")); // a pressed Preview/Source is where you are already; a lit Split is in the bar
}

/**
 * A menu item for a button: its icon, its name, and on the right its shortcut, from the button's
 * title ("Archive note (⌘⇧E)"), or where Move says the note is ("In Projects · Move to another folder").
 * A note in brackets that isn't a shortcut ("Delete note (to Trash)") is the tooltip's alone.
 */
function moreItem(b: HTMLButtonElement): HTMLElement {
  const title = b.title.match(/^(.*?)(?:\s*\((.*)\))?$/)!;
  const keys = title[2] && !/\s/.test(title[2]) ? title[2] : undefined;
  const dot = title[1].lastIndexOf(" · ");
  const [hint, name] = dot >= 0 ? [title[1].slice(0, dot), title[1].slice(dot + 3)] : [keys, title[1]];
  return el(
    "button",
    { type: "button", role: "menuitem", tabindex: "-1", class: "more-item", onclick: () => (closeMore(true), b.click()) },
    (b.querySelector("svg")?.cloneNode(true) as SVGElement | undefined) ?? icon(b.dataset.mode === "source" ? "code" : "html", 16),
    el("span", {}, name || `Show ${b.textContent?.toLowerCase()}`),
    hint ? el("span", { class: hint === keys ? "more-hint more-keys" : "more-hint" }, hint) : null,
  );
}

/** Show More only when it has something in it: with no note open, a computer's bar has nothing to tuck away. */
export function renderMore() {
  const wrap = document.querySelector<HTMLElement>(".more-wrap");
  if (!wrap) return;
  wrap.hidden = moreButtons().length === 0;
  if (wrap.hidden) closeMore(false);
}

function openMore() {
  const menu = $("#more-menu");
  menu.replaceChildren(...moreButtons().map(moreItem));
  menu.hidden = false;
  $("#more-btn").setAttribute("aria-expanded", "true");
  menu.querySelector<HTMLElement>("[role=menuitem]")?.focus();
  document.addEventListener("pointerdown", outsideMore, true);
}

function closeMore(refocus: boolean) {
  const menu = document.querySelector<HTMLElement>("#more-menu");
  if (!menu || menu.hidden) return;
  menu.hidden = true;
  $("#more-btn").setAttribute("aria-expanded", "false");
  document.removeEventListener("pointerdown", outsideMore, true);
  if (refocus) $("#more-btn").focus();
}

function outsideMore(e: Event) {
  const t = e.target as Node;
  if (!$("#more-menu").contains(t) && !$("#more-btn").contains(t)) closeMore(false);
}

function onMoreKey(e: KeyboardEvent) {
  const items = [...$("#more-menu").querySelectorAll<HTMLElement>("[role=menuitem]")];
  const at = items.indexOf(document.activeElement as HTMLElement);
  const to = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: items.length - 1 }[e.key];
  if (to !== undefined) {
    e.preventDefault();
    items[(to + items.length) % items.length]?.focus();
  } else if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    closeMore(true);
  } else if (e.key === "Tab") closeMore(false);
}

// ------------------------------------------------------------------ setup

/** Add the phone controls to the page's markup and wire them up. */
export function setupMobileNav() {
  const sidebar = $("#sidebar");
  const iconBtn = (id: string, label: string, ico: string, extra: Record<string, string>, run: () => void) =>
    el("button", { id, class: "icon-btn",type: "button", title: label, "aria-label": label, ...extra, onclick: run }, icon(ico, 18));

  const more = iconBtn("more-btn", "More", "more", { "aria-haspopup": "menu", "aria-controls": "more-menu", "aria-expanded": "false" }, () =>
    $("#more-menu").hidden ? openMore() : closeMore(true),
  );
  const menu = el("div", { id: "more-menu", role: "menu", "aria-label": "More", hidden: true, onkeydown: onMoreKey });
  // The bottom bar: three places, Search and the drawer. A place presses the sidebar's own button,
  // and is marked as the current page when that button is.
  const navBtn = (id: string, label: string, ico: string, extra: Record<string, string>, run: () => void) =>
    el("button", { id, class: "bn-item", type: "button", ...extra, onclick: run }, icon(ico, 22), el("span", {}, label));
  const places = ([["today", "Today", "sun"], ["notes", "Notes", "feed"], ["tasks", "Tasks", "task"]] as const).map(([key, label, ico]) => {
    const source = $(`#${key}-btn`);
    const b = navBtn(`bn-${key}`, label, ico, {}, () => source.click());
    const mark = () => (source.getAttribute("aria-current") ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current"));
    new MutationObserver(mark).observe(source, { attributes: true, attributeFilter: ["aria-current"] });
    mark();
    return b;
  });
  $("#statusbar").after(
    el(
      "nav",
      { id: "bottom-nav", "aria-label": "Main" },
      ...places,
      navBtn("search-top", "Search", "search", { "aria-label": "Search notes" }, () => $("#search-btn").click()),
      navBtn("menu-btn", "Menu", "menu", { "aria-controls": "sidebar", "aria-expanded": "false" }, () => setDrawer(!drawerOpen)),
    ),
  );
  $("#delete-btn").after(el("div", { class: "more-wrap" }, more, menu)); // after the buttons it holds, before Focus mode and the side panel

  document.body.append(el("div", { id: "scrim", hidden: true, onclick: () => setDrawer(false) }));
  // Behind a phone's bottom sheet (mobile.css shows it while one is open): a tap outside the sheet
  // closes it, as each menu's own outside-click does, and goes no further.
  // The menu closes as the finger lands; the scrim stays under it until the tap ends, so the click
  // that follows doesn't press whatever the sheet was covering.
  const sheetScrim = el("div", { id: "sheet-scrim", "aria-hidden": "true" });
  const release = () => sheetScrim.classList.remove("is-held");
  sheetScrim.addEventListener("pointerdown", () => (sheetScrim.classList.add("is-held"), setTimeout(release, 600)));
  sheetScrim.addEventListener("click", release);
  document.body.append(sheetScrim);
  $("#stage").append(el("button", { id: "fab-new", class: "fab", type: "button", title: "New note", "aria-label": "New note", onclick: () => $("#new-note").click() }, icon("plus", 22)));

  sidebar.addEventListener("keydown", onDrawerKey);
  $("#search-btn").addEventListener("click", closeDrawer);
  matchMedia(PHONE).addEventListener("change", () => (setDrawer(false), closeMore(false)));
  matchMedia(TOUCH).addEventListener("change", () => (closeMore(false), renderMore()));
  renderMore();
}
