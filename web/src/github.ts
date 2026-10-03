// GitHub issue and pull request cards (src/core/github.ts reads them, through /api/unfurl): a
// github.com issue or PR link alone on its line shows its title, state, labels and activity. The
// note keeps the plain URL; where GitHub won't answer, the link stays a link (or a plain link card).
import { el, icon, timeAgo } from "./dom.ts";
import { githubRef, type GithubCard } from "../../src/core/github.ts";
import type { Unfurl } from "../../src/core/unfurl.ts";

const STATE_LABEL: Record<GithubCard["state"], string> = { open: "Open", closed: "Closed", merged: "Merged", draft: "Draft" };

function stateIcon(card: GithubCard): string {
  if (card.kind === "pull") return { open: "gh-pull", draft: "gh-pull-draft", merged: "gh-merged", closed: "gh-pull-closed" }[card.state];
  if (card.state !== "closed") return "gh-issue";
  return card.reason === "not_planned" ? "gh-issue-skipped" : "gh-issue-done";
}

/** The card's look: `is-open`, `is-merged`… (a closed issue that's done reads purple, like a merge). */
function stateClass(card: GithubCard): string {
  if (card.kind === "issue" && card.state === "closed") return card.reason === "not_planned" ? "is-skipped" : "is-done";
  return `is-${card.state}`;
}

/** The inside of a GitHub card: state icon, title and number, then repo, state, author, comments and labels. */
export function githubCardBody(card: GithubCard): HTMLElement[] {
  const state = card.kind === "issue" && card.state === "closed" && card.reason === "not_planned" ? "Closed as not planned" : STATE_LABEL[card.state];
  const updated = Date.parse(card.updatedAt);
  return [
    el("span", { class: `gh-state ${stateClass(card)}`, title: `${card.kind === "pull" ? "Pull request" : "Issue"} · ${state}` }, icon(stateIcon(card), 16)),
    el(
      "div",
      { class: "gh-main" },
      el("div", { class: "gh-title" }, el("span", { class: "gh-title-text" }, card.title), el("span", { class: "gh-num" }, `#${card.number}`)),
      el(
        "div",
        { class: "gh-meta" },
        el("span", { class: "gh-repo" }, card.repo),
        el("span", { class: `gh-pill ${stateClass(card)}` }, state),
        card.author ? el("span", {}, `by ${card.author}`) : null,
        card.comments ? el("span", { class: "gh-comments", title: `${card.comments} comment${card.comments === 1 ? "" : "s"}` }, icon("comment", 12), String(card.comments)) : null,
        updated > 0 ? el("span", { title: new Date(updated).toLocaleString() }, `updated ${timeAgo(updated)}`) : null,
      ),
      card.labels.length
        ? el("div", { class: "gh-labels" }, ...card.labels.map((l) => el("span", { class: "gh-label", style: l.color ? { "--label": `#${l.color}` } : {} }, l.name)))
        : null,
    ),
  ];
}

const seen = new Map<string, { at: number; value: Promise<Unfurl | null> }>();

/** /api/unfurl for a link, kept a few minutes so a page of cards asks once each. */
export function fetchUnfurl(url: string): Promise<Unfurl | null> {
  const hit = seen.get(url);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.value;
  const value = fetch(`/api/unfurl?url=${encodeURIComponent(url)}`)
    .then((r) => (r.ok ? (r.json() as Promise<Unfurl>) : null))
    .catch(() => null)
    .then((meta) => (meta || seen.delete(url), meta)); // a failure is asked again next time
  seen.set(url, { at: Date.now(), value });
  return value;
}

/**
 * In rendered markdown, a paragraph that's only a GitHub issue or PR link becomes its card once
 * GitHub answers. The card is a link to the same page, so clicking it does what the link did.
 */
export function hydrateGithubLinks(root: HTMLElement, settle?: () => void) {
  for (const a of root.querySelectorAll<HTMLAnchorElement>("p > a[href]:only-child")) {
    const p = a.parentElement!;
    const href = a.getAttribute("href")!;
    if (p.textContent!.trim() !== a.textContent!.trim() || a.textContent!.trim() !== href || !githubRef(href)) continue;
    void fetchUnfurl(href).then((meta) => {
      if (!meta?.github || !p.parentNode) return;
      p.replaceWith(el("a", { class: "gh-card", href, target: "_blank", rel: "noopener noreferrer", title: href }, ...githubCardBody(meta.github)));
      settle?.();
    });
  }
}
