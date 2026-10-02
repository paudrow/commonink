// Decisions: a question an agent puts to its person ("Postgres or SQLite for the sync service?"),
// with the choices it sees. Open ones wait on the Today page, one at a time; each answer is written
// into that day's daily note under `## Decisions`, so the day's notes say what was decided and why,
// and the agent reads the answer back (list_decisions). No Node imports: the web app uses this too.

export const DECISIONS = "Decisions";
export const QUESTION_MAX = 300;
export const CONTEXT_MAX = 4000;
export const OPTION_MAX = 200;
export const OPTIONS_MAX = 9; // one key each, 1 to 9, in the picker
export const COMMENT_MAX = 2000;
/** Open at once, so an agent in a loop can't bury the Today page. */
export const OPEN_MAX = 100;

export type DecisionStatus = "open" | "answered" | "dismissed" | "withdrawn";
export const DECISION_STATUSES = ["open", "answered", "dismissed", "withdrawn"] as const satisfies readonly DecisionStatus[];

export interface Decision {
  id: string;
  question: string;
  /** What the agent knows that bears on it, as Markdown. */
  context: string | null;
  /** The choices it sees, in its order of preference or not. Any answer may also be in the person's own words. */
  options: string[];
  /** The option it would pick (0-based), if it has a view. */
  recommended: number | null;
  /** A note it's about, by path. */
  note: string | null;
  status: DecisionStatus;
  asked_at: number;
  /** Who asked: "Claude Code (via Audrow)", or a person's name. */
  asked_by: string;
  agent: string | null;
  /** The answer: an option's words, or the person's own. */
  answer: string | null;
  /** Which option was picked (0-based); null for an answer in their own words. */
  choice: number | null;
  /** Why, or anything else they said with it. */
  comment: string | null;
  answered_at: number | null;
  answered_by: string | null;
  /** The daily note the answer was written into. */
  journal: string | null;
}

/** One line of text: no line breaks, runs of spaces made one. */
export const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/** Who asked, as the daily note says it: "Claude Code", or the person's name. */
const asker = (d: Pick<Decision, "agent" | "asked_by">) => d.agent ?? d.asked_by;

/**
 * The lines a settled decision adds to the daily note's Decisions section: the question and what
 * was decided, then the comment as an indented line under it.
 *
 *     - Postgres or SQLite for the sync service? **Postgres** (asked by Claude Code, about [[Sync]])
 *       We already run Postgres for billing.
 */
export function journalLines(d: Decision, linkTo?: (path: string) => string): string[] {
  const outcome = d.status === "dismissed" ? "_Not deciding_" : `**${oneLine(d.answer ?? "").replace(/\*/g, "\\*")}**`;
  const about = d.note ? `, about ${linkTo ? linkTo(d.note) : `[[${d.note.replace(/\.md$/, "")}]]`}` : "";
  const lines = [`- ${oneLine(d.question)} ${outcome} (asked by ${asker(d)}${about})`];
  for (const l of (d.comment ?? "").split(/\r?\n/)) if (l.trim()) lines.push(`  ${l.trimEnd()}`);
  return lines;
}

/** Decisions as text for people and agents: open ones with their choices, settled ones with the answer. */
export function fmtDecisions(list: Decision[]): string {
  if (!list.length) return "No decisions here. Ask one with ask_decision (commonink decision ask).";
  return list.map(fmtDecision).join("\n\n");
}

export function fmtDecision(d: Decision): string {
  const head = `[${d.id}] ${d.question}`;
  const lines = [head];
  if (d.status === "open") {
    d.options.forEach((o, i) => lines.push(`  ${i + 1}. ${o}${d.recommended === i ? " (recommended)" : ""}`));
    lines.push(`  Open, asked by ${d.asked_by} ${new Date(d.asked_at).toISOString().slice(0, 16).replace("T", " ")} UTC`);
  } else if (d.status === "answered") {
    lines.push(`  Answer: ${d.answer}${d.choice === null ? " (in their own words)" : ` (option ${d.choice + 1})`}`);
    if (d.comment) lines.push(`  Comment: ${d.comment}`);
    lines.push(`  By ${d.answered_by}${d.journal ? `, recorded in ${d.journal}` : ""}`);
  } else {
    lines.push(d.status === "dismissed" ? `  Dismissed by ${d.answered_by}: they're not deciding this${d.comment ? ` (${d.comment})` : ""}` : "  Withdrawn by whoever asked");
  }
  if (d.note) lines.push(`  About: ${d.note}`);
  return lines.join("\n");
}

/**
 * Which option an answer typed as text means: its number ("2"), or its words in any case. null when
 * it's neither, so it stands as an answer in the person's own words.
 */
export function optionOf(options: string[], text: string): number | null {
  const t = text.trim();
  if (/^\d+$/.test(t)) {
    const n = Number(t);
    return n >= 1 && n <= options.length ? n - 1 : null;
  }
  const i = options.findIndex((o) => o.trim().toLowerCase() === t.toLowerCase());
  return i >= 0 ? i : null;
}
