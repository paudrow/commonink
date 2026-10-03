// The Agents dialog. Online: the agents you've connected over MCP (Claude, Cursor…), which workspace
// each works in, when it last did something, what it changed lately, and a button to disconnect it.
// Locally: the command or JSON that connects one to this workspace.
import { api, type ConnectedAgent } from "./api.ts";
import { localSteps } from "./connectAgent.ts";
import { el, timeAgo } from "./dom.ts";
import { confirmAction, openModal } from "./modal.ts";

export async function showAgents() {
  const info = await api.info().catch(() => null);
  const local = info?.mode === "local" ? info : null;
  const list = el("div", { class: "agents-list" }, el("p", { class: "agents-empty" }, "Loading…"));
  const how = local
    ? el("div", { class: "agents-how qw-guide-how" }, el("p", {}, "Agents on this computer read and edit this workspace over MCP. Their edits show up here live, with their names on them."), ...localSteps(local))
    : el(
        "p",
        { class: "agents-how" },
        "To connect one, add ",
        el("code", {}, `${location.origin}/mcp`),
        " as a custom connector (MCP server) in Claude, Cursor or any MCP client. It signs you in here and asks which workspace to use.",
      );
  openModal({
    title: "Agents",
    icon: "link",
    content: [how, local ? null : list],
    id: "agents-page",
    pageClass: "",
    boxClass: "agents-box",
    headClass: "agents-head",
    titleId: "agents-title",
  });
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
