// How to connect an agent to a local vault: the Claude Code command and the JSON other MCP clients
// take. The Getting started guide card, the Connect an agent dialog and Settings all show it.
import { el } from "./dom.ts";
import { button, setButton } from "./widgets/core.ts";

/** `s` quoted for a shell, if it needs it. */
const sh = (s: string) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replaceAll("'", `'\\''`)}'`);

function copyable(code: string, block = false): HTMLElement {
  const copy = button("Copy", "copy", () => void navigator.clipboard.writeText(code).then(() => setButton(copy, "Copied", "check")));
  copy.setAttribute("aria-label", `Copy ${block ? "the JSON" : "the command"}`);
  return el("div", { class: `qw-guide-code${block ? " is-block" : ""}` }, el(block ? "pre" : "code", {}, code), copy);
}

export function localSteps(info: { vault?: string; projectRoot?: string }): HTMLElement[] {
  const bin = `${info.projectRoot}/bin/quire`;
  // The MCP server opens the default vault unless it's told which: say so when this isn't that one.
  const vault = info.vault && info.vault !== `${info.projectRoot}/vault` ? info.vault : null;
  const json = JSON.stringify({ mcpServers: { quire: { command: bin, args: ["mcp"], ...(vault ? { env: { QUIRE_VAULT: vault } } : {}) } } }, null, 2);
  return [
    el("p", { class: "qw-sub" }, "Claude Code: run this in a terminal."),
    copyable(`claude mcp add quire ${vault ? `-e QUIRE_VAULT=${sh(vault)} ` : ""}-- ${sh(bin)} mcp`),
    el("details", {}, el("summary", {}, "Claude Desktop, Cursor and other MCP clients"), el("p", { class: "qw-sub" }, "Add this server to the app's MCP settings (claude_desktop_config.json, .cursor/mcp.json…), then restart it."), copyable(json, true)),
  ];
}
