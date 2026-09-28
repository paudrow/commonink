//   ::kanban{note="Launch"}   ::kanban{note="Launch" board=2}
// Another note's Kanban board, live: moving a card here saves that note. A board in the note
// itself is a `:::kanban` block, which the editor draws with the same board (see editor/blocks.ts).
import { api } from "../api.ts";
import { el } from "../dom.ts";
import type { WidgetSpec } from "./core.ts";

export const kanban: WidgetSpec = {
  name: "kanban",
  title: "Kanban",
  icon: "kanban",
  hint: "The board in another note",
  keywords: "kanban board columns cards embed",
  defaults: {},
  fields: [
    { key: "label", label: "Label", type: "text", placeholder: "Launch, Hiring…" },
    { key: "note", label: "Note", type: "text", placeholder: "The note the board is in" },
    { key: "board", label: "Board", type: "text", placeholder: "1 for its first board, 2 for the next…" },
  ],

  mount(body, env) {
    const say = (text: string) => {
      body.replaceChildren(el("div", { class: "qt-empty" }, text));
      env.remeasure();
    };
    const editor = env.editor;
    if (!editor || !env.args.note) {
      say("Choose the note with the board in settings.");
      return () => {};
    }
    let alive = true;
    let stop = () => {};
    const which = Math.max(1, Math.floor(Number(env.args.board)) || 1);
    // Loaded when drawn: the board module needs the editor's modules, which load this registry.
    void Promise.all([api.resolve(env.args.note, env.note), import("../kanban.ts")]).then(([path, { remoteBoard }]) => {
      if (!alive) return;
      if (!path) return say(`No note named “${env.args.note}”.`);
      stop = remoteBoard(body, path, which - 1, {
        ctx: editor,
        readOnly: !!env.readOnly,
        resized: env.remeasure,
        onMissing: () => say(which > 1 ? `${env.args.note} has no board ${which}.` : `${env.args.note} has no board. Add one with /Kanban board.`),
      });
    });
    return () => {
      alive = false;
      stop();
    };
  },
};

/** The settings form of a `:::kanban` block: the editor draws its board through `mount`. */
export const kanbanBlock = (mount: WidgetSpec["mount"]): WidgetSpec => ({
  name: "kanban",
  title: "Kanban",
  icon: "kanban",
  hint: "Columns of cards in this note",
  keywords: "",
  block: true,
  defaults: {},
  fields: [{ key: "done", label: "Done column", type: "text", placeholder: "Done: cards moved into it are ticked" }],
  mount,
});
