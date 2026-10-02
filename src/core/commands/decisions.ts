// Decisions: an agent asks its person to decide something; the Today page steps through the open
// ones, and each answer lands in that day's daily note (see core/decisions.ts).
import { DECISION_STATUSES, fmtDecision, fmtDecisions, KINDS, parseAnswer, type DecisionKind } from "../decisions.ts";
import { bool, command, list, num, pairs, str, UsageError } from "./types.ts";

const ID = { required: true, pos: 0, label: "id", describe: "The decision's ID, from list_decisions" } as const;

export const decisions = [
  command({
    cli: "decision ask",
    mcp: "ask_decision",
    route: "POST /decisions",
    title: "Ask for a decision",
    summary: "Ask the person to decide something (pick one or many, yes/no, per row, compare, rank, scale, words): it waits on their Today page",
    description:
      "Put a decision to the user instead of guessing or stopping: it waits on their Today page, where they step through open " +
      "decisions one at a time (they can always skip, comment, or answer in their own words). Each answer is written into that day's " +
      "daily note under ## Decisions. Ask one clear question per decision, put what they need to know in `context` (Markdown), and pick " +
      "its `kind`:\n" +
      "- one (the default with options): pick one of 2 to 9 short `options`.\n" +
      "- many: pick any of them; `min` and `max` bound how many.\n" +
      "- yes_no: Yes or No (no options needed).\n" +
      "- rows: one choice for each of `rows` (events to go to, PRs to merge), from the same `options` (Go, Maybe, Skip).\n" +
      "- compare: pick one of a few shown side by side; give each a picture in `images` and a line in `details`.\n" +
      "- rank: put the options in order, best first.\n" +
      "- scale: a number from `min` to `max` (1 to 5 by default), with `labels` for the two ends.\n" +
      "- text (the default without options): an answer in words.\n" +
      "`media` shows pictures with the question (https:// addresses or files in the vault). `recommended` is what you would answer, " +
      "written as an answer: an option's number or words; several for many and rank; one per row, or Row=Option, for rows; a number " +
      "for scale. Then carry on with other work and read the answer later with list_decisions (status settled, or ids). Withdraw it " +
      "with withdraw_decision if it stops mattering.",
    examples: [
      'commonink decision ask "Postgres or SQLite for the sync service?" --options Postgres,SQLite --recommended 2',
      'commonink decision ask "Which talks should I go to?" --kind rows --rows "Keynote,Rust at scale,Lunch panel" --options Go,Maybe,Skip',
      'commonink decision ask "Which logo?" --kind compare --options A,B --image A=assets/logo-a.png --image B=assets/logo-b.png',
      'commonink decision ask "How ready is the beta?" --kind scale --labels "Not at all,Ship it"',
      'commonink decision ask "Merge the docs PR?" --kind yes_no --note "CLI plan"',
    ],
    args: {
      question: str({ required: true, pos: "rest", missing: 'Say the question: commonink decision ask "Ship on Friday?" --kind yes_no', describe: "One clear question, one line" }),
      kind: str({ enum: KINDS, describe: "one, many, yes_no, rows, compare, rank, scale or text (default one with options, text without)" }),
      options: list({ label: "a,b", describe: "The choices, short (2 to 9); for rows, the choice for each row. On the CLI, separate with commas" }),
      details: pairs({ flag: "detail", label: "Option=line", describe: "A line more about an option, by its words" }),
      images: pairs({ flag: "image", label: "Option=picture", describe: "A picture of an option: an https:// address or a file in the vault" }),
      rows: list({ label: "a,b", describe: "For kind rows: the things to choose for (up to 30)" }),
      media: list({ label: "picture,…", describe: "Pictures to show with the question: https:// addresses or files in the vault" }),
      min: num({ describe: "many: the fewest picks; scale: its low end (default 1)" }),
      max: num({ describe: "many: the most picks; scale: its high end (default 5)" }),
      labels: list({ label: "low,high", describe: "scale: words for its two ends" }),
      recommended: list({ label: "answer", describe: "What you'd answer: an option's number or words (several for many and rank, one per row for rows), or a number for scale" }),
      context: str({ describe: "What they need to know to decide: tradeoffs, what you found (Markdown)" }),
      note: str({ describe: "A note this is about (path, name or ID): the picker links to it" }),
    },
    run: ({ vault, source }, a) => {
      const d = vault.askDecision({ ...a, kind: a.kind as DecisionKind | undefined }, source);
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
    summary: "Answer an open decision by its option's number or words (or your own), and record it in today's daily note; --change answers one again",
    description:
      "Answer an open decision and record it under ## Decisions in today's daily note. Write the answer as an option's number or words; " +
      "for many and rank, several separated by commas (rank: best first); for rows, one per row in order or Row=Option; for scale, a number. " +
      "Anything that isn't an option is an answer in your own words. With --change, a decision already answered or dismissed takes the new " +
      "answer, and its lines in the daily note are rewritten in place.",
    examples: ["commonink decision answer k3m9x2pq 1", "commonink decision answer k3m9x2pq Go,Skip,Maybe", 'commonink decision answer k3m9x2pq Postgres --comment "We already run it"', "commonink decision answer k3m9x2pq --dismiss", "commonink decision answer k3m9x2pq 2 --change"],
    args: {
      id: str(ID),
      answer: str({ pos: "rest", describe: "An option's number or words, or your own answer" }),
      comment: str({ describe: "Why, or anything to add" }),
      dismiss: bool({ describe: "You won't decide this: close it without an answer" }),
      change: bool({ describe: "Change the answer to one already answered or dismissed" }),
    },
    run: ({ vault, source }, a) => {
      const d = vault.decision(a.id);
      if (!a.dismiss && !a.answer?.trim()) {
        const opts = d.options.length ? `: ${d.options.map((o, i) => `${i + 1}. ${o.label}`).join(", ")}` : "";
        throw new UsageError(`Answer with an option's number or words${opts}, or --dismiss`);
      }
      let value;
      try {
        value = a.dismiss ? undefined : parseAnswer(d, a.answer!);
      } catch (e) {
        throw new UsageError((e as Error).message);
      }
      const r = vault.answerDecision(d.id, { value, comment: a.comment, dismiss: a.dismiss, change: a.change }, source);
      return { text: `${r.decision.status === "dismissed" ? "Dismissed" : `${a.change ? "Changed to" : "Decided"}: ${r.decision.answer}`}. Recorded in ${r.path}.`, data: r.decision };
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
