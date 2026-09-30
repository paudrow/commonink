// Phone layout: below 760px the sidebar is a drawer behind a menu button, and Search sits in the
// top bar. With a phone or a tablet's touch screen, the note's less-used top-bar buttons move into
// a More menu. A floating button makes a note from Notes. The layout itself is in mobile.css.
import { $, el, icon } from "./dom.ts";

const PHONE = "(max-width: 760px)";

/**
 * The top-bar buttons that More holds, in menu order. mobile.css hides exactly these where More
 * shows. An item presses the button itself, so labels, icons and handlers stay the button's own.
 */
const OVERFLOW = ["#note-history-btn", "#versions-btn", "#move-btn", "#archive-btn", "#delete-btn", "#focus-btn", "#panel-btn", '#html-toggle [data-mode="preview"]', '#html-toggle [data-mode="source"]'];

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

function moreItems(): HTMLElement[] {
  return OVERFLOW.map((sel) => document.querySelector<HTMLButtonElement>(sel))
    .filter((b): b is HTMLButtonElement => !!b && !b.closest("[hidden]") && !b.classList.contains("is-on")) // a pressed Preview/Source is where you are already
    .map((b) =>
      el(
        "button",
        { type: "button", role: "menuitem", tabindex: "-1", class: "more-item", onclick: () => (closeMore(true), b.click()) },
        (b.querySelector("svg")?.cloneNode(true) as SVGElement | undefined) ?? icon(b.dataset.mode === "source" ? "code" : "html", 16),
        el("span", {}, b.title.replace(/\s*\(.*\)$/, "") || `Show ${b.textContent?.toLowerCase()}`),
      ),
    );
}

function openMore() {
  const menu = $("#more-menu");
  menu.replaceChildren(...moreItems());
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
  const topbar = $("#topbar");
  const iconBtn = (id: string, label: string, ico: string, extra: Record<string, string>, run: () => void) =>
    el("button", { id, class: "icon-btn",type: "button", title: label, "aria-label": label, ...extra, onclick: run }, icon(ico, 18));

  topbar.prepend(iconBtn("menu-btn", "Menu", "menu", { "aria-controls": "sidebar", "aria-expanded": "false" }, () => setDrawer(!drawerOpen)));
  const more = iconBtn("more-btn", "More", "more", { "aria-haspopup": "menu", "aria-controls": "more-menu", "aria-expanded": "false" }, () =>
    $("#more-menu").hidden ? openMore() : closeMore(true),
  );
  const menu = el("div", { id: "more-menu", role: "menu", "aria-label": "More", hidden: true, onkeydown: onMoreKey });
  $("#star-btn").after(iconBtn("search-top", "Search notes", "search", {}, () => $("#search-btn").click()));
  topbar.append(el("div", { class: "more-wrap" }, more, menu));

  document.body.append(el("div", { id: "scrim", hidden: true, onclick: () => setDrawer(false) }));
  $("#stage").append(el("button", { id: "fab-new", class: "fab", type: "button", title: "New note", "aria-label": "New note", onclick: () => $("#new-note").click() }, icon("plus", 22)));

  sidebar.addEventListener("keydown", onDrawerKey);
  $("#search-btn").addEventListener("click", closeDrawer);
  matchMedia(PHONE).addEventListener("change", () => (setDrawer(false), closeMore(false)));
}
