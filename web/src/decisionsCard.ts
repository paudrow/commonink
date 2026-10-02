// The Today page's Decisions card: questions agents asked with ask_decision (src/core/decisions.ts),
// one at a time, each in its own shape: pick one, pick many, yes or no, a choice for each row,
// pictures side by side, an order, a scale, or words. Every question can be answered in your own
// words (all but rank and scale), commented on, or skipped (S) to come back to. Decide (Enter) writes the
// answer into today's daily note and brings up the next one. ← and → move between all of them, the
// skipped ones and the ones answered today too, where the answer can be changed (its lines in the note
// are rewritten).
// With nothing waiting or answered today the card isn't there at all.
import { api, assetUrl, type Decision } from "./api.ts";
import type { DecisionValue } from "../../src/core/decisions.ts";
import { authorAvatar, el, icon, timeAgo, typingIn } from "./dom.ts";
import { onVaultChange } from "./events.ts";
import { localDate } from "../../src/core/tasks.ts";
import { NOTE_LINKS, noteTarget } from "./noteLinks.ts";
import { today } from "./taskChips.ts";
import { renderMarkdown } from "./render.ts";
import { toast } from "./toast.ts";

export interface DecisionHooks {
  open(path: string): void;
}

/** How often to look for new questions while the page is open: an agent can ask from another process. */
const POLL_MS = 30_000;

/** What's been picked so far for one question, kept while you move between them. */
interface Draft {
  pick: number | null;
  picks: Set<number>;
  rows: Array<number | null>;
  order: number[];
  scale: number | null;
  other: string;
  comment: string;
}

/** A fresh draft, starting from the answer given (for one answered already) or what the agent would answer. */
function draftOf(d: Decision): Draft {
  const r = d.status === "answered" ? d.value : d.recommended;
  return {
    pick: r && "choice" in r ? r.choice : null,
    picks: new Set(r && "choices" in r ? r.choices : []),
    rows: r && "rows" in r ? [...r.rows] : d.rows.map(() => null),
    order: r && "order" in r ? [...r.order] : d.options.map((_, i) => i),
    scale: r && "scale" in r ? r.scale : null,
    other: r && "text" in r ? r.text : "",
    comment: d.comment ?? "",
  };
}

const ownWords = (d: Decision) => d.kind !== "rank" && d.kind !== "scale";

/** The answer the draft makes, or null if it isn't one yet. */
function valueOf(d: Decision, dr: Draft): DecisionValue | null {
  if (ownWords(d) && dr.other.trim()) return { text: dr.other.trim() };
  switch (d.kind) {
    case "one":
    case "compare":
    case "yes_no":
      return dr.pick === null ? null : { choice: dr.pick };
    case "many":
      return dr.picks.size >= Math.max(1, d.min ?? 0) && (d.max === null || dr.picks.size <= d.max) ? { choices: [...dr.picks].sort((a, b) => a - b) } : null;
    case "rows":
      return dr.rows.some((r) => r !== null) ? { rows: dr.rows } : null;
    case "rank":
      return { order: dr.order };
    case "scale":
      return dr.scale === null ? null : { scale: dr.scale };
    case "text":
      return null;
  }
}

