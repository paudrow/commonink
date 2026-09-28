// "Move to folder": a small popover that lists folders as you type, and makes a new one if the
// name doesn't exist yet. Folders are just the paths notes live under, so a new folder is real
// as soon as the note lands in it.
import { el, icon } from "./dom.ts";

export function folderPicker(anchor: HTMLElement, opts: { folders: string[]; current: string; onPick(folder: string): void }) {
  document.querySelector(".folder-picker")?.remove();
  const input = el("input", { class: "fp-input", placeholder: "Move to folder…", spellcheck: "false", autocomplete: "off" });
  const list = el("div", { class: "fp-list", role: "listbox" });
  const box = el("div", { class: "folder-picker", role: "dialog", "aria-label": "Move to folder" }, el("div", { class: "fp-head" }, icon("move", 15), input), list);
  const r = anchor.getBoundingClientRect();
  Object.assign(box.style, { top: `${r.bottom + 6}px`, right: `${Math.max(12, innerWidth - r.right)}px` });

  let items: Array<{ folder: string; label: string; create?: boolean }> = [];
  let active = 0;
  const clean = (s: string) => s.trim().replace(/[\\:*?"<>|#^[\]]/g, "").replace(/\s*\/\s*/g, "/").replace(/^\/+|\/+$/g, "");

  const render = () => {
    const q = clean(input.value);
    const ql = q.toLowerCase();
    items = [
      ...(!q || "top level".includes(ql) ? [{ folder: "", label: "Top level" }] : []),
      ...opts.folders.filter((f) => f.toLowerCase().includes(ql)).map((f) => ({ folder: f, label: f })),
    ];
    if (q && !opts.folders.some((f) => f.toLowerCase() === ql)) items.push({ folder: q, label: `New folder “${q}”`, create: true });
    active = Math.min(active, Math.max(0, items.length - 1));
    list.replaceChildren(
      ...items.map((it, i) =>
        el(
          "button",
          {
            type: "button",
            class: `fp-item${i === active ? " is-active" : ""}${it.folder === opts.current && !it.create ? " is-current" : ""}`,
            onmousemove: () => i !== active && ((active = i), render()),
            onclick: () => pick(i),
          },
          icon(it.create ? "folderPlus" : it.folder ? "folder" : "file", 14),
          el("span", {}, it.label),
          it.folder === opts.current && !it.create ? el("span", { class: "fp-here" }, "here") : null,
        ),
      ),
    );
  };
  const close = () => {
    box.remove();
    document.removeEventListener("mousedown", outside, true);
  };
  const pick = (i: number) => {
    const it = items[i];
    close();
    if (it && it.folder !== opts.current) opts.onPick(it.folder);
  };
  const outside = (e: MouseEvent) => {
    if (!box.contains(e.target as Node) && e.target !== anchor && !anchor.contains(e.target as Node)) close();
  };

  input.addEventListener("input", () => ((active = 0), render()));
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      active = (active + (e.key === "ArrowDown" ? 1 : -1) + items.length) % Math.max(1, items.length);
      render();
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(active);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  });
  document.addEventListener("mousedown", outside, true);
  document.body.append(box);
  render();
  input.focus();
  return close;
}
