// Online-only: the agents you've connected over MCP (Claude, Cursor…), which workspace each works
// in, when it last did something, what it changed lately, and a button to disconnect it.
import { api, type ConnectedAgent } from "./api.ts";
import { el, icon, timeAgo } from "./dom.ts";

export async function showAgents() {
  document.querySelector("#agents-page")?.remove();
  const list = el("div", { class: "agents-list" }, el("p", { class: "agents-empty" }, "Loading…"));
  const close = () => (page.remove(), document.removeEventListener("keydown", onKey));
  const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
  const page = el(
    "div",
    { id: "agents-page", onmousedown: (e: Event) => e.target === page && close() },
    el(
      "div",
      { class: "agents-box", role: "dialog", "aria-label": "Connected agents" },
      el("div", { class: "agents-head" }, icon("link", 16), el("h2", {}, "Connected agents"), el("button", { class: "icon-btn small", type: "button", title: "Close", onclick: close }, icon("close", 15))),
      el(
        "p",
        { class: "agents-how" },
        "To connect one, add ",
        el("code", {}, `${location.origin}/mcp`),
        " as a custom connector (MCP server) in Claude, Cursor or any MCP client. It signs you in here and asks which workspace to use.",
      ),
      list,
    ),
  );
  document.addEventListener("keydown", onKey);
  document.body.append(page);

  const render = async () => {
    const agents = await api.agents();
    if (!agents.length) return list.replaceChildren(el("p", { class: "agents-empty" }, "No agents connected."));
    list.replaceChildren(...agents.map((a) => row(a, render)));
  };
  await render().catch((e) => list.replaceChildren(el("p", { class: "agents-empty" }, `Couldn't load your agents: ${(e as Error).message}`)));
}

function row(a: ConnectedAgent, refresh: () => Promise<void>) {
  const changes = el("ul", { class: "agents-changes" });
  const revoke = el("button", {
    class: "ghost-btn agents-revoke",
    type: "button",
    onclick: async () => {
      if (!confirm(`Disconnect ${a.client}? It stops working right away. Its past changes stay.`)) return;
      await api.revokeAgent(a.id);
      await refresh();
    },
  }, "Revoke");
  const where = a.workspace ? `${a.workspace.name} · as ${a.workspace.role}` : "A workspace you've left";
  const used = a.usedAt ? `last used ${timeAgo(a.usedAt)}` : "not used yet";
  if (a.workspace) {
    api.changesIn(a.workspace.id).then((all) => {
      const mine = all.filter((c) => c.agent === a.client && c.person === a.person).slice(0, 5);
      changes.replaceChildren(
        ...(mine.length ? mine.map((c) => el("li", {}, el("span", {}, `${c.op} ${c.path}`), el("span", { class: "agents-when" }, timeAgo(c.ts)))) : [el("li", { class: "agents-none" }, "No recent changes.")]),
      );
    }, () => {});
  }
  return el(
    "div",
    { class: "agents-row" },
    el("div", { class: "agents-main" }, el("strong", {}, a.client), el("span", { class: "agents-meta" }, `${where} · connected ${timeAgo(a.connectedAt)} · ${used}`), changes),
    revoke,
  );
}
