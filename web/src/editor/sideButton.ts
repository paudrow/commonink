// Open a [[link]] to the side without a modifier: hovering a link shows a small split button at its
// end, laid over the text so nothing moves. Links that leave the app never get one.
import { ViewPlugin, type EditorView } from "@codemirror/view";
import { el, icon } from "../dom.ts";
import { editorContext } from "./blocks.ts";

export const linkSideButton = ViewPlugin.fromClass(
  class {
    button: HTMLButtonElement;
    link: HTMLElement | null = null;
    timer = 0;

    constructor(readonly view: EditorView) {
      this.button = el("button", { type: "button", class: "cm-side-btn", title: "Open in split view", "aria-label": "Open in split view", tabindex: "-1", hidden: true }, icon("split", 13));
      this.button.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const target = this.link?.dataset.target;
        if (target === undefined) return;
        const ctx = view.state.facet(editorContext);
        ctx.openTarget(target, ctx.path, { where: "side" });
        this.hide();
      });
      this.button.addEventListener("mouseenter", () => clearTimeout(this.timer));
      this.button.addEventListener("mouseleave", this.hideSoon);
      view.dom.append(this.button);
      view.contentDOM.addEventListener("mouseover", this.over);
      view.contentDOM.addEventListener("mouseleave", this.hideSoon);
      view.scrollDOM.addEventListener("scroll", this.hide, { passive: true });
    }

    over = (e: MouseEvent) => {
      const link = (e.target as HTMLElement).closest<HTMLElement>(".cm-wikilink:not(.cm-embed-inline)");
      if (link) this.show(link);
      else this.hideSoon();
    };

    show(link: HTMLElement) {
      clearTimeout(this.timer);
      this.link = link;
      const rects = link.getClientRects();
      const r = rects[rects.length - 1];
      const box = this.view.dom.getBoundingClientRect();
      if (!r) return this.hide();
      Object.assign(this.button.style, { left: `${r.right - box.left + 2}px`, top: `${r.top - box.top + (r.height - 20) / 2}px` });
      this.button.hidden = false;
    }

    hideSoon = () => {
      clearTimeout(this.timer);
      this.timer = window.setTimeout(this.hide, 250);
    };

    hide = () => {
      this.button.hidden = true;
      this.link = null;
    };

    update() {
      if (this.link && !this.link.isConnected) this.hide();
    }

    destroy() {
      clearTimeout(this.timer);
      this.view.contentDOM.removeEventListener("mouseover", this.over);
      this.view.contentDOM.removeEventListener("mouseleave", this.hideSoon);
      this.view.scrollDOM.removeEventListener("scroll", this.hide);
      this.button.remove();
    }
  },
);
