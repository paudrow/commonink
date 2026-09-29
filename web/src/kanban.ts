// A Kanban board drawn from a `:::kanban` block (see src/core/kanban.ts). Drag cards between
// columns and within one (or move them with Alt+arrows), tick, add, edit and delete them, turn one
// into a note, and add, rename, reorder and fold columns. The board keeps no copy of its own: it
// reads the note's markdown each time it draws, and each change is one core edit of that markdown
// handed to its host (an editor transaction for the open note, a save for another note's board).
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { insertNewline } from "@codemirror/commands";
import { api, ApiError, type Task } from "./api.ts";
import { displayName, el, icon, NOTE_DRAG } from "./dom.ts";
import { onVaultChange } from "./events.ts";
import { sideClick } from "./panes.ts";
import { renderMarkdown } from "./render.ts";
import { endTags, metaChips, today } from "./taskChips.ts";
import { openChipEditor, taskPeople } from "./taskChipEditors.ts";
import { inline } from "./taskRow.ts";
import { editorContext, type EditorContext } from "./editor/blocks.ts";
import { fieldCompletions } from "./editor/complete.ts";
import {
  addCard, addColumn, boardsIn, cardAsNote, cardLink, checkCard, deleteCard, editCard, moveCard, moveColumn, noteName, patchCard, renameColumn, type Card, type Column,
} from "../../src/core/kanban.ts";
import { parseTask } from "../../src/core/tasks.ts";
import { scanTags } from "../../src/core/tags.ts";

export interface BoardHost {
  /** The editor the board is shown in: note names and tags for suggestions, and opening notes, tags and people. */
  ctx: EditorContext;
  /** The note the board is in. */
  readonly path: string;
  /** That note's markdown, as it is now. */
  text(): string;
  /** Replace the note's markdown: one board change. */
  write(next: string): void;
  undo(): void;
  redo(): void;
  readOnly: boolean;
  /** Show the board's markdown, to change it by hand. */
  editText(): void;
  /** The board changed size. */
  resized(): void;
}

const CARD_DRAG = "application/x-common-ink-card";
const COLUMN_DRAG = "application/x-common-ink-column";
/** What's being dragged, since a dragover can't read the data it carries. */
let dragging: { path: string; board: number; column: number; card?: number; text?: string } | null = null;

const FOLDED = "quire.kanban.folded";
const folded = (): Set<string> => {
  try {
    return new Set(JSON.parse(localStorage.getItem(FOLDED) ?? "[]"));
  } catch {
    return new Set();
  }
};
function setFolded(key: string, on: boolean) {
  const all = folded();
  if (on) all.add(key);
  else all.delete(key);
  try {
    localStorage.setItem(FOLDED, JSON.stringify([...all]));
  } catch {}
}

/** An open text field on the board: adding a card, editing one, or naming a column. It survives redraws. */
type Field = { kind: "add" | "edit" | "rename" | "column"; column: number; card?: number; dom: HTMLElement; focus(): void; destroy(): void };

/**
 * Draw board number `index` of the host's note into `root`. `update` redraws it from the note (the
 * note changed, or the board is now number `index`).
 */
