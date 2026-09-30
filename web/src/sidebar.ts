// What the sidebar's sections share, so they read alike: the line under an empty section, the
// name field a section's + opens, and which tags the Tags section lists.
import { unusedTag, type TagCount } from "./api.ts";
import { el, icon } from "./dom.ts";
import { tagMatches } from "../../src/core/tags.ts";

type Child = Node | string;

/** The line under an empty section. It keeps the rows' chevron column, so it lines up with them. */
export function sectionHint(...text: Child[]): HTMLElement {
  return el("div", { class: "tree-hint" }, el("span", { class: "chev is-leaf" }), el("span", {}, ...text));
}

/** The + in a section's header, drawn inside a hint that points at it. */
export const plusMark = () => el("span", { class: "hint-icon", "aria-label": "+" }, icon("plus", 11));

/**
 * A name field at the top of a section, the way a new folder or tag starts. Enter, or leaving the
 * field, hands over what was typed; Escape hands over null. Either way the field goes.
 */
export function nameField(section: HTMLElement, opts: { icon: string; placeholder: string; label: string; done(name: string | null): void }) {
  section.querySelector(".tree-row.is-input")?.remove();
  const input = el("input", { class: "tree-input", placeholder: opts.placeholder, "aria-label": opts.label, spellcheck: "false", autocomplete: "off" });
  const row = el("div", { class: "tree-row is-input", style: { "--depth": "0" } }, el("span", { class: "chev is-leaf" }), icon(opts.icon, 14), input);
  section.prepend(row);
  input.focus();
  let finished = false;
  const finish = (keep: boolean) => {
    if (finished) return;
    finished = true;
    row.remove();
    opts.done(keep ? input.value : null);
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") finish(true);
    if (e.key === "Escape") finish(false);
  });
  input.addEventListener("blur", () => finish(true));
}

/** The tags the Tags section lists: ones on notes and ones added by name that nothing carries yet, with their parents. */
export function sidebarTags(tags: TagCount[]): TagCount[] {
  const listed = (t: TagCount) => t.notes > 0 || unusedTag(t);
  return tags.filter((t) => tags.some((c) => tagMatches(c.tag, t.tag) && listed(c)));
}
