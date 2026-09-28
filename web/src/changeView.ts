// One change from the activity list, as a diff: what was added and removed, by whom, and a way
// back. Prose edits show word by word; long unchanged stretches fold away.
import { diffLines, diffWordsWithSpace } from "diff";
import { api, type Change } from "./api.ts";
import { avatar, displayName, el, icon, timeAgo } from "./dom.ts";

export type ChangeGroup = Change & { count: number; first: number };

interface Hooks {
  verb(c: Change): string;
  open(path: string): void;
  toast(t: { text: string; icon?: string; actionLabel?: string; action?: () => void }): void;
}

const CONTEXT = 2;

export async function showChange(c: ChangeGroup, hooks: Hooks) {
  document.querySelector("#change-view")?.remove();
  const body = el("div", { class: "cv-body" }, el("div", { class: "cv-note" }, "Loading…"));
  const restoreBtn = el("button", { type: "button", class: "qw-btn", title: "Put the note back the way it was before this change", hidden: true }, icon("reset", 14), "Restore earlier version");
  const openBtn = el("button", { type: "button", class: "qw-btn primary" }, icon("open", 14), "Open note");
  const close = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKey, true);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };
  const [add, del] = (c.summary ?? "").match(/^\+(\d+) −(\d+)$/)?.slice(1) ?? [];
  const box = el(
    "div",
    { class: "cv-box", role: "dialog", "aria-label": `${c.source} ${hooks.verb(c)} ${displayName(c.path)}` },
    el(
      "header",
      { class: "cv-head" },
      avatar(c.source, 28),
      el(
        "div",
        { class: "cv-title" },
        el("div", {}, el("b", {}, c.source), ` ${hooks.verb(c)} `, el("b", {}, displayName(c.path))),
        el(
          "div",
          { class: "cv-meta" },
          add !== undefined ? el("span", { class: "diffstat" }, el("span", { class: "add" }, `+${add}`), el("span", { class: "del" }, `−${del}`)) : null,
          c.count > 1 ? el("span", {}, `${c.count} saves`) : null,
          el("span", {}, timeAgo(c.ts)),
          el("span", { class: "cv-path" }, c.path),
        ),
      ),
      el("button", { type: "button", class: "icon-btn", title: "Close (Esc)", onclick: close }, icon("close", 16)),
    ),
    body,
    el("footer", { class: "cv-foot" }, restoreBtn, el("span", { class: "spacer" }), openBtn),
  );
  const overlay = el("div", { id: "change-view", onmousedown: (e: MouseEvent) => e.target === overlay && close() }, box);
  document.body.append(overlay);
  document.addEventListener("keydown", onKey, true);
  openBtn.addEventListener("click", () => (close(), hooks.open(c.path)));
  openBtn.focus();

  if (c.op === "move" || c.op === "archive" || c.op === "unarchive") {
    body.replaceChildren(el("div", { class: "cv-note" }, `${c.op === "move" ? "Moved" : c.op === "archive" ? "Archived" : "Unarchived"} from `, el("code", {}, c.from_path ?? "?"), " to ", el("code", {}, c.path), ". The text didn't change."));
    return;
  }
  const d = await api.diff(c.first, c.id).catch(() => null);
  if (!overlay.isConnected) return;
  if (!d || d.before === null || d.after === null) {
    body.replaceChildren(el("div", { class: "cv-note" }, "The text of this change isn't available any more."));
    return;
  }
  body.replaceChildren(d.before === d.after ? el("div", { class: "cv-note" }, "No text changed.") : renderDiff(d.before, d.after));
  if (d.op !== "create") {
    restoreBtn.hidden = false;
    restoreBtn.addEventListener("click", async () => {
      restoreBtn.disabled = true;
      const r = await api.restore(c.first).catch(() => null);
      if (!r) {
        restoreBtn.disabled = false;
        return hooks.toast({ text: "Couldn't restore that version" });
      }
      close();
      hooks.toast({
        icon: "reset",
        text: `Restored ${displayName(r.path)} to before this change`,
        actionLabel: r.change ? "Undo" : undefined,
        action: r.change ? () => void api.restore(r.change!) : undefined,
      });
    });
  }
}

/** A unified diff: changed paragraphs word by word, unchanged runs folded to a line of context. */
export function renderDiff(before: string, after: string): HTMLElement {
  const out = el("div", { class: "cv-diff" });
  const parts = diffLines(before, after);
  const lines = (s: string) => s.replace(/\n$/, "").split("\n");
  const row = (kind: string, content: Node | string) => el("div", { class: `cv-line is-${kind}` }, content);

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
        const fold = el("button", { type: "button", class: "cv-fold" }, `⋯ ${hidden.length} unchanged line${hidden.length > 1 ? "s" : ""}`);
        fold.addEventListener("click", () => fold.replaceWith(...hidden.map((l) => row("ctx", l))));
        out.append(...head.map((l) => row("ctx", l)), fold, ...tail.map((l) => row("ctx", l)));
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
    out.append(...lines(p.value).map((l) => row(p.added ? "add" : "del", l)));
  }
  return out;
}
