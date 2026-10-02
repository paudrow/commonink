// Connecting an agent. Online: the agents you've connected over MCP (Claude, Cursor…), which workspace
// each works in, when it last did something, what it changed lately, and a button to disconnect it.
// Locally: the command or JSON that connects one to this vault.
import { api, type ConnectedAgent } from "./api.ts";
import { localSteps } from "./connectAgent.ts";
import { el, icon, timeAgo } from "./dom.ts";
import { confirmAction, trapKeys } from "./modal.ts";

export async function showAgents() {
  document.querySelector("#agents-page")?.remove();
  const back = document.activeElement as HTMLElement | null;
  const info = await api.info().catch(() => null);
  const local = info?.mode === "local" ? info : null;
  const list = el("div", { class: "agents-list" }, el("p", { class: "agents-empty" }, "Loading…"));
  const close = () => {
    page.remove();
    if (back?.isConnected) back.focus({ preventScroll: true });
  };
  const how = local
    ? el("div", { class: "agents-how qw-guide-how" }, el("p", {}, "Agents on this computer read and edit this vault over MCP. Their edits show up here live, with their names on them."), ...localSteps(local))
    : el(
        "p",
        { class: "agents-how" },
        "To connect one, add ",
        el("code", {}, `${location.origin}/mcp`),
        " as a custom connector (MCP server) in Claude, Cursor or any MCP client. It signs you in here and asks which workspace to use.",
      );
  const box = el(
    "div",
    { class: "agents-box", role: "dialog", "aria-modal": "true", "aria-labelledby": "agents-title", tabindex: "-1" },
    el(
      "div",
      { class: "agents-head" },
      icon("link", 16),
      el("h2", { id: "agents-title" }, local ? "Connect an agent" : "Connected agents"),
      el("button", { class: "icon-btn small", type: "button", "aria-label": "Close", title: "Close (Esc)", onclick: close }, icon("close", 15)),
    ),
    how,
    local ? null : list,
  );
  const page = el("div", { id: "agents-page", onmousedown: (e: Event) => e.target === page && close() }, box);
  trapKeys(page, box, close);
  document.body.append(page);
  box.focus();
  if (local) return;

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
      if (!(await confirmAction({ title: `Disconnect ${a.client}?`, body: "It stops working right away. Its past changes stay.", action: "Disconnect", danger: true }))) return;
      await api.revokeAgent(a.id);
      await refresh();
    },
  }, "Revoke");
  const where = a.allWorkspaces ? "All your workspaces" : a.workspace ? `${a.workspace.name} · as ${a.workspace.role}` : "A workspace you've left";
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
