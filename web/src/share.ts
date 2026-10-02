// The Share menu: everything about getting a note out of the app, from the top bar's Share button,
// ⌘⇧S (Ctrl+Shift+S off a Mac), "Share…" in ⌘K, :share in Vim, and More on a phone. Copy link, Print,
// Export as Markdown, a web page, Word or PDF, and places for what comes next: sharing with people (#12, which
// fills its item in with setShareWithPeople) and Save to Google Drive (#47, online: setSaveToDrive). Printing and
// exporting load only when picked (export/).
import { el, icon, setLabel } from "./dom.ts";
import { formatKeys } from "./keys.ts";

export interface ShareNote {
  path: string;
  title: string;
  kind: "md" | "html";
  /** The note's address in the app (its stable /notes/<title>-<id> link). */
  url: string;
  /** Its content as it is now (unsaved typing included). */
  content(): string;
}

/** An item another feature adds to the menu. */
export interface ShareItem {
  label: string;
  icon: string;
  run(note: ShareNote, anchor: HTMLElement): void;
}

/** "Share with people…": per-note sharing (#12) puts its dialog here. Until then the menu leaves it out. */
let people: ShareItem | null = null;
export function setShareWithPeople(item: ShareItem | null) {
  people = item;
}

/** "Save to Google Drive…" (#47, export/drive.ts): online only, so the local app's menu leaves it out. */
let drive: ShareItem | null = null;
export function setSaveToDrive(item: ShareItem | null) {
  drive = item;
}

export const SHARE_KEYS = "Mod-Shift-s";

let open: { menu: HTMLElement; anchor: HTMLElement; close(refocus: boolean): void } | null = null;

/** Open the menu under `anchor` (or close it, if it's open there already). */
export function toggleShareMenu(anchor: HTMLElement, note: ShareNote, toast: (text: string) => void) {
  if (open) {
    const same = open.anchor === anchor;
    open.close(same);
    if (same) return;
  }
  const printable = () => ({ path: note.path, title: note.title, content: note.content() });
  const run = (fn: () => unknown) => () => {
    close(false);
    void Promise.resolve(fn()).catch((e: unknown) => toast(`Couldn't do that: ${e instanceof Error ? e.message : String(e)}`));
  };
  const item = (label: string, ico: string, fn: (() => unknown) | null, hint?: string) =>
    el(
      "button",
      { type: "button", role: "menuitem", tabindex: "-1", class: "share-item", disabled: !fn, "aria-disabled": fn ? undefined : "true", onclick: fn ? run(fn) : undefined },
      icon(ico, 15),
      el("span", {}, label),
      hint ? el("span", { class: "share-hint" }, hint) : null,
    );
  const md = note.kind === "md";
  const menu = el(
    "div",
    { class: "share-menu", role: "menu", "aria-label": "Share" },
    item("Copy link", "link", async () => {
      await navigator.clipboard.writeText(note.url);
      toast("Link copied");
    }),
    people ? item(people.label, people.icon, () => people!.run(note, anchor)) : null,
    el("div", { class: "share-sep", role: "separator" }),
    md ? item("Print…", "printer", async () => (await import("./export/print.ts")).print(printable())) : null,
    el("div", { class: "share-section", role: "presentation" }, "Export as"),
    md ? item("Markdown", "file", async () => toast(`Exported ${await (await import("./export/files.ts")).exportMarkdown(printable())}`), ".md") : null,
    item(
      md ? "Web page" : "HTML file",
      "html",
      async () => {
        const files = await import("./export/files.ts");
        if (md) await files.exportHtml(printable());
        else files.download(files.fileName(note.path, "html"), new Blob([note.content()], { type: "text/html;charset=utf-8" }));
      },
      ".html",
    ),
    md ? item("Word", "file", async () => (await import("./export/files.ts")).exportDocx(printable()), ".docx") : null,
    md ? item("PDF", "pdf", async () => (await import("./export/print.ts")).print(printable(), { pdf: true }), "via Print") : null,
    md && drive ? el("div", { class: "share-sep", role: "separator" }) : null,
    md && drive ? item(drive.label, drive.icon, () => drive!.run(note, anchor)) : null,
  );
  const items = () => [...menu.querySelectorAll<HTMLButtonElement>(".share-item:not(:disabled)")];
  menu.addEventListener("keydown", (e) => {
    const list = items();
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    const to = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: list.length - 1 }[e.key];
    if (to !== undefined) {
      e.preventDefault();
      list[(to + list.length) % list.length]?.focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === "Tab") close(false);
  });
  const outside = (e: Event) => !menu.contains(e.target as Node) && !anchor.contains(e.target as Node) && close(false);
  function close(refocus: boolean) {
    if (open?.menu !== menu) return;
    open = null;
    menu.remove();
    anchor.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", outside, true);
    if (refocus) anchor.focus();
  }
  document.body.append(menu);
  place(menu, anchor);
  anchor.setAttribute("aria-expanded", "true");
  document.addEventListener("pointerdown", outside, true);
  open = { menu, anchor, close };
  items()[0]?.focus();
}

/** Under the anchor, right-aligned with it, kept on screen. */
function place(menu: HTMLElement, anchor: HTMLElement) {
  const r = anchor.getBoundingClientRect();
  const w = menu.offsetWidth;
  menu.style.top = `${Math.min(r.bottom + 6, window.innerHeight - menu.offsetHeight - 8)}px`;
  menu.style.left = `${Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8))}px`;
}

/** Whether the open note is shared with people or by link (#12 says so, with setShareState). */
let shared = false;

/**
 * Light the Share button when the open note is shared (per-note sharing, #12, calls this whenever
 * the open note or its sharing changes; false for a note that isn't shared).
 */
export function setShareState(isShared: boolean) {
  shared = isShared;
  const button = document.getElementById("share-btn");
  if (button) paintShareButton(button);
}

/** The Share button's look and name: lit when the note is shared, and its shortcut in the tooltip. */
export function paintShareButton(button: HTMLElement) {
  button.classList.toggle("is-on", shared);
  setLabel(button, `${shared ? "Shared. " : ""}Share, print or export (${formatKeys(SHARE_KEYS)})`);
}
