// Shared with me: the notes other workspaces share with you, grouped by workspace. Each opens on its
// own page (/shared/<workspace>/<note>), outside this app's sidebar.
import type { SharedNote } from "./api.ts";
import { el, icon } from "./dom.ts";
import { emptyState } from "./emptyState.ts";

export type SharedGroup = { workspace: { id: string; name: string }; notes: SharedNote[] };

/** The page's header, and a body to fill in once the list has loaded (see `renderSharedList`). */
export function sharedPage(): { page: HTMLElement; body: HTMLElement } {
  const body = el("div", { class: "sh-groups" });
  const page = el(
    "div",
    { class: "page" },
    el("header", { class: "page-head" }, el("h1", {}, "Shared with me"), el("p", { class: "page-sub" }, "Notes people outside your workspaces have shared with you. Each opens on its own page.")),
    body,
  );
  return { page, body };
}

/** The list, a workspace at a time; `null` when it couldn't load, with `retry` to try again. */
export function renderSharedList(body: HTMLElement, groups: SharedGroup[] | null, retry: () => void) {
  body.replaceChildren(
    ...(groups === null
      ? [emptyState({ icon: "share", title: "Couldn't load what's shared with you", text: ["Check your connection and try again."], action: { label: "Try again", run: retry } })]
      : groups.length
        ? groups.map((g) =>
            el(
              "section",
              { class: "sh-group" },
              el("h2", {}, g.workspace.name, el("span", { class: "n" }, String(g.notes.length))),
              el("div", { class: "sh-list", role: "list" }, ...g.notes.map((n) => row(g.workspace.id, n))),
            ),
          )
        : [
            emptyState({
              icon: "share",
              title: "Nothing shared with you yet",
              text: ["When someone shares a note with your email, or you keep a shared link, it shows up here."],
            }),
          ]),
  );
}

function row(workspace: string, n: SharedNote): HTMLElement {
  return el(
    "a",
    { class: "sh-row", role: "listitem", href: `/shared/${workspace}/${n.id}` },
    icon(n.kind === "asset" ? "image" : n.kind === "html" ? "html" : "file", 16),
    el("span", { class: "sh-main" }, el("span", { class: "sh-title" }, n.title), el("span", { class: "sh-path" }, n.path)),
    el("span", { class: "sh-role" }, n.role === "editor" ? "Can edit" : "View only"),
  );
}
