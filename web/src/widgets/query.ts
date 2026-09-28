//   ::query{folder=Projects limit=5 label="Active projects"}      ::query{tag=meeting sort=title}      ::query{q="mcp"}
// A live list of notes matching a search, folder or tag. Updates as notes (and agents) change.
import { api, type FeedItem } from "../api.ts";
import { el, escapeHtml, icon, timeAgo } from "../dom.ts";
import { onVaultChange } from "../events.ts";
import type { WidgetSpec } from "./core.ts";
import { formatQuery, toQuery } from "../../../src/core/query.ts";

const prevent = (e: Event) => e.preventDefault();

export const query: WidgetSpec = {
  name: "query",
  title: "Notes",
  icon: "feed",
  hint: "Live list of notes by search, folder or tag",
  keywords: "query list notes dashboard recent folder tag search",
  defaults: { limit: "6" },
  configAction: {
    label: "Save as smart folder",
    icon: "spark",
    run: (args, env, anchor) => env.saveSmartFolder(formatQuery(toQuery(args)), args.label ?? "", anchor),
  },
  fields: [
    { key: "label", label: "Label", type: "text", placeholder: "Active projects, Meetings…" },
    { key: "q", label: "Matching", type: "text", placeholder: "Search words (optional)" },
    { key: "folder", label: "Folder", type: "text", placeholder: "e.g. Projects" },
    { key: "tag", label: "Tag", type: "text", placeholder: "e.g. meeting" },
    { key: "limit", label: "Show", type: "text", placeholder: "6" },
  ],

  mount(body, env) {
    let alive = true;
    const list = el("div", { class: "qq-list" });
    const foot = el("div", { class: "qq-foot" });
    body.append(list, foot);
    const query = toQuery(env.args);
    const limit = Math.min(query.limit ?? 6, 50);

    async function load() {
      const page = await api.feed({ ...query, scope: "active", limit: limit + 1 }).catch(() => null);
      if (!alive || !page) return;
      const items = page.items.filter((i) => i.path !== env.note).slice(0, limit); // a dashboard shouldn't list itself
      const total = page.total - (page.items.some((i) => i.path === env.note) ? 1 : 0);
      list.replaceChildren(...(items.length ? items.map(row) : [el("div", { class: "qt-empty" }, "No notes match.")]));
      foot.textContent = total > items.length ? `${items.length} of ${total} notes` : `${total} note${total === 1 ? "" : "s"}`;
      env.remeasure();
    }

    function row(item: FeedItem) {
      const folder = item.path.split("/").slice(0, -1).join("/");
      const hit = item.lines[0];
      const preview = hit ? highlight(hit.text, env.args.q ?? "") : escapeHtml(firstLine(item.excerpt));
      const node = el(
        "button",
        { type: "button", class: "qq-row", onmousedown: prevent, onclick: () => env.open(item.path, hit?.line) },
        icon(item.kind === "html" ? "html" : "file", 14),
        el(
          "span",
          { class: "qq-main" },
          el("span", { class: "qq-title" }, item.title),
          preview ? el("span", { class: "qq-preview", html: preview }) : null,
        ),
        el("span", { class: "qq-meta" }, folder ? `${folder} · ` : "", el("span", { "data-ts": String(item.mtime) }, timeAgo(item.mtime))),
      );
      return node;
    }

    void load();
    const off = onVaultChange(load);
    return () => {
      alive = false;
      off();
    };
  },
};

function firstLine(md: string): string {
  const line = md.split("\n").find((l) => l.trim() && !/^(::|!\[|```|---|\|)/.test(l.trim())) ?? "";
  return line.replace(/^[#>\-*+\s]+|\[[ xX]\]\s*/g, "").replace(/[*_`~]|\[\[|\]\]/g, "").slice(0, 140);
}

function highlight(text: string, q: string): string {
  const terms = q.split(/\s+/).filter((t) => t.length > 1).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const safe = escapeHtml(text.replace(/^[#>\-*+\s]+/, ""));
  return terms.length ? safe.replace(new RegExp(`(${terms.join("|")})`, "gi"), "<mark>$1</mark>") : safe;
}