export function mountBoard(root: HTMLElement, host: BoardHost, index: number) {
  let at = index;
  let field: Field | null = null;
  let focus: { column: number; card: number } | null = null;
  const lane = el("div", { class: "kb" });
  root.append(lane);
  root.classList.toggle("is-readonly", host.readOnly);
  const board = () => boardsIn(host.text())[at];

  /** The card drawn at column `c`, place `i`, if it's still there with the same text. */
  const cardNow = (c: number, i: number, text: string): Card | null => {
    const card = board()?.columns[c]?.cards[i];
    return card?.text === text ? card : null;
  };

  /** Apply one core edit to the note, if the person may. A board that changed underneath just redraws. */
  const change = (fn: (md: string) => string) => {
    if (host.readOnly) return;
    const md = host.text();
    let next: string;
    try {
      next = fn(md);
    } catch {
      return draw();
    }
    if (next !== md) host.write(next);
  };

  function draw() {
    const b = board();
    const active = document.activeElement?.closest?.(".kb-card");
    if (!focus && active && root.contains(active)) focus = { column: Number((active as HTMLElement).dataset.column), card: Number((active as HTMLElement).dataset.card) };
    if (!b) {
      lane.replaceChildren(el("div", { class: "qt-empty" }, "This board isn't in the note any more."));
      return host.resized();
    }
    const shut = folded();
    lane.replaceChildren(
      ...b.columns.map((col, c) => columnEl(col, c, shut.has(foldKey(col.title)))),
      host.readOnly ? "" : field?.kind === "column" ? el("section", { class: "kb-col is-new" }, field.dom) : addColumnButton(),
    );
    field?.focus();
    if (focus) {
      lane.querySelector<HTMLElement>(`.kb-card[data-column="${focus.column}"][data-card="${focus.card}"]`)?.focus({ preventScroll: false });
      focus = null;
    }
    host.resized();
  }

  const foldKey = (title: string) => `${host.path}#${at}#${title.toLowerCase()}`;

  // ---------------------------------------------------------------- columns

  function columnEl(col: Column, c: number, shut: boolean): HTMLElement {
    const renaming = field?.kind === "rename" && field.column === c;
    const title = renaming ? field!.dom : el("span", { class: "kb-title", title: host.readOnly ? col.title : "Double-click to rename" }, col.title);
    const fold = el("button", { type: "button", class: "kb-fold", title: shut ? "Unfold column" : "Fold column" }, icon("chevron", 13));
    fold.addEventListener("click", () => (setFolded(foldKey(col.title), !shut), draw()));
    const head = el(
      "header",
      { class: "kb-col-head" },
      fold,
      title,
      el("span", { class: "kb-count" }, String(col.cards.length)),
      col.done ? el("span", { class: "kb-done", title: "Cards moved here are ticked" }, icon("check", 12)) : null,
      el("span", { class: "spacer" }),
      host.readOnly || shut ? null : el("button", { type: "button", class: "kb-icon", title: "Add a card", onclick: () => openAdd(c) }, icon("plus", 14)),
    );
    const list = el("div", { class: "kb-cards" }, ...col.cards.map((card, i) => (field?.kind === "edit" && field.column === c && field.card === i ? field.dom : cardEl(card, c, i))));
    const adding = field?.kind === "add" && field.column === c;
    const add = host.readOnly ? null : adding ? field!.dom : el("button", { type: "button", class: "kb-add", onclick: () => openAdd(c) }, icon("plus", 13), "Add card");
    const node = el("section", { class: `kb-col${shut ? " is-folded" : ""}${col.done ? " is-done" : ""}`, "data-column": String(c), "aria-label": col.title }, head, ...(shut ? [] : [list, add]));
    if (host.readOnly) return node;
    if (!renaming) title.addEventListener("dblclick", () => openRename(c, col.title));
    head.draggable = !renaming;
    head.addEventListener("dragstart", (e) => {
      dragging = { path: host.path, board: at, column: c };
      e.dataTransfer!.setData(COLUMN_DRAG, String(c));
      e.dataTransfer!.effectAllowed = "move";
      node.classList.add("is-dragging");
    });
    head.addEventListener("dragend", () => ((dragging = null), node.classList.remove("is-dragging")));
    node.addEventListener("dragover", (e) => {
      if (!e.dataTransfer?.types.includes(COLUMN_DRAG) || dragging?.path !== host.path || dragging.board !== at) return;
      e.preventDefault();
      lane.querySelectorAll(".is-drop").forEach((n) => n.classList.remove("is-drop"));
      node.classList.add("is-drop");
    });
    node.addEventListener("dragleave", (e) => !node.contains(e.relatedTarget as Node) && node.classList.remove("is-drop"));
    node.addEventListener("drop", (e) => {
      if (!e.dataTransfer?.types.includes(COLUMN_DRAG) || !dragging || dragging.card !== undefined) return;
      e.preventDefault();
      const from = dragging.column;
      dragging = null;
      change((md) => moveColumn(md, { board: at, column: from }, c));
    });
    if (!shut) cardDrops(list, c);
    return node;
  }

  function addColumnButton() {
    return el("button", { type: "button", class: "kb-add kb-add-col", onclick: () => openColumn() }, icon("plus", 13), "Add column");
  }

  function openRename(c: number, current: string) {
    openField("rename", c, undefined, textInput(current, "Column name", (v) => (v.trim() && v.trim() !== current ? change((md) => renameColumn(md, { board: at, column: c }, v)) : undefined)));
  }

  function openColumn() {
    openField("column", -1, undefined, textInput("", "New column", (v) => (v.trim() ? change((md) => addColumn(md, at, v)) : undefined)));
  }

  /** A one-line input that commits on Enter and closes on Enter, Escape or leaving it. */
  function textInput(value: string, label: string, commit: (v: string) => void): Pick<Field, "dom" | "focus" | "destroy"> {
    const input = el("input", { class: "kb-input", value, "aria-label": label, placeholder: label, spellcheck: "false" });
    let done = false;
    const finish = (save: boolean) => {
      if (done) return;
      done = true;
      field = null;
      if (save) commit(input.value);
      draw();
    };
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") finish(true);
      else if (e.key === "Escape") finish(false);
    });
    input.addEventListener("blur", () => setTimeout(() => input.isConnected && document.activeElement !== input && finish(true)));
    return { dom: input, focus: () => document.activeElement !== input && input.focus(), destroy: () => {} };
  }

  function openField(kind: Field["kind"], column: number, card: number | undefined, f: Pick<Field, "dom" | "focus" | "destroy">) {
    field?.destroy();
    field = { kind, column, card, ...f };
    draw();
  }

  // ---------------------------------------------------------------- cards

  function cardEl(card: Card, c: number, i: number): HTMLElement {
    const task = parseTask(`- [${card.checked ? "x" : " "}] ${card.text}`)!;
    const link = cardLink(card);
    const done = !!card.checked;
    const box =
      card.checked === null
        ? null
        : el("span", { class: `cm-checkbox${done ? " is-checked" : ""}`, role: "checkbox", "aria-checked": String(done), title: done ? "Mark open" : "Mark done" });
    box?.addEventListener("click", (e) => {
      e.stopPropagation();
      tick(c, i, card.text, !done);
    });
    const chips = metaChips(task.meta, done, endTags(task.summary, task.meta.tags)); // tags mid-sentence stay there
    const details = card.details.some((d) => d.trim()) ? el("div", { class: "kb-details", html: renderMarkdown(card.details.join("\n"), host.path) }) : null;
    details?.querySelectorAll("input").forEach((b) => (b.disabled = true));
    const act = (name: string, label: string, run: () => void) =>
      el("button", { type: "button", class: "kb-icon", title: label, "aria-label": label, onclick: (e: Event) => (e.stopPropagation(), run()) }, icon(name, 13));
    const actions = host.readOnly
      ? null
      : el(
          "div",
          { class: "kb-actions" },
          act("edit", "Edit (Enter)", () => openEdit(c, i, card)),
          link ? null : act("file", "Open as note", () => void openAsNote(c, i, card.text)),
          act("trash", "Delete (⌫)", () => remove(c, i, card.text)),
        );
    const node = el(
      "div",
      {
        class: `kb-card${done ? " is-done" : ""}${link ? " is-link" : ""}`,
        tabindex: "0",
        role: "listitem",
        "data-column": String(c),
        "data-card": String(i),
        "aria-keyshortcuts": host.readOnly ? "Enter" : "Alt+ArrowUp Alt+ArrowDown Alt+ArrowLeft Alt+ArrowRight Enter Space Delete",
      },
      el("div", { class: "kb-row" }, box, el("div", { class: "kb-main" }, link ? linkEl(link, new Set(task.meta.tags.map((t) => t.toLowerCase()))) : el("span", { class: "kb-text", html: inline(task.summary) }), chips.length ? el("div", { class: "kb-chips" }, ...chips) : null)),
      details,
      actions,
    );
    // A side click takes the mousedown too, so the note editor around the board doesn't act on it.
    node.addEventListener("mousedown", (e) => link && sideClick(e) && e.preventDefault());
    node.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      const chip = target.closest<HTMLElement>(".tk[data-field]");
      const tag = chip?.dataset.field === "tags" ? chip.dataset.value!.toLowerCase() : target.closest<HTMLElement>(".tag")?.dataset.tag;
      if (tag) return host.ctx.openTag(tag, "tasks");
      if (chip && !host.readOnly && openChipEditor(chip, chipContext(c, i, card, task))) return;
      if (link && !target.closest("a")) host.ctx.openTarget(link.target, host.path, { side: sideClick(e) });
    });
    node.addEventListener("dblclick", (e) => !link && !(e.target as HTMLElement).closest(".tk, .cm-checkbox, .kb-actions") && !host.readOnly && openEdit(c, i, card));
    node.addEventListener("keydown", (e) => keys(e, node, c, i, card, link));
    if (!host.readOnly) {
      node.draggable = true;
      node.addEventListener("dragstart", (e) => {
        e.stopPropagation();
        dragging = { path: host.path, board: at, column: c, card: i, text: card.text };
        e.dataTransfer!.setData(CARD_DRAG, card.text);
        e.dataTransfer!.effectAllowed = "move";
        requestAnimationFrame(() => node.classList.add("is-dragging"));
      });
      node.addEventListener("dragend", () => {
        dragging = null;
        node.classList.remove("is-dragging");
        lane.querySelectorAll(".kb-drop").forEach((n) => n.remove());
      });
    }
    return node;
  }

  const tick = (c: number, i: number, text: string, on: boolean) => {
    const card = cardNow(c, i, text);
    if (card) change((md) => checkCard(md, card.from, on, today()));
    else draw();
  };

  const remove = (c: number, i: number, text: string) => {
    const card = cardNow(c, i, text);
    if (!card) return draw();
    focus = { column: c, card: Math.max(0, i - 1) };
    change((md) => deleteCard(md, card.from));
  };

  /** A token chip's editor: its patch goes to the card's line through the one token writer. */
  function chipContext(c: number, i: number, card: Card, task: NonNullable<ReturnType<typeof parseTask>>) {
    const asTask: Task = { path: host.path, title: "", line: card.from + 1, text: card.text, summary: task.summary, done: task.done, heading: null, meta: task.meta };
    return {
      task: asTask,
      save: async (patch: Parameters<typeof patchCard>[2]) => {
        const now = cardNow(c, i, card.text);
        if (!now) throw new Error("That card changed while you were editing it. Click its chip again.");
        change((md) => patchCard(md, now.from, patch));
      },
      people: taskPeople,
      showPerson: (name: string) => host.ctx.openPerson(name),
    };
  }

  function keys(e: KeyboardEvent, node: HTMLElement, c: number, i: number, card: Card, link: ReturnType<typeof cardLink>) {
    if (e.target !== node) return;
    const mod = e.metaKey || e.ctrlKey;
    const b = board();
    if (!b) return;
    const step = ({ ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] } as Record<string, [number, number]>)[e.key];
    let handled = true;
    if (mod && e.key.toLowerCase() === "z") e.shiftKey ? host.redo() : host.undo();
    else if (step && e.altKey && !host.readOnly) {
      const column = c + step[0];
      const target = b.columns[column];
      const place = step[0] ? Math.min(i, target?.cards.length ?? 0) : i + step[1];
      const now = cardNow(c, i, card.text);
      if (target && now && place >= 0 && (step[0] || place < b.columns[c].cards.length)) {
        focus = { column, card: place };
        change((md) => moveCard(md, now.from, { board: at, column }, place, today()));
      }
    } else if (step) {
      const column = Math.min(Math.max(0, c + step[0]), b.columns.length - 1);
      const place = step[0] ? Math.min(i, b.columns[column].cards.length - 1) : i + step[1];
      lane.querySelector<HTMLElement>(`.kb-card[data-column="${column}"][data-card="${place}"]`)?.focus();
    } else if (e.key === "Enter" && (mod || host.readOnly) && link) host.ctx.openTarget(link.target, host.path);
    else if (e.key === "Enter" && !host.readOnly) openEdit(c, i, card);
    else if (e.key === " " && card.checked !== null && !host.readOnly) tick(c, i, card.text, !card.checked);
    else if ((e.key === "Delete" || e.key === "Backspace") && !host.readOnly) remove(c, i, card.text);
    else handled = false;
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  function cardDrops(list: HTMLElement, c: number) {
    const place = (y: number) => {
      const cards = [...list.querySelectorAll<HTMLElement>(".kb-card:not(.is-dragging)")];
      const i = cards.findIndex((n) => {
        const r = n.getBoundingClientRect();
        return y < r.top + r.height / 2;
      });
      return { i: i < 0 ? cards.length : i, before: i < 0 ? null : cards[i] };
    };
    const takes = (e: DragEvent) =>
      (e.dataTransfer?.types.includes(CARD_DRAG) && dragging?.path === host.path && dragging.card !== undefined) || e.dataTransfer?.types.includes(NOTE_DRAG);
    list.addEventListener("dragover", (e) => {
      if (!takes(e)) return;
      e.preventDefault();
      e.stopPropagation();
      list.insertBefore(lane.querySelector(".kb-drop") ?? el("div", { class: "kb-drop" }), place(e.clientY).before);
    });
    list.addEventListener("dragleave", (e) => !list.contains(e.relatedTarget as Node) && list.querySelector(".kb-drop")?.remove());
    list.addEventListener("drop", (e) => {
      if (!takes(e)) return;
      e.preventDefault();
      e.stopPropagation();
      const { i } = place(e.clientY);
      lane.querySelectorAll(".kb-drop").forEach((n) => n.remove());
      const note = e.dataTransfer!.getData(NOTE_DRAG);
      if (note && !dragging) return change((md) => addCard(md, { board: at, column: c }, `[[${linkName(note)}]]`, today(), i));
      const from = dragging!;
      dragging = null;
      const card = boardsIn(host.text())[from.board]?.columns[from.column]?.cards[from.card!];
      if (card?.text !== from.text) return draw();
      focus = { column: c, card: i };
      change((md) => moveCard(md, card.from, { board: at, column: c }, i, today()));
    });
  }

  /** The shortest [[name]] for a note dropped from the sidebar or the notes list. */
  const linkName = (path: string) => {
    const name = displayName(path);
    return host.ctx.notes().filter((n) => displayName(n.path) === name).length > 1 ? path.replace(/\.md$/i, "") : name;
  };

  // ---------------------------------------------------------------- adding, editing, Open as note

  function openAdd(c: number) {
    const col = board()?.columns[c];
    if (!col) return;
    openField("add", c, undefined, cardField("", "Card text: [[ links a note, # tags, due:2026-10-01…", (text) => change((md) => addCard(md, { board: at, column: c }, text, today()))));
  }

  function openEdit(c: number, i: number, card: Card) {
    const text = [card.text, ...card.details].join("\n").replace(/\n+$/, "");
    openField("edit", c, i, cardField(text, "Card text", (next) => {
      const now = cardNow(c, i, card.text);
      focus = { column: c, card: i };
      if (now) change((md) => editCard(md, now.from, next));
    }));
  }

  /**
   * A card's text in a small editor with the note editor's `[[` and `#` suggestions. Enter commits
   * (and, when adding, stays open for the next card); Shift+Enter starts a line nested under the
   * card; Escape, or Enter with nothing typed, closes.
   */
  function cardField(doc: string, hint: string, commit: (text: string) => void): Pick<Field, "dom" | "focus" | "destroy"> {
    const adding = !doc;
    const close = () => {
      field?.destroy();
      field = null;
      draw();
    };
    const view = new EditorView({
      doc,
      extensions: [
        editorContext.of({ ...host.ctx, path: host.path }),
        fieldCompletions(),
        keymap.of([
          { key: "Shift-Enter", run: insertNewline },
          {
            key: "Enter",
            run: (v) => {
              const text = v.state.doc.toString();
              if (!text.trim()) return queueMicrotask(close), true;
              if (adding) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: "" } });
              commit(text);
              if (!adding) queueMicrotask(close);
              return true;
            },
          },
          { key: "Escape", run: () => (queueMicrotask(close), true) },
        ]),
        EditorView.lineWrapping,
        placeholder(hint),
        EditorView.domEventHandlers({ keydown: (e) => e.stopPropagation() }),
      ],
    });
    view.dispatch({ selection: { anchor: view.state.doc.line(1).to } });
    const dom = el("div", { class: "kb-field" }, view.dom, el("div", { class: "kb-field-hint" }, adding ? "Enter to add · Shift+Enter for details · Esc to close" : "Enter to save · Shift+Enter for details · Esc to cancel"));
    return { dom, focus: () => !view.hasFocus && view.focus(), destroy: () => view.destroy() };
  }

  async function openAsNote(c: number, i: number, text: string) {
    const card = cardNow(c, i, text);
    if (!card) return draw();
    const dir = host.path.includes("/") ? host.path.slice(0, host.path.lastIndexOf("/") + 1) : "";
    const taken = new Set(host.ctx.notes().map((n) => displayName(n.path).toLowerCase()));
    const base = noteName(card);
    let name = base;
    for (let k = 2; taken.has(name.toLowerCase()); k++) name = `${base} ${k}`;
    try {
      await api.create(`${dir}${name}.md`, cardAsNote(card, name).body);
    } catch (e) {
      return alert(e instanceof ApiError ? e.message : `Couldn't create ${name}`);
    }
    const now = cardNow(c, i, text);
    if (now) change((md) => editCard(md, now.from, cardAsNote(now, name).text));
  }

  // ---------------------------------------------------------------- linked cards

  function linkEl(link: NonNullable<ReturnType<typeof cardLink>>, cardTags: Set<string>): HTMLElement {
    const title = el("span", { class: "kb-link-name" }, link.label);
    const more = el("div", { class: "kb-link-more" });
    const node = el("div", { class: "kb-link" }, el("div", { class: "kb-link-head" }, icon("file", 13), title), more);
    const fill = (p: Preview | null) => {
      if (!p) {
        node.classList.add("is-missing");
        more.replaceChildren(el("span", { class: "kb-muted" }, "No note yet. Click to create it."));
        return;
      }
      if (link.label === link.target) title.textContent = p.title;
      more.replaceChildren(
        ...(p.excerpt ? [el("div", { class: "kb-excerpt" }, p.excerpt)] : []),
        ...(p.tags.length || p.total
          ? [
              el(
                "div",
                { class: "kb-link-meta" },
                ...p.tags
                  .filter((t) => !cardTags.has(t.toLowerCase()))
                  .slice(0, 3)
                  .map((t) => el("span", { class: "tag", "data-tag": t.toLowerCase(), title: `Notes tagged #${t}` }, `#${t}`)),
                p.total ? el("span", { class: "kb-progress", title: `${p.done} of ${p.total} tasks done` }, el("span", { class: "kb-bar" }, el("span", { style: { width: `${(p.done / p.total) * 100}%` } })), `${p.done}/${p.total}`) : null,
              ),
            ]
          : []),
      );
    };
    const key = `${host.path}\u0000${link.target}`;
    shown.add(key);
    if (previews.has(key)) fill(previews.get(key)!);
    else
      void preview(link.target, host.path).then((p) => {
        previews.set(key, p);
        fill(p);
        host.resized();
      });
    return node;
  }

  /** Linked notes this board shows, so a change to one of them redraws it. */
  const shown = new Set<string>();
  draw();
  const off = onVaultChange(async () => {
    let changed = false;
    await Promise.all(
      [...shown].map(async (key) => {
        const [from, target] = key.split("\u0000");
        const p = await preview(target, from);
        if (JSON.stringify(p) === JSON.stringify(previews.get(key))) return;
        previews.set(key, p);
        changed = true;
      }),
    );
    if (changed && !field) draw();
  }, 400);
  return {
    update(i: number) {
      at = i;
      draw();
    },
    destroy() {
      off();
      field?.destroy();
    },
  };
}

