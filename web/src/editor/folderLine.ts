// The folder a note is in, in small muted text above it, only when it's in one. Each part of the
// path is a link to Notes narrowed to that folder. It's a widget, not text in the note: the lines,
// the cursor and the heading that names the note (noteName.ts) are where they were without it.
import { StateEffect, StateField, type EditorState } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { el, icon } from "../dom.ts";
import { editorContext } from "./blocks.ts";

/** Dispatch when the open note's path changed under the editor (a save that followed a move). */
export const refreshFolder = StateEffect.define<null>();

class FolderWidget extends WidgetType {
  constructor(readonly folder: string) {
    super();
  }
  eq(o: FolderWidget) {
    return o.folder === this.folder;
  }
  ignoreEvent() {
    return true;
  }
  toDOM(view: EditorView) {
    const parts = this.folder.split("/");
    const open = (folder: string) => view.state.facet(editorContext).openFolder?.(folder);
    return el(
      "nav",
      { class: "cm-folder-line", "aria-label": "Folder" },
      icon("folder", 12),
      ...parts.flatMap((name, i) => {
        const folder = parts.slice(0, i + 1).join("/");
        const link = el("button", { type: "button", title: `Show the notes in ${folder.split("/").join(" / ")}`, onmousedown: (e: Event) => e.preventDefault(), onclick: () => open(folder) }, name);
        return i ? [el("span", { class: "cm-folder-sep", "aria-hidden": "true" }, "/"), link] : [link];
      }),
    );
  }
}

function build(state: EditorState): DecorationSet {
  const path = state.facet(editorContext)?.path ?? "";
  const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  if (!folder) return Decoration.none;
  return Decoration.set([Decoration.widget({ widget: new FolderWidget(folder), block: true, side: -1 }).range(0)]);
}

export const folderLine = StateField.define<DecorationSet>({
  create: build,
  update: (deco, tr) => (tr.effects.some((e) => e.is(refreshFolder)) ? build(tr.state) : deco.map(tr.changes)),
  provide: (f) => EditorView.decorations.from(f),
});
