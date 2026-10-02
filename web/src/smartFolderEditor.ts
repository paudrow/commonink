// Name a smart folder and say which notes it holds, in a dialog in the middle of the window. The
// simple part is a few plain controls: words to find, a folder (picked, not typed), tags as rows
// with "Match all" or "Match any" once there are two, and a sort. Below them, a live count and the
// first few notes that match, so what a choice does shows as you make it. Advanced has the query
// as text, the same one an agent or a ::query widget writes; editing either side updates the other.
// What's saved is the query as text; the server checks it.
import { api } from "./api.ts";
import { el, icon } from "./dom.ts";
import type { FieldSources } from "./widgets/core.ts";
import { folderPicker } from "./folderPicker.ts";
import { tagPicker } from "./tagPicker.ts";
import { formatQuery, parseQuery, queryProblem, tagList, type NoteQuery, type QuerySort } from "../../src/core/query.ts";

export interface SmartFolderDraft {
  id?: string;
  name: string;
  query: string;
  shared: boolean;
  /** In the person's Favorites. Left out, the editor doesn't ask. */
  favorite?: boolean;
}

/** What the controls hold: the query, with its tags as a list (an empty row is a tag not picked yet). */
interface State {
  q: string;
  folder: string;
  tags: string[];
  match: "all" | "any";
  sort: QuerySort;
}

export const SORTS: Array<[QuerySort, string]> = [
  ["modified", "Recently changed"],
  ["date", "Newest by date"],
  ["oldest", "Oldest by date"],
  ["title", "By title"],
];

const stateOf = (query: NoteQuery): State => ({
  q: query.q ?? "",
  folder: query.folder ?? "",
  tags: tagList(query.tag),
  match: query.match ?? "all",
  sort: query.sort ?? "modified",
});

export function queryText(s: State): string {
  const tags = s.tags.filter(Boolean);
  return formatQuery({ q: s.q.trim() || undefined, folder: s.folder || undefined, tag: tags.join(",") || undefined, match: tags.length > 1 ? s.match : undefined, sort: s.sort });
}

/** A folder path as its parts ("Projects › Clients › Acme"), the last one strongest. */
function crumbs(folder: string): HTMLElement {
  const parts = folder.split("/");
  return el(
    "span",
    { class: "sf-crumbs", title: folder },
    ...parts.flatMap((p, i) => [i ? el("span", { class: "sf-crumb-sep" }, "›") : null, el("span", { class: i === parts.length - 1 ? "sf-crumb is-last" : "sf-crumb" }, p)]),
  );
}

