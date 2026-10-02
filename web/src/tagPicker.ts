// Tags in the UI: a chip for one tag, the "filter by tag" chip the Notes, Tasks and Assets views
// share, and the popover that picks a tag as you type (most used first, full nested path shown).
import type { TagCount } from "./api.ts";
import { el, icon } from "./dom.ts";
import { fuzzyScore } from "./fuzzy.ts";
import { cleanTag } from "../../src/core/tags.ts";
import { tagList } from "../../src/core/query.ts";

/** A clickable `#tag`. A span, since it often sits inside a card that is itself a button. */
export function tagChip(display: string, onClick: () => void): HTMLElement {
  const go = (e: Event) => (e.stopPropagation(), e.preventDefault(), onClick());
  return el(
    "span",
    { class: "tag is-link", role: "button", tabindex: "0", title: `Filter by #${display}`, onclick: go, onkeydown: (e: KeyboardEvent) => e.key === "Enter" && go(e) },
    `#${display}`,
  );
}

/**
 * The filter chip: "Tag" opens the picker; with a tag chosen it shows `#tag` and an × to clear it.
 * `count` says how many of what this view lists each tag has, so tags with none are left out.
 */
export function tagFilter(opts: { current: string; tags: () => TagCount[]; count: (t: TagCount) => number; onChange(tag: string): void }): HTMLElement {
  if (opts.current) {
    // A smart folder can need several tags at once (`work,plan`).
    const display = tagList(opts.current)
      .map((c) => opts.tags().find((t) => t.tag === c.toLowerCase())?.display ?? c)
      .join(" + #");
    return el(
      "span",
      { class: "chip tag-filter is-on" },
      icon("hash", 13),
      display,
      el("button", { type: "button", class: "tag-clear", title: "Show every tag", onclick: () => opts.onChange("") }, icon("close", 12)),
    );
  }
  const chip: HTMLButtonElement = el(
    "button",
    { type: "button", class: "chip tag-filter", title: "Filter by tag", onclick: () => tagPicker(chip, { tags: opts.tags().filter((t) => opts.count(t) > 0), count: opts.count, onPick: opts.onChange }) },
    icon("hash", 13),
    "Tag",
  );
  return chip;
}

/**
 * Pick a tag from a popover. With `create`, a name that isn't a tag yet can be picked too (for
 * tagging an asset); otherwise only tags in use are offered.
 */
export function tagPicker(anchor: HTMLElement, opts: { tags: TagCount[]; count: (t: TagCount) => number; onPick(tag: string): void; create?: boolean; placeholder?: string }) {
  document.querySelector(".folder-picker")?.remove();
  const input = el("input", { class: "fp-input", placeholder: opts.placeholder ?? "Filter by tag…", spellcheck: "false", autocomplete: "off" });
  const list = el("div", { class: "fp-list", role: "listbox" });
  const box = el("div", { class: "folder-picker tag-picker", role: "dialog", "aria-label": "Pick a tag" }, el("div", { class: "fp-head" }, icon("hash", 15), input), list);
  const r = anchor.getBoundingClientRect();
  Object.assign(box.style, { top: `${r.bottom + 6}px`, left: `${Math.min(r.left, innerWidth - 332)}px` });

  let items: Array<{ tag: string; label: string; n: number; create?: boolean }> = [];
  let active = 0;
  const render = () => {
    const q = input.value.trim().replace(/^#/, "");
    const ranked = q
      ? opts.tags
          .map((t) => ({ t, s: fuzzyScore(q, t.display) }))
          .filter((x) => x.s >= 0)
          .sort((a, b) => b.s - a.s || opts.count(b.t) - opts.count(a.t))
          .map((x) => x.t)
      : [...opts.tags].sort((a, b) => opts.count(b) - opts.count(a) || a.tag.localeCompare(b.tag));
    items = ranked.slice(0, 50).map((t) => ({ tag: t.display, label: `#${t.display}`, n: opts.count(t) }));
    const typed = cleanTag(q);
    if (opts.create && typed && !opts.tags.some((t) => t.tag === typed.toLowerCase())) items.push({ tag: typed, label: `New tag #${typed}`, n: 0, create: true });
    active = Math.min(active, Math.max(0, items.length - 1));
    list.replaceChildren(
      ...(items.length
        ? items.map((it, i) =>
            el(
              "button",
              { type: "button", class: `fp-item${i === active ? " is-active" : ""}`, onmousemove: () => i !== active && ((active = i), render()), onclick: () => pick(i) },
              icon(it.create ? "plus" : "hash", 14),
              el("span", {}, it.label),
              it.n ? el("span", { class: "fp-here" }, String(it.n)) : null,
            ),
          )
        : [el("div", { class: "fp-empty" }, opts.tags.length ? "No tag matches" : "No tags yet. Type #tag in a note to add one.")]),
    );
  };
  const close = () => {
    box.remove();
    document.removeEventListener("mousedown", outside, true);
  };
  const pick = (i: number) => {
    const it = items[i];
    close();
    if (it) opts.onPick(it.tag);
  };
  const outside = (e: MouseEvent) => {
    if (!box.contains(e.target as Node) && !anchor.contains(e.target as Node)) close();
  };
  input.addEventListener("input", () => ((active = 0), render()));
  input.addEventListener("keydown", (e) => {
    e.stopPropagation(); // keep the page's own shortcuts (j/k, /) out of the picker
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
}
