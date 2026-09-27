// Highlights lines an agent just changed, tagged with the agent's name, then fades out.
import { StateEffect, StateField, type Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { hueFor } from "../dom.ts";

export const flashChanges = StateEffect.define<{ ranges: Array<{ from: number; to: number }>; source: string }>();
export const clearFlash = StateEffect.define<null>();

class AgentTag extends WidgetType {
  constructor(readonly source: string) {
    super();
  }
  eq(o: AgentTag) {
    return o.source === this.source;
  }
  toDOM() {
    const s = document.createElement("span");
    s.className = "cm-agent-tag";
    s.style.setProperty("--hue", String(hueFor(this.source)));
    s.textContent = `✦ ${this.source}`;
    return s;
  }
}

export const agentFlash = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(clearFlash)) deco = Decoration.none;
      if (e.is(flashChanges)) {
        const doc = tr.state.doc;
        const hue = String(hueFor(e.value.source));
        const add: Range<Decoration>[] = [];
        const seen = new Set<number>();
        let tagged = false;
        for (const { from, to } of e.value.ranges) {
          const first = doc.lineAt(Math.min(from, doc.length));
          let last = doc.lineAt(Math.min(Math.max(from, to > from ? to - 1 : to), doc.length));
          while (last.number > first.number && !last.text.trim()) last = doc.line(last.number - 1);
          for (let l = first.number; l <= last.number; l++) {
            if (seen.has(l)) continue;
            seen.add(l);
            add.push(Decoration.line({ class: "cm-agent-line", attributes: { style: `--hue:${hue}` } }).range(doc.line(l).from));
          }
          if (!tagged) {
            add.push(Decoration.widget({ widget: new AgentTag(e.value.source), side: 1 }).range(first.to));
            tagged = true;
          }
        }
        deco = deco.update({ add, sort: true });
      }
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});