export function smartFolderEditor(
  anchor: HTMLElement,
  draft: SmartFolderDraft,
  /** `alone`: a local vault, where "Just me" has no one to leave out, so it isn't asked. */
  opts: { canShare: boolean; alone?: boolean; sources: FieldSources; save(f: SmartFolderDraft): Promise<void>; remove?(): Promise<void> },
) {
  document.querySelector(".sf-modal")?.remove();
  const state = stateOf(parseQuery(draft.query));
  if (!state.tags.length) state.tags.push("");

  const name = el("input", { type: "text", class: "sf-name", value: draft.name, placeholder: "Name it: Client work, This week…", spellcheck: "false", "aria-label": "Name" });
  const words = el("input", { type: "text", value: state.q, placeholder: "Words to find, or leave empty for every note", spellcheck: "false" });
  words.addEventListener("input", () => ((state.q = words.value), changed()));

  const folderBox = el("div", { class: "sf-folder" });
  const renderFolder = () => {
    const button: HTMLButtonElement = el(
      "button",
      {
        type: "button",
        class: `sf-pick${state.folder ? " is-set" : ""}`,
        onclick: () =>
          folderPicker(button, {
            folders: opts.sources.folders(),
            current: state.folder,
            placeholder: "Find a folder…",
            top: "Any folder",
            create: false,
            onPick: (f) => ((state.folder = f), renderFolder(), changed()),
          }),
      },
      icon("folder", 14),
      state.folder ? crumbs(state.folder) : el("span", { class: "sf-placeholder" }, "Any folder"),
    );
    folderBox.replaceChildren(
      button,
      state.folder ? el("button", { type: "button", class: "icon-btn small", title: "Any folder", "aria-label": "Any folder", onclick: () => ((state.folder = ""), renderFolder(), changed()) }, icon("close", 13)) : "",
    );
  };

  const match = el(
    "select",
    { class: "qw-select sf-match", "aria-label": "How tags combine" },
    el("option", { value: "all" }, "Match all of these tags"),
    el("option", { value: "any" }, "Match any of these tags"),
  );
  match.addEventListener("change", () => ((state.match = match.value as "all" | "any"), renderTags(), changed()));
  const tagBox = el("div", { class: "sf-tags" });
  const renderTags = () => {
    match.value = state.match;
    const filled = state.tags.filter(Boolean).length;
    const rows = state.tags.map((tag, i) => {
      const button: HTMLButtonElement = el(
        "button",
        {
          type: "button",
          class: `sf-pick${tag ? " is-set" : ""}`,
          onclick: () =>
            tagPicker(button, {
              tags: opts.sources.tags().filter((t) => t.notes > 0 && !state.tags.some((x, j) => j !== i && x.toLowerCase() === t.tag)),
              count: (t) => t.notes,
              onPick: (t) => ((state.tags[i] = t), renderTags(), changed()),
            }),
        },
        icon("hash", 14),
        tag ? el("span", {}, tag) : el("span", { class: "sf-placeholder" }, i ? "Pick another tag" : "Any tag"),
      );
      const remove =
        state.tags.length > 1 || tag
          ? el(
              "button",
              {
                type: "button",
                class: "icon-btn small",
                title: "Remove this tag",
                "aria-label": "Remove this tag",
                onclick: () => {
                  state.tags.splice(i, 1);
                  if (!state.tags.length) state.tags.push("");
                  renderTags();
                  changed();
                },
              },
              icon("close", 13),
            )
          : "";
      // Between rows, the word that joins them, so "all" or "any" reads down the list.
      return el("div", { class: "sf-tag-row" }, el("span", { class: "sf-join" }, i ? (state.match === "any" ? "or" : "and") : ""), button, remove);
    });
    const add = el(
      "button",
      {
        type: "button",
        class: "sf-add",
        disabled: !state.tags.at(-1),
        onclick: () => {
          state.tags.push("");
          renderTags();
          tagBox.querySelector<HTMLButtonElement>(".sf-tag-row:last-of-type .sf-pick")?.click();
        },
      },
      icon("plus", 13),
      "Add a tag",
    );
    tagBox.replaceChildren(filled > 1 ? match : "", ...rows, add);
  };

  const sort = el("select", { class: "qw-select", "aria-label": "Sort" }, ...SORTS.map(([v, label]) => el("option", { value: v }, label)));
  sort.value = state.sort;
  sort.addEventListener("change", () => ((state.sort = sort.value as QuerySort), changed()));

  // Advanced: the query as text. Typing a query that reads fills the controls above from it.
  const text = el("input", { type: "text", class: "sf-query", value: queryText(state), spellcheck: "false", "aria-label": "Query", placeholder: "tag=work,plan sort=date" });
  text.addEventListener("input", () => {
    if (queryProblem(text.value)) return recount();
    Object.assign(state, stateOf(parseQuery(text.value)));
    if (!state.tags.length) state.tags.push("");
    words.value = state.q;
    sort.value = state.sort;
    renderFolder();
    renderTags();
    recount();
  });
  const advanced = el(
    "details",
    { class: "sf-advanced" },
    el("summary", {}, "Advanced"),
    el(
      "div",
      { class: "sf-adv-body" },
      text,
      el("p", { class: "sf-hint" }, "The same query an agent or a ::query widget uses: q, folder, tag, match, sort. Edit it here or with the controls above."),
    ),
  );

  const count = el("div", { class: "sf-count", "aria-live": "polite" });
  const preview = el("ul", { class: "sf-preview" });
  let timer = 0;
  let seq = 0;
  const current = () => (advanced.open && queryProblem(text.value) ? text.value : queryText(state));
  function recount() {
    clearTimeout(timer);
    timer = window.setTimeout(async () => {
      const mine = ++seq;
      const problem = queryProblem(current());
      if (problem) {
        count.textContent = problem;
        count.classList.add("is-error");
        preview.replaceChildren();
        return;
      }
      const page = await api.feed({ ...parseQuery(current()), scope: "active", limit: 5 }).catch(() => null);
      if (mine !== seq || !page) return;
      count.classList.remove("is-error");
      count.textContent = page.total === 0 ? "No notes match yet" : page.total === 1 ? "1 note matches" : `${page.total} notes match`;
      preview.replaceChildren(
        ...page.items.map((it) => {
          const folder = it.path.includes("/") ? it.path.slice(0, it.path.lastIndexOf("/")) : "";
          return el("li", {}, icon("file", 13), el("span", { class: "sf-p-title" }, it.title), folder ? el("span", { class: "sf-p-folder" }, folder) : "");
        }),
        page.total > page.items.length ? el("li", { class: "sf-p-more" }, `and ${page.total - page.items.length} more`) : "",
      );
    }, 180);
  }
  function changed() {
    text.value = queryText(state);
    recount();
  }

  const fav = el("input", { type: "checkbox" });
  fav.checked = !!draft.favorite;
  const justMe = el("input", { type: "checkbox" });
  justMe.checked = !draft.shared || !opts.canShare;
  justMe.disabled = !opts.canShare;
  const error = el("div", { class: "sf-pop-error", hidden: true });
  const row = (label: string, ...control: Array<HTMLElement | string>) => el("div", { class: "sf-row" }, el("span", { class: "sf-label" }, label), el("div", { class: "sf-control" }, ...control));
  const title = draft.id ? "Edit smart folder" : draft.query ? "Save as smart folder" : "New smart folder";
  const form = el(
    "form",
    { class: "sf-dialog", role: "dialog", "aria-modal": "true", "aria-label": title },
    el(
      "header",
      { class: "sf-head" },
      icon("folderSearch", 16),
      el("h2", {}, title),
      el("button", { type: "button", class: "icon-btn small", title: "Close", "aria-label": "Close", onclick: () => close() }, icon("close", 15)),
    ),
    name,
    el("div", { class: "sf-section" }, row("Words", words), row("Folder", folderBox), row("Tags", tagBox), row("Sort", sort)),
    el("div", { class: "sf-result" }, count, preview),
    advanced,
    opts.alone
      ? null
      : el(
          "label",
          { class: "sf-just-me", title: opts.canShare ? "" : "Viewers can keep smart folders of their own" },
          justMe,
          el("span", {}, "Just me"),
          el("span", { class: "sf-hint" }, opts.canShare ? "Otherwise everyone in the workspace sees it" : "You can view this workspace, so it's yours only"),
        ),
    draft.favorite === undefined ? null : el("label", { class: "sf-just-me" }, fav, el("span", {}, "In Favorites"), el("span", { class: "sf-hint" }, "Keep it at the top of your sidebar")),
    error,
    el(
      "footer",
      { class: "qw-config-foot" },
      opts.remove ? el("button", { class: "qw-btn sf-delete", type: "button", onclick: () => void run(opts.remove!) }, icon("trash", 13), "Delete") : null,
      el("span", { class: "spacer" }),
      el("button", { class: "qw-btn", type: "button", onclick: () => close() }, "Cancel"),
      el("button", { class: "qw-btn primary", type: "submit" }, "Save"),
    ),
  );
  const overlay = el("div", { class: "sf-modal" }, form);

  const close = () => {
    clearTimeout(timer);
    overlay.remove();
    document.querySelector(".folder-picker")?.remove();
    anchor.focus?.({ preventScroll: true }); // back where the keyboard was
  };
  const run = async (fn: () => Promise<void>) => {
    try {
      await fn();
      close();
    } catch (err) {
      error.hidden = false;
      error.textContent = err instanceof Error ? err.message : "Couldn't save the smart folder";
    }
  };
  // The backdrop closes it; the pickers open outside the form, so a click in one isn't on the backdrop.
  overlay.addEventListener("mousedown", (e) => e.target === overlay && close());
  form.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") close();
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!name.value.trim()) {
      error.hidden = false;
      error.textContent = "Give the smart folder a name";
      return name.focus();
    }
    void run(() => opts.save({ id: draft.id, name: name.value.trim(), query: current(), shared: !justMe.checked, ...(draft.favorite !== undefined && { favorite: fav.checked }) }));
  });
  renderFolder();
  renderTags();
  document.body.append(overlay);
  recount();
  name.focus();
  name.select();
}
