// What the sidebar's sections share, so they read alike: the line under an empty section, the
// name field a section's + opens, which tags the Tags section lists, and which of the items a new
// workspace doesn't need yet are showing.
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

/** The tags the Tags section lists: ones on notes or tasks and ones added by name that nothing carries yet, with their parents. */
export function sidebarTags(tags: TagCount[]): TagCount[] {
  const listed = (t: TagCount) => t.notes > 0 || t.tasks > 0 || unusedTag(t);
  return tags.filter((t) => tags.some((c) => tagMatches(c.tag, t.tag) && listed(c)));
}

/**
 * The sidebar items most people don't need on day one. Each waits until it's in use (a contact, a
 * calendar, a file, a smart folder), so a new workspace's sidebar is Today, Notes, Tasks, History
 * and the sections everyone uses. ⌘K and their addresses reach them all along.
 */
export type OptionalItem = "contacts" | "calendar" | "assets" | "smart";
export const OPTIONAL_ITEMS: OptionalItem[] = ["contacts", "calendar", "assets", "smart"];

/**
 * Which optional items the sidebar shows: those in use, those you're on (or asked for from ⌘K, as
 * New smart folder does), and those Settings keeps there always. In a workspace that isn't
 * gamified (gamify.ts), `all` is set and every one shows from the start.
 */
export function shownItems(
  inUse: Record<OptionalItem, boolean>,
  pinned: Partial<Record<OptionalItem, boolean>>,
  here: ReadonlySet<OptionalItem>,
  all = false,
): Record<OptionalItem, boolean> {
  return Object.fromEntries(OPTIONAL_ITEMS.map((i) => [i, all || inUse[i] || !!pinned[i] || here.has(i)])) as Record<OptionalItem, boolean>;
}

/**
 * The pages below Today, Notes and Tasks. They fold under More so the top of the sidebar stays
 * three rows; Settings, Sidebar can keep any of them up top instead.
 */
export type MoreItem = "contacts" | "calendar" | "assets" | "history" | "shared";
export const MORE_ITEMS: MoreItem[] = ["contacts", "calendar", "assets", "history", "shared"];
/** What Settings, Sidebar can keep showing: an optional item, or History. */
export type Pinnable = OptionalItem | "history";

/**
 * Where each of those pages sits: up top with Today, Notes and Tasks ("top", kept there in
 * Settings), under More ("more"), or nowhere (null) while it isn't showing at all (`shown`).
 */
export function morePlaces(shown: Record<MoreItem, boolean>, pinned: Partial<Record<Pinnable, boolean>>): Record<MoreItem, "top" | "more" | null> {
  return Object.fromEntries(
    MORE_ITEMS.map((i) => [i, !shown[i] ? null : i !== "shared" && pinned[i] ? "top" : "more"]),
  ) as Record<MoreItem, "top" | "more" | null>;
}
