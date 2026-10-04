// Query syntax: every operator and field a note query takes, each with an example to try. Drawn
// from SYNTAX in src/core/queryGrammar.ts, so a field added there shows here (and in
// `commonink help query`) without touching this page.
import { el } from "./dom.ts";
import { pageHeader } from "./pageHeader.ts";
import { SYNTAX } from "../../src/core/queryGrammar.ts";

interface Hooks {
  /** Open Notes filtered by this query. */
  tryQuery(q: string): void;
}

const TOGETHER = '(tag=work OR tag=home) -folder=Archive "launch plan" sort=created';

export class QueryHelpPage {
  readonly root: HTMLElement;

  constructor(
    root: HTMLElement,
    private hooks: Hooks,
  ) {
    this.root = root;
    const example = (q: string) =>
      el("button", { type: "button", class: "qh-try", title: "Show the notes this finds", onclick: () => this.hooks.tryQuery(q) }, el("code", {}, q));
    const groups = [...new Set(SYNTAX.map((s) => s.group))];
    root.append(
      el(
        "div",
        { class: "page qh-page" },
        pageHeader({
          title: "Query syntax",
          sub: "One way to ask for notes, everywhere: the Notes filter, smart folders, ::view lists and commonink list --query. Click an example to try it.",
        }),
        ...groups.map((g) =>
          el(
            "section",
            { class: "qh-group" },
            el("h2", {}, g),
            el(
              "div",
              { class: "qh-list", role: "list" },
              ...SYNTAX.filter((s) => s.group === g).map((s) =>
                el("div", { class: "qh-row", role: "listitem" }, el("code", { class: "qh-syntax" }, s.syntax), el("span", { class: "qh-about" }, s.about), example(s.example)),
              ),
            ),
          ),
        ),
        el("section", { class: "qh-group" }, el("h2", {}, "All together"), el("p", { class: "qh-about" }, "Work or home notes about the launch plan, outside Archive, newest first:"), example(TOGETHER)),
      ),
    );
  }

  get visible() {
    return !this.root.hidden;
  }

  show() {
    this.root.hidden = false;
    this.root.focus({ preventScroll: true });
  }
}