/** Mount the card into `host` (empty while nothing waits). `page` is the page around it: its keys work there too, while nothing else has the focus. Returns its cleanup. */
export function mountDecisions(host: HTMLElement, page: HTMLElement, hooks: DecisionHooks): () => void {
  /** Today's answered (and not-decided) ones, in the order answered, then the open ones, in the order asked. */
  let list: Decision[] = [];
  /** Where you are in `shown()`; its length is the "all decided" end. */
  let at = 0;
  let busy = false;
  let alive = true;
  let loaded = false;
  /** How many were settled here, so clearing the last one can say so. */
  let settled = 0;
  /** Skipped for now: Decide and Skip pass them by, ← and → still reach them. */
  const skipped = new Set<string>();
  const drafts = new Map<string, Draft>();

  const isOpen = (d: Decision) => d.status === "open";
  const waiting = () => list.filter((d) => isOpen(d) && !skipped.has(d.id));
  /** What ← and → step through: today's answered ones, then the open ones. */
  const shown = () => list;
  const current = () => shown()[at] as Decision | undefined;
  /** The first one waiting (open, not skipped) from `from` on, round to the start; the end with none. */
  const firstOpen = (from = 0) => {
    const all = shown();
    const n = all.length;
    for (let k = 0; k < n; k++) {
      const i = (from + k) % n;
      if (isOpen(all[i]) && !skipped.has(all[i].id)) return i;
    }
    return n;
  };
  const sorted = (all: Decision[]) => {
    const day = today();
    const done = all.filter((d) => (d.status === "answered" || d.status === "dismissed") && d.answered_at && localDate(d.answered_at) === day).sort((a, b) => a.answered_at! - b.answered_at!);
    return [...done, ...all.filter(isOpen)];
  };
  const draft = (d: Decision) => drafts.get(d.id) ?? (drafts.set(d.id, draftOf(d)), drafts.get(d.id)!);
  /** The agent's suggested words for a text question, while they still stand as the answer. */
  const suggested = (d: Decision) => {
    const r = d.recommended;
    return d.kind === "text" && isOpen(d) && r && "text" in r && draft(d).other === r.text ? r.text : null;
  };
  /** Back on the card after a step. A text question puts you in its answer instead, selected (the agent's suggestion, or your answer): Enter takes it, typing replaces it. */
  const focusCard = () => {
    const d = current();
    const box = d?.kind === "text" ? host.querySelector<HTMLTextAreaElement>(".dc-other-input") : null;
    if (box) {
      box.focus({ preventScroll: true });
      box.select();
      return;
    }
    host.querySelector<HTMLElement>(".dc-card")?.focus({ preventScroll: true });
  };

  const load = async () => {
    const next = await Promise.all([api.decisions(), api.decisions("settled")]).catch(() => null);
    if (!alive || !next) return;
    const first = !loaded;
    loaded = true;
    const was = current()?.id;
    list = sorted(next.flat());
    for (const id of skipped) if (!list.some((d) => d.id === id && isOpen(d))) skipped.delete(id);
    const i = was ? shown().findIndex((d) => d.id === was) : -1;
    // Open on the first one waiting; after that, stay where you are.
    at = first ? firstOpen() : i >= 0 ? i : Math.min(at, firstOpen());
    // Don't redraw under someone typing their answer.
    if (!host.contains(document.activeElement) || !typingIn(document.activeElement) || i < 0) render();
    else count();
  };

  /** Step to `to`: from the first back to the end ("all decided", or the last one when some still wait), and round. */
  const go = (to: number) => {
    const n = shown().length;
    if (!n) return;
    const slots = waiting().length ? n : n + 1;
    at = ((to % slots) + slots) % slots;
    render();
    focusCard();
  };

  const skip = () => {
    const d = current();
    if (!d) return;
    if (!isOpen(d)) return go(at + 1);
    skipped.add(d.id);
    at = firstOpen(at + 1);
    render();
    focusCard();
  };

  const decide = async () => {
    const d = current();
    if (!d || busy) return;
    const dr = draft(d);
    const value = valueOf(d, dr);
    if (!value) return;
    busy = true;
    render();
    const change = !isOpen(d);
    try {
      const comment = dr.comment.trim() || undefined;
      const done = await api.answerDecision(d.id, { value, comment, change });
      settled++;
      drafts.delete(d.id);
      list = sorted(list.map((x) => (x.id === d.id ? done : x)));
      // A new answer brings up the next one waiting; a changed one stays put to see it.
      at = change ? shown().findIndex((x) => x.id === d.id) : firstOpen();
      const said = (done.answer ?? "").length > 60 ? `${done.answer!.slice(0, 57)}…` : done.answer;
      toast({ icon: "check", text: `${change ? "Changed to" : "Decided"}: ${said}`, actionLabel: "Today's note", action: () => done.journal && hooks.open(done.journal) });
    } catch (e) {
      toast({ text: `Couldn't record that: ${(e as Error).message}` });
      void load();
    } finally {
      busy = false;
      render();
      focusCard();
    }
  };

  const count = () => {
    const c = host.querySelector(".dc-count");
    if (c) c.textContent = countText();
  };

  const countText = () => {
    const n = shown().length;
    const left = list.filter(isOpen).length;
    return n > 1 && at < n ? `${at + 1} of ${n}${left && left < n ? ` · ${left} left` : ""}` : "";
  };

  /** Back and next, shown while there's anywhere else to go (at the end, "Go back" and ← do it). */
  const navOf = () =>
    shown().length > 1 || !waiting().length
      ? el(
          "span",
          { class: "dc-nav" },
          el("button", { type: "button", class: "qw-icon", title: "Previous (←)", "aria-label": "Previous decision", onclick: () => go(at - 1) }, icon("chevron", 14)),
          el("button", { type: "button", class: "qw-icon dc-next", title: "Next (→)", "aria-label": "Next decision", onclick: () => go(at + 1) }, icon("chevron", 14)),
        )
      : "";

  /** Redraw just the Decide button's state (as you type, without redrawing the field you're in). */
  const ready = () => {
    const d = current();
    const b = host.querySelector<HTMLButtonElement>(".dc-decide");
    if (d && b) b.disabled = busy || !valueOf(d, draft(d));
  };

  const render = () => {
    const d = current();
    if (!d) {
      const later = list.filter(isOpen).length;
      const answered = shown().length;
      const back = answered ? el("button", { type: "button", class: "dc-again", onclick: () => go(at - 1) }, "Go back to change one") : "";
      host.replaceChildren(
        later
          ? el(
              "section",
              { class: "qw dc-card is-standalone is-clear", tabindex: "-1", "aria-label": "Decisions" },
              el(
                "div",
                { class: "td-clear" },
                icon("flag", 14),
                `${later} skipped for now. ← goes back to them.`,
                el("button", { type: "button", class: "dc-again", onclick: () => (skipped.clear(), (at = firstOpen()), render(), focusCard()) }, "Show them again"),
              ),
            )
          : answered || settled
            ? el(
                "section",
                { class: "qw dc-card is-standalone is-clear", tabindex: "-1", "aria-label": "Decisions" },
                el("div", { class: "td-clear" }, icon("check", 14), "All decided. Your answers are in today's note.", back),
              )
            : "",
      );
      return;
    }
    const open = isOpen(d);
    const dr = draft(d);
    const rec = d.recommended;
    const isRec = (i: number) => !!rec && (("choice" in rec && rec.choice === i) || ("choices" in rec && rec.choices.includes(i)));
    const recBadge = (i: number) => (isRec(i) ? el("span", { class: "dc-rec" }, "Recommended") : "");
    const pic = (src: string, cls: string, alt: string) =>
      el("img", { class: cls, src: assetUrl(src, d.note ?? undefined), alt, loading: "lazy", onerror: (e: Event) => ((e.target as HTMLElement).hidden = true) });
    const n = d.options.length;
    const pickOne = (i: number) => ((dr.pick = dr.pick === i && d.kind !== "yes_no" ? null : i), (dr.other = ""), render());
    const toggle = (i: number) => (dr.picks.has(i) ? dr.picks.delete(i) : dr.picks.add(i), (dr.other = ""), render());

    let body: HTMLElement;
    switch (d.kind) {
      case "yes_no":
        body = el(
          "div",
          { class: "dc-yesno", role: "radiogroup", "aria-labelledby": "dc-q" },
          ...d.options.map((o, i) =>
            el("button", { type: "button", class: `dc-opt${dr.pick === i ? " is-picked" : ""}`, role: "radio", "aria-checked": String(dr.pick === i), onclick: () => pickOne(i) }, el("kbd", {}, o.label[0].toUpperCase()), el("span", { class: "dc-label" }, o.label), recBadge(i)),
          ),
        );
        break;
      case "compare":
        body = el(
          "div",
          { class: "dc-compare", role: "radiogroup", "aria-labelledby": "dc-q", style: { "--cols": String(Math.min(n, 3)) } },
          ...d.options.map((o, i) =>
            el(
              "button",
              { type: "button", class: `dc-tile${dr.pick === i ? " is-picked" : ""}`, role: "radio", "aria-checked": String(dr.pick === i), onclick: () => pickOne(i) },
              o.image ? pic(o.image, "dc-tile-img", o.label) : el("div", { class: "dc-tile-img is-empty" }, icon("image", 20)),
              el("span", { class: "dc-tile-head" }, i < 9 ? el("kbd", {}, String(i + 1)) : "", el("span", { class: "dc-label" }, o.label), recBadge(i)),
              o.detail ? el("span", { class: "dc-detail" }, o.detail) : "",
            ),
          ),
        );
        break;
      case "one":
      case "many": {
        const many = d.kind === "many";
        body = el(
          "div",
          { class: "dc-options", role: many ? "group" : "radiogroup", "aria-labelledby": "dc-q" },
          ...d.options.map((o, i) => {
            const on = many ? dr.picks.has(i) : dr.pick === i;
            return el(
              "button",
              { type: "button", class: `dc-opt${on ? " is-picked" : ""}${many ? " is-check" : ""}`, role: many ? "checkbox" : "radio", "aria-checked": String(on), onclick: () => (many ? toggle(i) : pickOne(i)) },
              i < 9 ? el("kbd", {}, String(i + 1)) : "",
              o.image ? pic(o.image, "dc-thumb", "") : "",
              el("span", { class: "dc-label" }, o.label, o.detail ? el("span", { class: "dc-detail" }, o.detail) : ""),
              recBadge(i),
              many ? el("span", { class: "dc-check", "aria-hidden": "true" }, on ? icon("check", 14) : "") : "",
            );
          }),
          many && (d.min || d.max) ? el("p", { class: "dc-note" }, d.min && d.max ? (d.min === d.max ? `Pick ${d.min}.` : `Pick ${d.min} to ${d.max}.`) : d.min ? `Pick at least ${d.min}.` : `Pick up to ${d.max}.`) : "",
        );
        break;
      }
      case "rows": {
        const setAll = (i: number) => ((dr.rows = dr.rows.map(() => i)), render());
        body = el(
          "div",
          { class: "dc-rows", role: "table", "aria-labelledby": "dc-q", style: { "--cols": String(n) } },
          el(
            "div",
            { class: "dc-row is-head", role: "row" },
            el("span", { role: "columnheader" }),
            ...d.options.map((o, i) => el("button", { type: "button", role: "columnheader", class: "dc-all", title: `${o.label} for every row`, onclick: () => setAll(i) }, o.label)),
          ),
          ...d.rows.map((r, ri) =>
            el(
              "div",
              { class: "dc-row", role: "row" },
              el("span", { class: "dc-row-label", role: "rowheader", id: `dc-row-${ri}` }, r),
              ...d.options.map((o, i) =>
                el(
                  "button",
                  {
                    type: "button",
                    role: "cell",
                    class: `dc-cell${dr.rows[ri] === i ? " is-picked" : ""}`,
                    "aria-pressed": String(dr.rows[ri] === i),
                    "aria-label": `${r}: ${o.label}`,
                    onclick: () => ((dr.rows[ri] = dr.rows[ri] === i ? null : i), render()),
                  },
                  o.label,
                ),
              ),
            ),
          ),
        );
        break;
      }
      case "rank": {
        const move = (pos: number, by: number) => {
          const to = pos + by;
          if (to < 0 || to >= dr.order.length) return;
          [dr.order[pos], dr.order[to]] = [dr.order[to], dr.order[pos]];
          render();
          host.querySelector<HTMLElement>(`[data-rank="${to}"] .dc-${by < 0 ? "up" : "down"}`)?.focus();
        };
        body = el(
          "ol",
          { class: "dc-rank", "aria-labelledby": "dc-q" },
          ...dr.order.map((oi, pos) => {
            const o = d.options[oi];
            return el(
              "li",
              { class: "dc-opt", "data-rank": String(pos) },
              el("span", { class: "dc-pos" }, String(pos + 1)),
              o.image ? pic(o.image, "dc-thumb", "") : "",
              el("span", { class: "dc-label" }, o.label, o.detail ? el("span", { class: "dc-detail" }, o.detail) : ""),
              el("button", { type: "button", class: "qw-icon dc-up", title: `Move ${o.label} up`, disabled: pos === 0, onclick: () => move(pos, -1) }, icon("chevron", 14)),
              el("button", { type: "button", class: "qw-icon dc-down", title: `Move ${o.label} down`, disabled: pos === dr.order.length - 1, onclick: () => move(pos, 1) }, icon("chevron", 14)),
            );
          }),
        );
        break;
      }
      case "scale": {
        const steps = Array.from({ length: d.max! - d.min! + 1 }, (_, k) => d.min! + k);
        const recScale = rec && "scale" in rec ? rec.scale : null;
        body = el(
          "div",
          { class: "dc-scale-wrap" },
          el(
            "div",
            { class: "dc-scale", role: "radiogroup", "aria-labelledby": "dc-q" },
            ...steps.map((v) =>
              el(
                "button",
                { type: "button", class: `dc-step${dr.scale === v ? " is-picked" : ""}${recScale === v ? " is-rec" : ""}`, role: "radio", "aria-checked": String(dr.scale === v), title: recScale === v ? "Recommended" : undefined, onclick: () => ((dr.scale = v), render()) },
                String(v),
              ),
            ),
          ),
          d.labels ? el("div", { class: "dc-scale-ends" }, el("span", {}, d.labels[0]), el("span", {}, d.labels[1])) : "",
        );
        break;
      }
      case "text":
        body = el("div");
        break;
    }

    const other = ownWords(d)
      ? el(d.kind === "text" ? "textarea" : "input", {
          class: `dc-other-input${d.kind === "text" ? " is-main" : ""}`,
          type: "text",
          rows: d.kind === "text" ? "2" : undefined,
          placeholder: d.kind === "text" ? "Your answer…" : "Or answer in your own words…",
          onfocus: (e: Event) => suggested(d) && (e.target as HTMLTextAreaElement).select(),
          "aria-label": d.kind === "text" ? "Your answer" : "Your own answer",
          oninput: (e: Event) => {
            const was = !!dr.other.trim();
            dr.other = (e.target as HTMLInputElement).value;
            // Typing your own answer sets the options aside, and clearing it brings them back.
            if (was !== !!dr.other.trim()) host.querySelector(".dc-card")?.classList.toggle("is-own", !!dr.other.trim());
            host.querySelector(".dc-suggested")?.remove();
            ready();
          },
        })
      : "";
    if (other) (other as HTMLInputElement).value = dr.other;
    const comment = el("textarea", {
      class: "dc-comment",
      rows: "1",
      placeholder: "Comment (optional, saved with the answer)",
      "aria-label": "Comment (optional)",
      oninput: (e: Event) => (dr.comment = (e.target as HTMLTextAreaElement).value),
    });
    comment.value = dr.comment;
    const context = d.context ? el("div", { class: "dc-context", html: renderMarkdown(d.context, d.note ?? "") }) : "";
    if (context) wireLinks(context);
    const media = d.media.length
      ? el("div", { class: "dc-media" }, ...d.media.map((m) => el("a", { href: assetUrl(m, d.note ?? undefined), target: "_blank", rel: "noopener noreferrer", class: "dc-media-item" }, pic(m, "dc-media-img", ""))))
      : "";
    const about = d.note ? el("button", { type: "button", class: "dc-about", onclick: () => hooks.open(d.note!) }, icon("file", 12), d.note.replace(/\.md$/, "")) : "";
    const enter = open ? "Enter to decide" : "Enter to change it";
    const hint =
      d.kind === "yes_no" ? `Y or N, ${enter}`
      : d.kind === "one" || d.kind === "compare" || d.kind === "many" ? `1–${Math.min(9, n)} to ${d.kind === "many" ? "tick" : "pick"}, ${enter}`
      : d.kind === "scale" && d.max! <= 9 ? `${d.min}–${d.max} to pick, ${enter}`
      : d.kind === "text" ? `O to type, ${enter}`
      : enter;
    // One answered already says so, and when; the same controls change it.
    const was = open
      ? ""
      : el(
          "p",
          { class: "dc-was" },
          icon("check", 12),
          d.status === "dismissed" ? "You chose not to decide" : el("span", {}, "Answered: ", el("strong", {}, d.answer ?? "")),
          ` · ${timeAgo(d.answered_at!)}`,
          d.journal ? el("button", { type: "button", class: "dc-about", onclick: () => hooks.open(d.journal!) }, "In today's note") : "",
        );
    host.replaceChildren(
      el(
        "section",
        { class: `qw dc-card is-standalone is-${d.kind}${open ? "" : " is-settled"}${ownWords(d) && dr.other.trim() && d.kind !== "text" ? " is-own" : ""}`, tabindex: "-1", "aria-labelledby": "dc-heading" },
        el("h2", { class: "td-title", id: "dc-heading" }, icon("flag", 14), "Decisions", el("span", { class: "dc-count" }, countText()), navOf()),
        el(
          "div",
          { class: "qw-body" },
          was,
          el("p", { class: "dc-q", id: "dc-q" }, d.question),
          el("div", { class: "dc-meta" }, authorAvatar({ source: d.asked_by, agent: d.agent }, 16), `Asked by ${d.agent ?? d.asked_by} · ${timeAgo(d.asked_at)}`, about),
          context,
          media,
          el("div", { class: "dc-answer" }, body, other, suggested(d) ? el("p", { class: "dc-note dc-suggested" }, "Suggested. Enter takes it; type to answer your own way.") : ""),
          comment,
          el(
            "div",
            { class: "dc-actions" },
            el("button", { type: "button", class: "qw-btn primary dc-decide", disabled: busy || !valueOf(d, dr), onclick: () => void decide() }, busy ? "Saving…" : open ? "Decide" : "Change answer"),
            open ? el("button", { type: "button", class: "qw-btn", title: "Leave it for later (S)", onclick: skip }, "Skip") : "",
            el("span", { class: "dc-hint" }, hint),
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
    if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented || !(t === page || host.contains(t))) return;
    if (!d) {
      // At the end: ← goes back to the answers.
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") e.preventDefault(), go(at + (e.key === "ArrowLeft" ? -1 : 1));
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && (!typingIn(t) || t.matches(".dc-other-input, .dc-comment"))) {
      if (t.matches("button")) return; // the button's own click
      e.preventDefault();
      void decide();
      return;
    }
    if (typingIn(t)) {
      if (e.key === "Escape") t.blur(), focusCard();
      return;
    }
    const dr = draft(d);
    const k = Number(e.key);
    const digit = /^[0-9]$/.test(e.key);
    if (d.kind === "yes_no" && /^[yn]$/i.test(e.key)) {
      const i = d.options.findIndex((o) => o.label[0].toLowerCase() === e.key.toLowerCase());
      if (i < 0) return;
      dr.pick = i;
    } else if (digit && (d.kind === "one" || d.kind === "compare") && k >= 1 && k <= Math.min(9, d.options.length)) {
      dr.pick = k - 1;
      dr.other = "";
    } else if (digit && d.kind === "many" && k >= 1 && k <= Math.min(9, d.options.length)) {
      dr.picks.has(k - 1) ? dr.picks.delete(k - 1) : dr.picks.add(k - 1);
      dr.other = "";
    } else if (digit && d.kind === "scale" && k >= d.min! && k <= d.max!) dr.scale = k;
    else if (e.key === "s") return e.preventDefault(), skip();
    else if (e.key === "ArrowRight") return e.preventDefault(), go(at + 1);
    else if (e.key === "ArrowLeft") return e.preventDefault(), go(at - 1);
    else if (e.key === "o" && ownWords(d)) return e.preventDefault(), host.querySelector<HTMLElement>(".dc-other-input")?.focus();
    else if (e.key === "c") return e.preventDefault(), host.querySelector<HTMLElement>(".dc-comment")?.focus();
    else return;
    e.preventDefault();
    render();
    focusCard();
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
