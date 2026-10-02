// The Today page's Decisions card: questions agents asked with ask_decision (src/core/decisions.ts),
// one at a time. Pick an option (click, or its number), or answer in your own words, add why if you
// like, and Decide (Enter): the answer goes into today's daily note and the next question comes up.
// Skip (S, →) leaves one for later; ← goes back. With nothing waiting the card isn't there at all.
import { api, type Decision } from "./api.ts";
import { authorAvatar, el, icon, timeAgo, typingIn } from "./dom.ts";
import { onVaultChange } from "./events.ts";
import { NOTE_LINKS, noteTarget } from "./noteLinks.ts";
import { renderMarkdown } from "./render.ts";
import { toast } from "./toast.ts";

export interface DecisionHooks {
  open(path: string): void;
}

/** How often to look for new questions while the page is open: an agent can ask from another process. */
const POLL_MS = 30_000;

/** Mount the card into `host` (empty while nothing waits). Returns its cleanup. */
/** `page` is the page around it: its keys work there too, while nothing else has the focus. */
export function mountDecisions(host: HTMLElement, page: HTMLElement, hooks: DecisionHooks): () => void {
  let list: Decision[] = [];
  let at = 0;
  /** The picked option, "other" for your own words, or null. */
  let pick: number | "other" | null = null;
  let busy = false;
  let alive = true;
  /** How many were settled here, so clearing the last one can say so. */
  let settled = 0;
  const drafts = new Map<string, { other: string; comment: string }>();

  const current = () => list[at] as Decision | undefined;
  const draft = (d: Decision) => drafts.get(d.id) ?? (drafts.set(d.id, { other: "", comment: "" }), drafts.get(d.id)!);

  const load = async () => {
    const next = await api.decisions().catch(() => null);
    if (!alive || !next) return;
    const was = current()?.id;
    list = next;
    const i = was ? list.findIndex((d) => d.id === was) : -1;
    if (i >= 0) at = i;
    else {
      at = Math.min(at, Math.max(0, list.length - 1));
      pick = null;
    }
    // Don't redraw under someone typing their answer.
    if (!host.contains(document.activeElement) || !typingIn(document.activeElement) || i < 0) render();
    else count();
  };

  const go = (to: number) => {
    if (!list.length) return;
    at = (to + list.length) % list.length;
    pick = null;
    render();
    host.querySelector<HTMLElement>(".dc-card")?.focus({ preventScroll: true });
  };

  const decide = async (dismiss = false) => {
    const d = current();
    if (!d || busy) return;
    const { other, comment } = draft(d);
    if (!dismiss && (pick === null || (pick === "other" && !other.trim()))) return;
    busy = true;
    render();
    try {
      const done = await api.answerDecision(d.id, dismiss ? { dismiss: true, comment: comment || undefined } : pick === "other" ? { text: other, comment: comment || undefined } : { choice: pick!, comment: comment || undefined });
      settled++;
      drafts.delete(d.id);
      list = list.filter((x) => x.id !== d.id);
      at = Math.min(at, Math.max(0, list.length - 1));
      pick = null;
      toast({ icon: "check", text: dismiss ? "Not deciding that one; noted in today's note" : `Decided: ${done.answer}`, actionLabel: "Today's note", action: () => done.journal && hooks.open(done.journal) });
    } catch (e) {
      toast({ text: `Couldn't record that: ${(e as Error).message}` });
      void load();
    } finally {
      busy = false;
      render();
      host.querySelector<HTMLElement>(".dc-card")?.focus({ preventScroll: true });
    }
  };

  const count = () => {
    const c = host.querySelector(".dc-count");
    if (c) c.textContent = list.length > 1 ? `${at + 1} of ${list.length}` : "";
  };

  const render = () => {
    const d = current();
    // The agent's pick is picked to start with: Enter takes it.
    if (d && pick === null && d.recommended !== null && !draft(d).other.trim()) pick = d.recommended;
    if (!d) {
      host.replaceChildren(
        settled
          ? el("section", { class: "qw dc-card is-standalone is-clear", "aria-label": "Decisions" }, el("div", { class: "td-clear" }, icon("check", 14), "All decided. Your answers are in today's note."))
          : "",
      );
      return;
    }
    const dr = draft(d);
    const option = (label: string, i: number) =>
      el(
        "button",
        {
          type: "button",
          class: `dc-opt${pick === i ? " is-picked" : ""}`,
          role: "radio",
          "aria-checked": String(pick === i),
          onclick: () => ((pick = i), render()),
        },
        i < 9 ? el("kbd", {}, String(i + 1)) : "",
        el("span", { class: "dc-label" }, label),
        d.recommended === i ? el("span", { class: "dc-rec" }, "Recommended") : "",
      );
    const otherInput = el("input", {
      class: "dc-other-input",
      type: "text",
      placeholder: d.options.length ? "Or answer in your own words…" : "Your answer…",
      "aria-label": "Your own answer",
      value: dr.other,
      oninput: (e: Event) => {
        dr.other = (e.target as HTMLInputElement).value;
        const was = pick;
        pick = dr.other.trim() ? "other" : pick === "other" ? null : pick;
        if (was !== pick) for (const b of host.querySelectorAll(".dc-opt")) b.classList.remove("is-picked"), b.setAttribute("aria-checked", "false");
        decideBtn.disabled = busy || pick === null;
      },
    });
    const comment = el("textarea", {
      class: "dc-comment",
      rows: "1",
      placeholder: "Why? (optional, saved with the answer)",
      "aria-label": "Why (optional)",
      oninput: (e: Event) => (dr.comment = (e.target as HTMLTextAreaElement).value),
    });
    comment.value = dr.comment;
    const decideBtn = el("button", { type: "button", class: "qw-btn primary", disabled: busy || pick === null, onclick: () => void decide() }, busy ? "Saving…" : "Decide");
    const context = d.context ? el("div", { class: "dc-context", html: renderMarkdown(d.context, d.note ?? "") }) : "";
    if (context) wireLinks(context);
    const about = d.note ? el("button", { type: "button", class: "dc-about", onclick: () => hooks.open(d.note!) }, icon("file", 12), d.note.replace(/\.md$/, "")) : "";
    const nav = list.length > 1
      ? el(
          "span",
          { class: "dc-nav" },
          el("button", { type: "button", class: "qw-icon", title: "Previous (←)", onclick: () => go(at - 1) }, icon("chevron", 14)),
          el("button", { type: "button", class: "qw-icon dc-next", title: "Skip for now (S or →)", onclick: () => go(at + 1) }, icon("chevron", 14)),
        )
      : "";
    host.replaceChildren(
      el(
        "section",
        { class: "qw dc-card is-standalone", tabindex: "-1", "aria-labelledby": "dc-heading" },
        el("h2", { class: "td-title", id: "dc-heading" }, icon("flag", 14), "Decisions", el("span", { class: "dc-count" }, list.length > 1 ? `${at + 1} of ${list.length}` : ""), nav),
        el(
          "div",
          { class: "qw-body" },
          el("p", { class: "dc-q", id: "dc-q" }, d.question),
          el("div", { class: "dc-meta" }, authorAvatar({ source: d.asked_by, agent: d.agent }, 16), `Asked by ${d.agent ?? d.asked_by} · ${timeAgo(d.asked_at)}`, about),
          context,
          el("div", { class: "dc-options", role: "radiogroup", "aria-labelledby": "dc-q" }, ...d.options.map(option), otherInput),
          comment,
          el(
            "div",
            { class: "dc-actions" },
            decideBtn,
            list.length > 1 ? el("button", { type: "button", class: "qw-btn", onclick: () => go(at + 1) }, "Skip") : "",
            el("button", { type: "button", class: "dc-dismiss", title: "Close it without an answer; today's note says you didn't decide", onclick: () => void decide(true) }, "Not deciding"),
            el("span", { class: "dc-hint" }, d.options.length ? `1–${Math.min(9, d.options.length)} to pick, Enter to decide` : "Enter to decide"),
          ),
        ),
      ),
    );
  };

  function wireLinks(root: HTMLElement) {
    for (const a of root.querySelectorAll<HTMLAnchorElement>(NOTE_LINKS)) {
      a.addEventListener("click", async (e) => {
        e.preventDefault();
        const target = noteTarget(a.getAttribute("href")!);
        const path = target ? await api.resolve(target.split("#")[0]).catch(() => null) : null;
        if (path) hooks.open(path);
      });
    }
  }

  function keys(e: KeyboardEvent) {
    const d = current();
    const t = e.target as HTMLElement;
    if (!d || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented || !(t === page || host.contains(t))) return;
    if (e.key === "Enter" && !e.shiftKey && (!typingIn(t) || t.matches(".dc-other-input, .dc-comment"))) {
      if (t.matches("button") && !t.matches(".dc-opt")) return; // the button's own click
      e.preventDefault();
      void decide();
      return;
    }
    if (typingIn(t)) {
      if (e.key === "Escape") (t as HTMLElement).blur(), host.querySelector<HTMLElement>(".dc-card")?.focus({ preventScroll: true });
      return;
    }
    const n = Number(e.key);
    if (n >= 1 && n <= Math.min(9, d.options.length)) {
      pick = n - 1;
      render();
      host.querySelector<HTMLElement>(".dc-card")?.focus({ preventScroll: true });
    } else if (e.key === "s" || e.key === "ArrowRight") go(at + 1);
    else if (e.key === "ArrowLeft") go(at - 1);
    else if (e.key === "o") host.querySelector<HTMLInputElement>(".dc-other-input")?.focus();
    else return;
    e.preventDefault();
  }

  void load();
  page.addEventListener("keydown", keys);
  const off = onVaultChange(() => void load(), 500);
  const timer = window.setInterval(() => document.visibilityState === "visible" && void load(), POLL_MS);
  const onFocus = () => void load();
  window.addEventListener("focus", onFocus);
  return () => {
    alive = false;
    off();
    clearInterval(timer);
    window.removeEventListener("focus", onFocus);
    page.removeEventListener("keydown", keys);
  };
}
