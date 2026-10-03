// Name a smart folder and say which notes it holds, in a dialog in the middle of the window. The
// simple part is a few plain controls, each a list of rows with "+ Add": words to find, folders
// (picked, not typed), tags, and a sort. Words and tags say "Match all" or "Match any" once there
// are two; a note is in one folder, so folders are always any of them. Below, a live count and the
// first few notes that match, so what a choice does shows as you make it. Under the rows, always in
// view, is the query as text: the same one an agent or a ::view widget writes, with its whole
// grammar (queryGrammar.ts: AND, OR, ( ), -word, modified>-7d, ...). It's built as the rows change,
// and typing in it fills them. Its ? opens the Query syntax page. What's saved is the query as text;
// the server checks it.
//
// The same dialog is Notes' Advanced search (`opts.search`): no name yet, and each change shows in
// Notes as it's made (Cancel puts the filters back). "Save as view" asks for a name in place,
// so a search becomes a view in one step.
import { api } from "./api.ts";
import { el, icon } from "./dom.ts";
import type { FieldSources } from "./widgets/core.ts";
import { folderPicker } from "./folderPicker.ts";
import { tagPicker } from "./tagPicker.ts";
import { queryHelpLink } from "./queryHelp.ts";
import { parse } from "../../src/core/queryGrammar.ts";
import { folderList, formatQuery, parseQuery, queryProblem, tagList, type NoteQuery, type QuerySort } from "../../src/core/query.ts";

export interface SmartFolderDraft {
  id?: string;
  /** The view's note, once it's saved. */
  path?: string;
  name: string;
  query: string;
  shared: boolean;
}

type Match = "all" | "any";

/**
 * What the controls hold: the query, with its words, folders and tags as lists (an empty row is
 * one not filled in yet). `words` is null when `q` says more than rows can (`-word`, a date, OR
 * beside plain words), and `q` is then edited as text.
 */
interface State {
  q: string;
  words: string[] | null;
  wordMatch: Match;
  folders: string[];
  tags: string[];
  match: Match;
  sort: QuerySort;
}

export const SORTS: Array<[QuerySort, string]> = [
  ["modified", "Recently changed"],
  ["created", "Recently created"],
  ["date", "Newest by date"],
  ["oldest", "Oldest by date"],
  ["title", "By title"],
];

