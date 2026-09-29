// Who made a change: a person, or an agent working for one. The change log keeps both apart
// (`person`, `agent`) so History can tell AI from people; `source` stays as the display text older
// clients read. No Node imports: the web app uses this too.

export interface Actor {
  /** Who the change was made by or for: a person's name online, "you" locally. */
  person: string | null;
  /** The agent that made it for them ("Claude", "Claude Code"), or null for a person's own edit. */
  agent: string | null;
}

/** Which changes a history shows: everyone's, people's own, any agent's, or one agent's. */
export type AuthorFilter = "people" | "agents" | { agent: string };

// The core's write methods take a `source` string. A person's is just their name; an agent's
// carries both halves, split by a character no name can contain.
const SEP = "\u001f";

/** The `source` for an agent's writes on a person's behalf. */
export const agentSource = (agent: string, person: string) => `${agent.replaceAll(SEP, "")}${SEP}${person.replaceAll(SEP, "")}`;

/** A write's `source` as the change log records it: who, and the text older clients show. */
export function actorOf(source: string): Actor & { source: string } {
  const at = source.indexOf(SEP);
  if (at < 0) return { person: source === "external" ? null : source, agent: null, source };
  const [agent, person] = [source.slice(0, at), source.slice(at + 1)];
  return { person, agent, source: `${agent} (via ${person})` };
}

/**
 * Who a change from before the log kept actors was by, from its `source` alone. "<Agent> (via
 * <Person>)" is an agent online. Locally, the app wrote "you", the CLI "cli" when no one said who,
 * and the file watcher "external"; anything else came from an agent (the stdio MCP server's
 * client name, "mcp" when it had none, or the CLI's --as).
 */
export function legacyActor(source: string, local: boolean): Actor {
  const via = source.match(/^(.+) \(via (.+)\)$/);
  if (via) return { agent: via[1], person: via[2] };
  if (source === "external") return { person: null, agent: null };
  if (!local) return { person: source, agent: null };
  return source === "you" || source === "cli" ? { person: "you", agent: null } : { person: "you", agent: source };
}

/** The SQL condition for a filter on the change log, with its parameters. */
export function authorWhere(by: AuthorFilter | undefined): [string, unknown[]] {
  if (!by) return ["1", []];
  if (by === "people") return ["agent IS NULL", []];
  if (by === "agents") return ["agent IS NOT NULL", []];
  return ["agent = ?", [by.agent]];
}

/** A filter from text (a query parameter, a CLI flag): "people", "ai" or "agents", or an agent's name. */
export function parseAuthorFilter(s: string | null | undefined): AuthorFilter | undefined {
  const t = (s ?? "").trim();
  if (!t || t === "everyone" || t === "all") return undefined;
  if (t === "people") return "people";
  if (t === "ai" || t === "agents") return "agents";
  return { agent: t.replace(/^agent:/, "") };
}

/** How a change's author reads: "Claude for Audrow" for an agent, the person's name otherwise. */
export function authorLabel(c: { source: string; person?: string | null; agent?: string | null }, self = "you"): string {
  if (!c.agent) return c.source;
  const person = !c.person || c.person === self ? "you" : c.person.split(" ")[0];
  return `${c.agent} for ${person}`;
}
