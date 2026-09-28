// Rendering one before/after pair as a diff: rewritten paragraphs word by word, unchanged runs
// folded to a little context, and very long added or removed blocks folded too.
import { diffLines, diffWordsWithSpace } from "diff";
import { el } from "./dom.ts";

const CONTEXT = 2;
const LONG = 60; // an added/removed block longer than this shows its first SHOWN lines
const SHOWN = 30;

export function diffCounts(before: string, after: string): { add: number; del: number } {
  let add = 0;
  let del = 0;
  for (const p of diffLines(before, after)) {
    if (p.added) add += p.count ?? 0;
    else if (p.removed) del += p.count ?? 0;
  }
  return { add, del };
}

export function renderDiff(before: string, after: string): HTMLElement {
  const out = el("div", { class: "cv-diff" });
  const parts = diffLines(before, after);
  const lines = (s: string) => s.replace(/\n$/, "").split("\n");
  const row = (kind: string, content: Node | string) => el("div", { class: `cv-line is-${kind}` }, content);
  const fold = (label: string, rows: HTMLElement[]) => {
    const b = el("button", { type: "button", class: "cv-fold" }, label);
    b.addEventListener("click", () => b.replaceWith(...rows));
    return b;
  };

  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!p.added && !p.removed) {
      const ls = lines(p.value);
      const head = i > 0 ? ls.slice(0, CONTEXT) : [];
      const tail = i < parts.length - 1 ? ls.slice(-CONTEXT) : [];
      if (ls.length <= head.length + tail.length + 1) {
        out.append(...ls.map((l) => row("ctx", l)));
      } else {
        const hidden = ls.slice(head.length, ls.length - tail.length);
        out.append(
          ...head.map((l) => row("ctx", l)),
          fold(`⋯ ${hidden.length} unchanged line${hidden.length > 1 ? "s" : ""}`, hidden.map((l) => row("ctx", l))),
          ...tail.map((l) => row("ctx", l)),
        );
      }
      continue;
    }
    const next = parts[i + 1];
    if (p.removed && next?.added && lines(p.value).length <= 12 && lines(next.value).length <= 12) {
      // A rewritten paragraph: show it once, with the words that changed marked.
      const merged = el("div", { class: "cv-line is-mod" });
      for (const w of diffWordsWithSpace(p.value.replace(/\n$/, ""), next.value.replace(/\n$/, ""))) {
        merged.append(w.added ? el("ins", {}, w.value) : w.removed ? el("del", {}, w.value) : w.value);
      }
      out.append(merged);
      i++;
      continue;
    }
    const kind = p.added ? "add" : "del";
    const ls = lines(p.value);
    if (ls.length > LONG) {
      const rest = ls.slice(SHOWN);
      out.append(...ls.slice(0, SHOWN).map((l) => row(kind, l)), fold(`⋯ ${rest.length} more ${p.added ? "added" : "removed"} lines`, rest.map((l) => row(kind, l))));
    } else {
      out.append(...ls.map((l) => row(kind, l)));
    }
  }
  return out;
}
