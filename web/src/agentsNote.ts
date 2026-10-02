// AGENTS.md is a real note (agents and the MCP server read it), labelled so nobody takes it for one of their own.
import { isAgentsNote } from "../../src/core/noteRoles.ts";
import { el, icon } from "./dom.ts";

export const AGENTS_BLURB = "Agents read this note for your workspace's conventions. Edit it to change how they work.";

export { isAgentsNote };

export const agentsBadge = () => el("span", { class: "fc-badge is-agents", title: AGENTS_BLURB }, icon("bot", 11), "Agent instructions");