// ---------------------------------------------------------------- previews of linked notes

interface Preview {
  title: string;
  excerpt: string;
  tags: string[];
  done: number;
  total: number;
}
/** Linked notes' previews, kept so a redraw doesn't flicker; boards refresh the ones they show when the vault changes. */
const previews = new Map<string, Preview | null>();

async function preview(target: string, from: string): Promise<Preview | null> {
  const path = await api.resolve(target.split("#")[0], from).catch(() => null);
  if (!path) return null;
  const note = await api.note(path).catch(() => null);
  if (!note) return null;
  const lines = note.content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").split("\n");
  const tasks = lines.map((l) => parseTask(l)).filter((t) => t && t.text.trim());
  const prose = lines
    .filter((l) => l.trim() && !/^\s*(#{1,6}\s|:::|::|```|~~~|!\[\[|\|)/.test(l) && !parseTask(l))
    .map((l) => l.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "").replace(/!?\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (_m, t, alias) => alias || t).replace(/[*_`>]/g, "").trim());
  const excerpt = prose.slice(0, 2).join(" ");
  return {
    title: note.title,
    excerpt: excerpt.length > 140 ? `${excerpt.slice(0, 139)}…` : excerpt,
    tags: [...new Map(scanTags(note.content).map((t) => [t.tag, t.display])).values()],
    done: tasks.filter((t) => t!.done).length,
    total: tasks.length,
  };
}

// ---------------------------------------------------------------- a board from another note

/**
 * A board shown outside its note (`::kanban{note=…}`, or a note embedded with `![[…]]`). Its changes
 * are saves of that note, one after another, each against the version the last one made; a save
 * that finds the note changed underneath loads it again. Undo puts back what the board replaced.
 */
export function remoteBoard(root: HTMLElement, path: string, index: number, opts: { ctx: EditorContext; readOnly: boolean; resized(): void; onMissing(): void }) {
  let note: { content: string; version: string } | null = null;
  let board: ReturnType<typeof mountBoard> | null = null;
  let pending = 0;
  let queue = Promise.resolve();
  let alive = true;
  const past: string[] = [];
  const future: string[] = [];
  const set = (next: string) => {
    note!.content = next;
    pending++;
    board?.update(index);
    queue = queue
      .then(async () => {
        note!.version = (await api.save(path, next, note!.version)).version;
      })
      .catch(() => load())
      .finally(() => pending--);
  };
  const host: BoardHost = {
    ctx: opts.ctx,
    path,
    readOnly: opts.readOnly,
    text: () => note?.content ?? "",
    write: (next) => {
      past.push(note!.content);
      future.length = 0;
      set(next);
    },
    undo: () => past.length && (future.push(note!.content), set(past.pop()!)),
    redo: () => future.length && (past.push(note!.content), set(future.pop()!)),
    editText: () => opts.ctx.openTarget(path, opts.ctx.path),
    resized: opts.resized,
  };
  async function load() {
    const n = await api.note(path).catch(() => null);
    if (!alive) return;
    if (!n) return opts.onMissing();
    note = { content: n.content, version: n.version };
    if (!boardsIn(n.content)[index]) return opts.onMissing();
    if (board) board.update(index);
    else board = mountBoard(root, host, index);
  }
  void load();
  const off = onVaultChange(() => pending || void load(), 300);
  return () => {
    alive = false;
    off();
    board?.destroy();
  };
}

/** Draw a live board in each slot renderMarkdown left for one (see its `boards` option). */
export function hydrateBoards(root: HTMLElement, path: string, opts: Omit<Parameters<typeof remoteBoard>[3], "onMissing">): Array<() => void> {
  return [...root.querySelectorAll<HTMLElement>(".kb-slot[data-board]")].map((slot) => {
    slot.classList.add("qw", "kb-embed");
    return remoteBoard(slot, path, Number(slot.dataset.board), { ...opts, onMissing: () => slot.replaceChildren(el("div", { class: "qt-empty" }, "This board isn't there any more.")) });
  });
}
