// Decisions: an agent asks its person to decide something; the Today page steps through the open
// ones, and each answer lands in that day's daily note (see core/decisions.ts).
import { DECISION_STATUSES, fmtDecision, fmtDecisions, optionOf } from "../decisions.ts";
import { bool, command, list, num, str, UsageError } from "./types.ts";

const ID = { required: true, pos: 0, label: "id", describe: "The decision's ID, from list_decisions" } as const;

export const decisions = [
  command({
    cli: "decision ask",
    mcp: "ask_decision",
    route: "POST /decisions",
    title: "Ask for a decision",
    summary: "Ask the person to decide something: it waits on their Today page, and the answer goes in that day's daily note",
    description:
      "Put a decision to the user instead of guessing or stopping: it waits on their Today page, where they step through open " +
      "decisions one at a time, pick an option (or answer in their own words) and can add why. Each answer is written into that day's " +
      "daily note under ## Decisions. Ask one clear question per decision; give 2 to 9 short options (or none, for a free answer), mark " +
      "the one you'd pick with `recommended`, and put what they need to know in `context` (Markdown). Then carry on with other work and " +
      "read the answer later with list_decisions (status answered, or ids). Withdraw it with withdraw_decision if it stops mattering.",
    examples: [
      'commonink decision ask "Postgres or SQLite for the sync service?" --options Postgres,SQLite --recommended 2',
      'commonink decision ask "Which name for the CLI?" --options ink,commonink --context "Both are free on npm" --note "CLI plan"',
    ],
    args: {
      question: str({ required: true, pos: "rest", missing: 'Say the question: commonink decision ask "Ship on Friday?" --options Yes,No', describe: "One clear question, one line" }),
      options: list({ label: "a,b", describe: "The choices, short (2 to 9); leave out for an answer in their own words. On the CLI, separate with commas" }),
      recommended: num({ min: 1, max: 9, label: "n", describe: "The option you'd pick, by number (1 = the first)" }),
      context: str({ describe: "What they need to know to decide: tradeoffs, what you found (Markdown)" }),
      note: str({ describe: "A note this is about (path, name or ID): the picker links to it" }),
    },
    run: ({ vault, source }, a) => {
      const d = vault.askDecision({ question: a.question, options: a.options, context: a.context, note: a.note, recommended: a.recommended === undefined ? undefined : a.recommended - 1 }, source);
      return { text: `Asked [${d.id}]: it's waiting on the Today page. Read the answer later with list_decisions.\n\n${fmtDecision(d)}`, data: d };
    },
  }),
  command({
    cli: "decisions",
    mcp: "list_decisions",
    route: "GET /decisions",
    title: "List decisions",
    summary: "Decisions waiting on the person (the default), or answered ones with their answers",
    description:
      "Decisions put to the user with ask_decision. By default the open ones, oldest first; `status: \"settled\"` lists answered, " +
      "dismissed and withdrawn ones newest first, with the answer, any comment, and the daily note it was recorded in. Pass `ids` to " +
      "check on the ones you asked. A dismissed decision means they chose not to decide: don't ask it again as is.",
    examples: ["commonink decisions", "commonink decisions --status settled", "commonink decisions --ids k3m9x2pq --json"],
    readOnly: true,
    args: {
      status: str({ enum: [...DECISION_STATUSES, "settled", "all"], describe: "open (the default), answered, dismissed, withdrawn, settled (any but open) or all" }),
      ids: list({ label: "id,…", describe: "Just these decisions, whatever their status" }),
      limit: num({ min: 1, max: 500, describe: "At most this many (default 100)" }),
    },
    run: ({ vault }, a) => {
      const list = vault.decisions({ status: a.status as never, ids: a.ids, limit: a.limit });
      return { text: fmtDecisions(list), data: list };
    },
  }),
  command({
    cli: "decision answer",
    mcp: { none: "answering is the person's: an agent asks with ask_decision and reads the answer with list_decisions" },
    route: "POST /decisions/answer",
    title: "Answer a decision",
    summary: "Answer an open decision by its option's number or words (or your own), and record it in today's daily note",
    examples: ["commonink decision answer k3m9x2pq 1", 'commonink decision answer k3m9x2pq Postgres --comment "We already run it"', "commonink decision answer k3m9x2pq --dismiss"],
    args: {
      id: str(ID),
      answer: str({ pos: "rest", describe: "An option's number or words, or your own answer" }),
      comment: str({ describe: "Why, or anything to add" }),
      dismiss: bool({ describe: "You won't decide this: close it without an answer" }),
    },
    run: ({ vault, source }, a) => {
      const d = vault.decision(a.id);
      if (!a.dismiss && !a.answer?.trim()) throw new UsageError(`Answer with an option's number or words${d.options.length ? `: ${d.options.map((o, i) => `${i + 1}. ${o}`).join(", ")}` : ""}, or --dismiss`);
      const choice = a.dismiss ? undefined : (optionOf(d.options, a.answer!) ?? undefined);
      const r = vault.answerDecision(d.id, { choice, text: choice === undefined ? a.answer : undefined, comment: a.comment, dismiss: a.dismiss }, source);
      return { text: `${r.decision.status === "dismissed" ? "Dismissed" : `Decided: ${r.decision.answer}`}. Recorded in ${r.path}.`, data: r.decision };
    },
  }),
  command({
    cli: "decision withdraw",
    mcp: "withdraw_decision",
    route: "POST /decisions/withdraw",
    title: "Withdraw a decision",
    summary: "Take back an open decision that no longer matters, so it leaves the Today page",
    examples: ["commonink decision withdraw k3m9x2pq"],
    args: { id: str(ID) },
    run: ({ vault }, a) => {
      const d = vault.withdrawDecision(a.id);
      return { text: `Withdrew [${d.id}] ${d.question}`, data: d };
    },
  }),
];