/** A row's words as they go in `q`: one word as it is, more as a phrase (`'client call'`). */
function termText(row: string): string {
  const t = row.replace(/['"]/g, " ").replace(/\s+/g, " ").trim();
  return /^[\p{L}\p{N}_]+$/u.test(t) && t !== "OR" && t !== "AND" ? t : t && `'${t}'`;
}

/** Rows of words as `q`: all of them (`a b`), or any (`a OR b`). */
export function wordsText(rows: string[], match: Match): string {
  return rows.map(termText).filter(Boolean).join(match === "any" ? " OR " : " ");
}

/** `q` as rows, if rows say it exactly (else null): words side by side, or words joined by OR. */
export function wordRows(q: string): { rows: string[]; match: Match } | null {
  const text = q.trim().replace(/\s+/g, " ");
  if (!text) return { rows: [""], match: "all" };
  const { expr, sort, error } = parse(text);
  if (error || sort || !expr) return null;
  const items = expr.kind === "and" || expr.kind === "or" ? expr.items : [expr];
  if (!items.every((t) => t.kind === "text")) return null;
  const rows = items.map((t) => (t.kind === "text" ? t.words.join(" ") : ""));
  const match: Match = expr.kind === "or" ? "any" : "all";
  return wordsText(rows, match) === text ? { rows, match } : null;
}

const stateOf = (query: NoteQuery): State => {
  const words = wordRows(query.q ?? "");
  const folders = folderList(query.folder);
  const tags = tagList(query.tag);
  return {
    q: query.q ?? "",
    words: words?.rows ?? null,
    wordMatch: words?.match ?? "all",
    folders: folders.length ? folders : [""],
    tags: tags.length ? tags : [""],
    match: query.match ?? "all",
    sort: query.sort ?? "modified",
  };
};

/** A starting name for a query: its tags, folders and words ("work · Projects · “launch”"). It's a file name, so tags go without their #. */
export function suggestName(query: string): string {
  const q = parseQuery(query);
  const tags = tagList(q.tag).join(q.match === "any" ? " or " : " ");
  return [tags, folderList(q.folder).join(" or "), q.q && `“${q.q}”`].filter(Boolean).join(" · ") || "All notes";
}

export function queryText(s: State): string {
  const tags = s.tags.filter(Boolean);
  return formatQuery({
    q: (s.words ? wordsText(s.words, s.wordMatch) : s.q.trim()) || undefined,
    folder: s.folders.filter(Boolean).join("|") || undefined,
    tag: tags.join(",") || undefined,
    match: tags.length > 1 ? s.match : undefined,
    sort: s.sort,
  });
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

/** "Match all of these tags" / "Match any of these tags", for a list of `what`. */
function matchSelect(what: string, value: Match, onChange: (m: Match) => void): HTMLSelectElement {
  const select = el(
    "select",
    { class: "qw-select sf-match", "aria-label": `How ${what} combine` },
    el("option", { value: "all" }, `Match all of these ${what}`),
    el("option", { value: "any" }, `Match any of these ${what}`),
  );
  select.value = value;
  select.addEventListener("change", () => onChange(select.value as Match));
  return select;
}

/**
 * A list of rows: each is `control(i)` with an × to take it out, the word that joins it to the one
 * above (so "all" or "any" reads down the list), and "+ Add" under them once the last is filled.
 */
function rowList(o: { items: string[]; join: string; add: string; remove: string; head?: HTMLElement | ""; control(i: number): HTMLElement; onChange(): void; onAdd(): void }): Array<HTMLElement | ""> {
  const rows = o.items.map((item, i) => {
    const remove =
      o.items.length > 1 || item
        ? el(
            "button",
            {
              type: "button",
              class: "icon-btn small",
              title: o.remove,
              "aria-label": o.remove,
              onclick: () => {
                o.items.splice(i, 1);
                if (!o.items.length) o.items.push("");
                o.onChange();
              },
            },
            icon("close", 13),
          )
        : "";
    return el("div", { class: "sf-item" }, el("span", { class: "sf-join" }, i ? o.join : ""), o.control(i), remove);
  });
  const add = el(
    "button",
    {
      type: "button",
      class: "sf-add",
      disabled: !o.items.at(-1)?.trim(),
      onclick: () => {
        o.items.push("");
        o.onChange();
        o.onAdd();
      },
    },
    icon("plus", 13),
    o.add,
  );
  return [o.head ?? "", ...rows, add];
}

export function smartFolderEditor(
  anchor: HTMLElement,
  draft: SmartFolderDraft,
  /** `alone`: a local vault, with no workspace to share with, so it isn't asked. */
  opts: {
    canShare: boolean;
    alone?: boolean;
    sources: FieldSources;
    save(f: SmartFolderDraft): Promise<void>;
    remove?(): Promise<void>;
    /** Notes' Advanced search: `apply` shows a query in Notes, as it changes (and the one it opened with again on Cancel). */
    search?: { apply(query: string): void };
  },
) {
  document.querySelector(".sf-modal")?.remove();
  const state = stateOf(parseQuery(draft.query));

  const name = el("input", { type: "text", class: "sf-name", value: draft.name, placeholder: "Name it: Client work, This week…", spellcheck: "false", "aria-label": "Name" });

  const wordBox = el("div", { class: "sf-rows sf-words" });
  const renderWords = () => {
    const rows = state.words;
    if (!rows) {
      // More than rows can say: the words as text, as the query has them.
      const input = el("input", { type: "text", class: "sf-word", value: state.q, spellcheck: "false", "aria-label": "Words" });
      input.addEventListener("input", () => ((state.q = input.value), changed()));
      return wordBox.replaceChildren(input, el("p", { class: "sf-hint" }, "These words use the query syntax (the ? by Query lists it)."));
    }
    const filled = rows.filter((w) => w.trim()).length;
    wordBox.replaceChildren(
      ...rowList({
        items: rows,
        join: state.wordMatch === "any" ? "or" : "and",
        add: "Add a word",
        remove: "Remove these words",
        head: filled > 1 ? matchSelect("words", state.wordMatch, (m) => ((state.wordMatch = m), renderWords(), changed())) : "",
        control: (i) => {
          const input = el("input", { type: "text", class: "sf-word", value: rows[i], spellcheck: "false", "aria-label": "A word or phrase", placeholder: i ? "Another word or phrase" : "A word or phrase, or leave empty for every note" });
          input.addEventListener("input", () => {
            const had = !!rows[i].trim();
            rows[i] = input.value;
            // Re-render only when "+ Add" or the × should change, so typing keeps its place.
            if (had !== !!input.value.trim()) {
              renderWords();
              wordBox.querySelectorAll<HTMLInputElement>(".sf-word")[i]?.focus();
            }
            changed();
          });
          return input;
        },
        onChange: () => (renderWords(), changed()),
        onAdd: () => wordBox.querySelector<HTMLInputElement>(".sf-item:last-of-type .sf-word")?.focus(),
      }),
    );
  };

  const folderBox = el("div", { class: "sf-rows sf-folders" });
  const renderFolders = () => {
    folderBox.replaceChildren(
      ...rowList({
        items: state.folders,
        join: "or",
        add: "Add a folder",
        remove: "Remove this folder",
        control: (i) => {
          const folder = state.folders[i];
          const button: HTMLButtonElement = el(
            "button",
            {
              type: "button",
              class: `sf-pick${folder ? " is-set" : ""}`,
              onclick: () =>
                folderPicker(button, {
                  folders: opts.sources.folders().filter((f) => !state.folders.some((x, j) => j !== i && x === f)),
                  current: folder,
                  placeholder: "Find a folder…",
                  top: "Any folder",
                  create: false,
                  onPick: (f) => {
                    state.folders[i] = f;
                    if (!f && state.folders.length > 1) state.folders.splice(i, 1);
                    renderFolders();
                    changed();
                  },
                }),
            },
            icon("folder", 14),
            folder ? crumbs(folder) : el("span", { class: "sf-placeholder" }, i ? "Pick another folder" : "Any folder"),
          );
          return button;
        },
        onChange: () => (renderFolders(), changed()),
        onAdd: () => folderBox.querySelector<HTMLButtonElement>(".sf-item:last-of-type .sf-pick")?.click(),
      }),
    );
  };

  const tagBox = el("div", { class: "sf-rows sf-tags" });
  const renderTags = () => {
    const filled = state.tags.filter(Boolean).length;
    tagBox.replaceChildren(
      ...rowList({
        items: state.tags,
        join: state.match === "any" ? "or" : "and",
        add: "Add a tag",
        remove: "Remove this tag",
        head: filled > 1 ? matchSelect("tags", state.match, (m) => ((state.match = m), renderTags(), changed())) : "",
        control: (i) => {
          const tag = state.tags[i];
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
          return button;
        },
        onChange: () => (renderTags(), changed()),
        onAdd: () => tagBox.querySelector<HTMLButtonElement>(".sf-item:last-of-type .sf-pick")?.click(),
      }),
    );
  };

  const sort = el("select", { class: "qw-select", "aria-label": "Sort" }, ...SORTS.map(([v, label]) => el("option", { value: v }, label)));
  sort.value = state.sort;
  sort.addEventListener("change", () => ((state.sort = sort.value as QuerySort), changed()));

  // The query as text. Typing a query that reads fills the controls above from it.
  const text = el("input", { type: "text", class: "sf-query", value: queryText(state), spellcheck: "false", "aria-label": "Query", placeholder: "planning -draft tag=work modified>-30d sort=date" });
  text.addEventListener("input", () => {
    if (queryProblem(text.value)) return recount();
    Object.assign(state, stateOf(parseQuery(text.value)));
    sort.value = state.sort;
    renderWords();
    renderFolders();
    renderTags();
    recount();
  });
  const queryBox = el(
    "div",
    { class: "sf-query-box" },
    el("div", { class: "sf-query-line" }, text, queryHelpLink()),
    el("p", { class: "sf-hint" }, "The same query as ::view{…} in a note. Type it here or use the rows above; the ? shows all the syntax."),
  );

  const count = el("div", { class: "sf-count", "aria-live": "polite" });
  const preview = el("ul", { class: "sf-preview" });
  let timer = 0;
  let seq = 0;
  const current = () => (queryProblem(text.value) ? text.value : queryText(state));
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
      if (search && current() !== applied) search.apply((applied = current()));
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

  const share = el("input", { type: "checkbox" });
  share.checked = draft.shared && opts.canShare;
  share.disabled = !opts.canShare;
  const error = el("div", { class: "sf-pop-error", hidden: true });
  const row = (label: string, ...control: Array<HTMLElement | string>) => el("div", { class: "sf-row" }, el("span", { class: "sf-label" }, label), el("div", { class: "sf-control" }, ...control));
  const search = opts.search;
  /** The query Notes shows, as last applied (Advanced search). */
  const opened = queryText(state);
  let applied = opened;
  /** Advanced search, once "Save as view" asks for a name. */
  let naming = !search;
  const title = draft.id ? "Edit view" : draft.query ? "Save as view" : "New view";
  const heading = el("h2", {}, search ? "Advanced search" : title);
  const submit = el("button", { class: "qw-btn primary", type: "submit" }, search ? "Done" : "Save");
  const cancel = el("button", { class: "qw-btn", type: "button", onclick: () => back() }, "Cancel");
  const saveAs: HTMLButtonElement | null = search
    ? el("button", { class: "qw-btn sf-save-as", type: "button", title: "Keep this search in the sidebar", onclick: () => startNaming() }, icon("folderSearch", 13), "Save as view")
    : null;
  const shareRow = opts.alone
    ? null
    : el(
        "label",
        { class: "sf-just-me", title: opts.canShare ? "" : "Viewers can keep views of their own" },
        share,
        el("span", {}, "Share with workspace"),
        el("span", { class: "sf-hint" }, opts.canShare ? "Everyone in the workspace sees it in their sidebar" : "You can view this workspace, so it's yours only"),
      );
  const form = el(
    "form",
    { class: `sf-dialog${search ? " is-search" : ""}`, role: "dialog", "aria-modal": "true", "aria-label": heading.textContent! },
    el(
      "header",
      { class: "sf-head" },
      icon(search ? "search" : "folderSearch", 16),
      heading,
      el("button", { type: "button", class: "icon-btn small", title: "Close", "aria-label": "Close", onclick: () => dismiss() }, icon("close", 15)),
    ),
    name,
    // A view is a note (see core/views.ts): say which, so it can be found in the file tree.
    el("div", { class: "sf-hint sf-where" }, draft.path ? `Kept as the note ${draft.path}` : "Kept as a note in Views/"),
    el("div", { class: "sf-section" }, row("Words", wordBox), row("Folders", folderBox), row("Tags", tagBox), row("Sort", sort), row("Query", queryBox)),
    el("div", { class: "sf-result" }, count, preview),
    shareRow,
    error,
    el(
      "footer",
      { class: "qw-config-foot" },
      opts.remove ? el("button", { class: "qw-btn sf-delete", type: "button", onclick: () => void run(opts.remove!) }, icon("trash", 13), "Delete") : null,
      saveAs,
      el("span", { class: "spacer" }),
      cancel,
      submit,
    ),
  );
  const overlay = el("div", { class: "sf-modal" }, form);

  const close = () => {
    clearTimeout(timer);
    overlay.remove();
    document.querySelector(".folder-picker")?.remove();
    anchor.focus?.({ preventScroll: true }); // back where the keyboard was
  };
  /** Close without keeping anything: Advanced search puts back the filters Notes had. */
  const dismiss = () => {
    if (search && applied !== opened) search.apply(draft.query);
    close();
  };
  /** Cancel and Escape: out of naming, back to the search; otherwise close. */
  const back = () => (search && naming ? stopNaming() : dismiss());
  const setNaming = (on: boolean) => {
    naming = on;
    name.hidden = !on;
    if (shareRow) shareRow.hidden = !on;
    if (saveAs) saveAs.hidden = on;
    heading.textContent = on ? "Save as view" : "Advanced search";
    form.setAttribute("aria-label", heading.textContent);
    submit.textContent = on ? "Save" : "Done";
    cancel.textContent = on ? "Back" : "Cancel";
    error.hidden = true;
  };
  function startNaming() {
    if (queryProblem(current())) return text.focus();
    name.value = suggestName(current());
    setNaming(true);
    name.focus();
    name.select();
  }
  function stopNaming() {
    setNaming(false);
    saveAs?.focus();
  }
  const run = async (fn: () => Promise<void>) => {
    try {
      await fn();
      close();
    } catch (err) {
      error.hidden = false;
      error.textContent = err instanceof Error ? err.message : "Couldn't save the view";
    }
  };
  // The backdrop closes it; the pickers open outside the form, so a click in one isn't on the backdrop.
  overlay.addEventListener("mousedown", (e) => e.target === overlay && dismiss());
  form.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") back();
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (search && !naming) {
      // Done: Notes keeps the search (a query with a problem in it stays as Notes had it).
      if (!queryProblem(current()) && current() !== applied) search.apply((applied = current()));
      return close();
    }
    if (!name.value.trim()) {
      error.hidden = false;
      error.textContent = "Give the view a name";
      return name.focus();
    }
    // Saved from Advanced search: Notes shows what was saved, its name heading the page.
    if (search && current() !== applied) search.apply((applied = current()));
    void run(() => opts.save({ id: draft.id, name: name.value.trim(), query: current(), shared: opts.alone ? draft.shared : share.checked }));
  });
  renderWords();
  renderFolders();
  renderTags();
  if (search) setNaming(false);
  document.body.append(overlay);
  recount();
  if (search) return wordBox.querySelector<HTMLInputElement>(".sf-word")?.focus();
  name.focus();
  name.select();
}
