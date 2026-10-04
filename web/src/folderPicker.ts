// "Move to folder": a small popover that lists folders as you type (a fuzzy match, see picker.ts),
// and makes a new one if the name doesn't exist yet. Folders are just the paths notes live under, so a new folder is real
// as soon as the note lands in it.
import { el, icon } from "./dom.ts";
import { fuzzyRank, listPicker } from "./picker.ts";
import { inFolders, isPattern } from "../../src/core/queryGrammar.ts";

/**
 * `create: false` only picks a folder that exists (a filter's), and `top` names the "" choice
 * ("Any folder" for a filter). With `pattern` (a filter's too), a name typed with a `*` in it can be
 * picked as it is: every folder it fits, listed under it. A nested folder shows its parents dimmed,
 * so the last part stands out.
 */
export function folderPicker(
  anchor: HTMLElement,
  opts: { folders: string[]; current: string; onPick(folder: string): void; placeholder?: string; top?: string; create?: boolean; pattern?: boolean },
) {
  document.querySelector(".folder-picker")?.remove();
  const top = opts.top ?? "Top level";
  const placeholder = opts.placeholder ?? "Move to folder…";
  const input = el("input", { class: "fp-input", placeholder, spellcheck: "false", autocomplete: "off" });
  const list = el("div", { class: "fp-list" });
  const box = el("div", { class: "folder-picker", role: "dialog", "aria-label": placeholder.replace(/…$/, "") }, el("div", { class: "fp-head" }, icon(opts.create === false ? "folder" : "move", 15), input), list);
  // A button tucked into the phone's More menu has no box: open under the top bar's right end.
  const r = anchor.getClientRects().length ? anchor.getBoundingClientRect() : { bottom: 48, right: innerWidth };
  Object.assign(box.style, { top: `${r.bottom + 6}px`, right: `${Math.max(12, innerWidth - r.right)}px` });

  type Item = { folder: string; label: string; create?: boolean };
  const clean = (s: string, keep = "") => s.trim().replace(/[\\:*?"<>|#^[\]]/g, (c) => (c === keep ? c : "")).replace(/\s*\/\s*/g, "/").replace(/^\/+|\/+$/g, "");

  const close = () => {
    box.remove();
    document.removeEventListener("mousedown", outside, true);
  };
  const pick = (it: Item) => {
    close();
    if (it.folder !== opts.current) opts.onPick(it.folder);
  };
  const outside = (e: MouseEvent) => {
    if (!box.contains(e.target as Node) && e.target !== anchor && !anchor.contains(e.target as Node)) close();
  };
  const rows = (typed: string) => {
    const wild = opts.pattern && isPattern(typed) ? clean(typed, "*").replace(/\*{2,}/g, "*") : "";
    const q = clean(typed);
    const all: Item[] = [{ folder: "", label: top }, ...opts.folders.map((f) => ({ folder: f, label: f }))];
    const items: Item[] = wild
      ? [{ folder: wild, label: `Folders matching “${wild}”`, create: true }, ...opts.folders.filter((f) => inFolders(`${f}/`, [wild])).map((f) => ({ folder: f, label: f }))]
      : fuzzyRank(q, all, (it) => it.label);
    if (q && opts.create !== false && !opts.folders.some((f) => f.toLowerCase() === q.toLowerCase())) items.push({ folder: q, label: `New folder “${q}”`, create: true });
    return items.map((it) =>
      el(
        "button",
        { type: "button", class: `fp-item${it.folder === opts.current && !it.create ? " is-current" : ""}`, onclick: () => pick(it) },
        icon(it.create ? (wild ? "search" : "folderPlus") : it.folder ? "folder" : "file", 14),
        it.create || !it.folder.includes("/")
          ? el("span", {}, it.label)
          : el("span", {}, el("span", { class: "fp-parent" }, it.folder.slice(0, it.folder.lastIndexOf("/") + 1)), it.folder.slice(it.folder.lastIndexOf("/") + 1)),
        it.folder === opts.current && !it.create ? el("span", { class: "fp-here" }, "here") : null,
      ),
    );
  };

  document.addEventListener("mousedown", outside, true);
  document.body.append(box);
  listPicker({ input, list, rows, empty: () => "No folder matches", close });
  input.focus();
  return close;
}
