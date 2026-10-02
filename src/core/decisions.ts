// Decisions: a question an agent puts to its person ("Postgres or SQLite for the sync service?"),
// in one of a few shapes (pick one, pick many, yes or no, a choice for each row, compare pictures,
// put in order, a scale, or words). Open ones wait on the Today page, one at a time; each answer is
// written into that day's daily note under `## Decisions`, so the day's notes say what was decided
// and why, and the agent reads the answer back (list_decisions). No Node imports: the web app uses
// this too.

export const DECISIONS = "Decisions";
export const QUESTION_MAX = 300;
export const CONTEXT_MAX = 4000;
export const OPTION_MAX = 200;
export const DETAIL_MAX = 500;
export const OPTIONS_MAX = 9; // one key each, 1 to 9, in the picker
export const ROWS_MAX = 30;
export const MEDIA_MAX = 6;
export const COMMENT_MAX = 2000;
/** Open at once, so an agent in a loop can't bury the Today page. */
export const OPEN_MAX = 100;

/**
 * The shapes a question can take:
 * - one: pick one option (the default with options)
 * - many: pick any number of them (`min`, `max`)
 * - yes_no: Yes or No (options default to those two)
 * - rows: one choice for each row, from the same options (events: Go / Maybe / Skip)
 * - compare: pick one of a few, side by side, each with its picture and detail
 * - rank: put the options in order, best first
 * - scale: a number from `min` to `max` (1 to 5 by default), with words for each end
 * - text: an answer in words (the default without options)
 */
export const KINDS = ["one", "many", "yes_no", "rows", "compare", "rank", "scale", "text"] as const;
export type DecisionKind = (typeof KINDS)[number];

export type DecisionStatus = "open" | "answered" | "dismissed" | "withdrawn";
export const DECISION_STATUSES = ["open", "answered", "dismissed", "withdrawn"] as const satisfies readonly DecisionStatus[];

export interface DecisionOption {
  label: string;
  /** A line more about it. */
  detail?: string;
  /** A picture of it: an https:// address or a file in the vault. */
  image?: string;
}

/** An answer, or what the agent would answer, in the question's shape. `text` is in the person's own words, for any kind. */
export type DecisionValue =
  | { choice: number }
  | { choices: number[] }
  | { rows: Array<number | null> }
  | { order: number[] }
  | { scale: number }
  | { text: string };

export interface Decision {
  id: string;
  kind: DecisionKind;
  question: string;
  /** What the agent knows that bears on it, as Markdown. */
  context: string | null;
  /** The choices (the columns, for rows). */
  options: DecisionOption[];
  /** For rows: what each row is (an event, a file). */
  rows: string[];
  /** Pictures for the question itself: https:// addresses or files in the vault. */
  media: string[];
  /** many: the fewest and most picks; scale: its ends. */
  min: number | null;
  max: number | null;
  /** scale: words for its low and high ends. */
  labels: [string, string] | null;
  /** What the agent would answer, if it has a view. */
  recommended: DecisionValue | null;
  /** A note it's about, by path. */
  note: string | null;
  status: DecisionStatus;
  asked_at: number;
  /** Who asked: "Claude Code (via Audrow)", or a person's name. */
  asked_by: string;
  agent: string | null;
  /** The answer, as words: "SQLite", "Talk A: Go; Talk B: Skip". */
  answer: string | null;
  /** The answer, as data. */
  value: DecisionValue | null;
  /** Why, or anything else they said with it. */
  comment: string | null;
  answered_at: number | null;
  answered_by: string | null;
  /** The daily note the answer was written into. */
  journal: string | null;
}

/** What an agent asks: the question, its shape, and what goes with it. */
export interface AskInput {
  question: string;
  kind?: DecisionKind;
  options?: Array<string | DecisionOption>;
  /** A line about each option, by its words. */
  details?: Record<string, string>;
  /** A picture of each option, by its words. */
  images?: Record<string, string>;
  rows?: string[];
  media?: string[];
  min?: number;
  max?: number;
  labels?: string[];
  /** What it would answer, written as an answer is (see parseAnswer), or as data. */
  recommended?: string[] | DecisionValue;
  context?: string;
}

/** The parts of a question that say what it is, worked out and checked. */
export type AskSpec = Pick<Decision, "kind" | "question" | "context" | "options" | "rows" | "media" | "min" | "max" | "labels" | "recommended">;

/** One line of text: no line breaks, runs of spaces made one. */
export const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

const YES_NO = ["Yes", "No"];
/** A picture is a web address (https), a file in the vault, or a small inline image (data:image/…), never another scheme. */
const isPicture = (s: string) =>
  /^https:\/\/\S+$/i.test(s) ||
  (/^data:image\/(png|jpeg|gif|webp|svg\+xml)[;,]/i.test(s) && s.length <= 64_000) ||
  (!/^[a-z][a-z0-9+.-]*:/i.test(s) && !s.startsWith("//") && s.length <= 500);

/** Check and fill in a question; throws an Error saying what's wrong. */
export function askSpec(q: AskInput): AskSpec {
  const question = oneLine(q.question ?? "");
  if (!question) throw new Error("Say what the question is");
  if (question.length > QUESTION_MAX) throw new Error(`Keep the question to ${QUESTION_MAX} characters; put the rest in context`);
  const raw = (q.options ?? []).map((o) => (typeof o === "string" ? { label: o } : o));
  let options: DecisionOption[] = raw
    .map((o) => ({ label: oneLine(o.label ?? ""), detail: o.detail ? oneLine(o.detail) : undefined, image: o.image?.trim() || undefined }))
    .filter((o) => o.label);
  const kind: DecisionKind = q.kind ?? (options.length ? "one" : "text");
  if (!KINDS.includes(kind)) throw new Error(`"kind" must be one of ${KINDS.join(", ")}`);
  if (kind === "yes_no" && !options.length) options = YES_NO.map((label) => ({ label }));
  if (kind === "scale" || kind === "text") {
    if (options.length) throw new Error(`A ${kind} question has no options`);
  } else {
    if (options.length < 2) throw new Error("Offer two or more options");
    if (options.length > OPTIONS_MAX) throw new Error(`Offer at most ${OPTIONS_MAX} options`);
  }
  if (new Set(options.map((o) => o.label.toLowerCase())).size < options.length) throw new Error("Two options say the same thing");
  // Details and pictures given by the option's words (pairs over MCP and the CLI).
  const byLabel = (m: Record<string, string> | undefined, what: string, set: (o: DecisionOption, v: string) => void) => {
    for (const [k, v] of Object.entries(m ?? {})) {
      const o = options[optionOf(options, k) ?? -1];
      if (!o) throw new Error(`No option "${k}" to give a ${what} to`);
      set(o, v.trim());
    }
  };
  byLabel(q.details, "detail", (o, v) => (o.detail = oneLine(v)));
  byLabel(q.images, "picture", (o, v) => (o.image = v));
  for (const o of options) {
    if (o.label.length > OPTION_MAX) throw new Error(`Keep each option to ${OPTION_MAX} characters; put more in its detail`);
    if (o.detail && o.detail.length > DETAIL_MAX) throw new Error(`Keep each option's detail to ${DETAIL_MAX} characters`);
    if (o.image && !isPicture(o.image)) throw new Error(`"${o.image.slice(0, 80)}" isn't a picture: use an https:// address or a file in the vault`);
    if (!o.detail) delete o.detail;
    if (!o.image) delete o.image;
  }
  const rows = (q.rows ?? []).map(oneLine).filter(Boolean);
  if (kind === "rows") {
    if (!rows.length) throw new Error("Say the rows to choose for (events, files…)");
    if (rows.length > ROWS_MAX) throw new Error(`At most ${ROWS_MAX} rows`);
    if (rows.some((r) => r.length > OPTION_MAX)) throw new Error(`Keep each row to ${OPTION_MAX} characters`);
  } else if (rows.length) throw new Error('Only a "rows" question has rows');
  const media = (q.media ?? []).map((m) => m.trim()).filter(Boolean);
  if (media.length > MEDIA_MAX) throw new Error(`At most ${MEDIA_MAX} pictures`);
  for (const m of media) if (!isPicture(m)) throw new Error(`"${m.slice(0, 80)}" isn't a picture: use an https:// address or a file in the vault`);
  let [min, max] = [q.min ?? null, q.max ?? null];
  if (kind === "scale") {
    [min, max] = [min ?? 1, max ?? 5];
    if (!Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max - min < 1 || max - min > 10) throw new Error("A scale runs between two whole numbers, 1 to 10 steps apart (1 to 5 by default)");
  } else if (kind === "many") {
    if (min !== null && !(Number.isInteger(min) && min >= 0 && min <= options.length)) throw new Error(`"min" must be from 0 to ${options.length}`);
    if (max !== null && !(Number.isInteger(max) && max >= 1 && max <= options.length && max >= (min ?? 0))) throw new Error(`"max" must be from ${Math.max(1, min ?? 0)} to ${options.length}`);
  } else if (min !== null || max !== null) throw new Error('Only "many" and "scale" questions take min and max');
  const labels = (q.labels ?? []).map(oneLine);
  if (labels.length && (kind !== "scale" || labels.length !== 2)) throw new Error('"labels" are a scale\'s two ends: low, high');
  const context = q.context?.trim() || null;
  if (context && context.length > CONTEXT_MAX) throw new Error(`Keep the context to ${CONTEXT_MAX} characters, or link a note`);
  const spec: AskSpec = { kind, question, context, options, rows, media, min, max, labels: labels.length ? [labels[0], labels[1]] : null, recommended: null };
  const rec = q.recommended;
  if (rec !== undefined && !(Array.isArray(rec) && !rec.length)) {
    try {
      spec.recommended = Array.isArray(rec) ? parseAnswer(spec, rec) : checkValue(spec, rec);
    } catch (e) {
      throw new Error(`recommended: ${(e as Error).message}`);
    }
    if ("text" in spec.recommended && kind !== "text") throw new Error("recommended must be one of the options");
  }
  return spec;
}

/**
 * Which option text means: its number ("2", 1 = the first), or its words in any case. null when it's
 * neither, so it stands as an answer in the person's own words.
 */
export function optionOf(options: Array<string | DecisionOption>, text: string): number | null {
  const t = text.trim();
  const labels = options.map((o) => (typeof o === "string" ? o : o.label));
  if (/^\d+$/.test(t)) {
    const n = Number(t);
    return n >= 1 && n <= labels.length ? n - 1 : null;
  }
  const i = labels.findIndex((o) => o.trim().toLowerCase() === t.toLowerCase());
  return i >= 0 ? i : null;
}

type Shape = Pick<Decision, "kind" | "options" | "rows" | "min" | "max">;

/**
 * An answer written as words (the CLI's, and an agent's `recommended`), as data: one string, or
 * a list. Its comma-separated pieces are one option ("2" or "SQLite"); several for many (picked) and rank (best
 * first); one per row for rows, in order or as "Row=Option"; a number for a scale. Anything that
 * isn't one of the options is an answer in the person's own words, for kinds that take one.
 */
export function parseAnswer(d: Shape, input: string | string[]): DecisionValue {
  const whole = (typeof input === "string" ? input : input.join(", ")).trim();
  const words = (typeof input === "string" ? input.split(",") : input).map((p) => p.trim()).filter(Boolean);
  if (!words.length) throw new Error("Give an answer");
  const own = (): DecisionValue => ({ text: whole });
  const pick = (w: string) => {
    const i = optionOf(d.options, w);
    if (i === null) throw new Error(`"${w}" isn't one of the options: ${d.options.map((o, n) => `${n + 1}. ${o.label}`).join(", ")}`);
    return i;
  };
  switch (d.kind) {
    case "text":
      return own();
    case "one":
    case "compare":
    case "yes_no": {
      const i = optionOf(d.options, whole) ?? (d.kind === "yes_no" ? yesNo(whole, d) : null);
      return i === null ? own() : checkValue(d, { choice: i });
    }
    case "many": {
      const all = words.map((w) => optionOf(d.options, w));
      return all.every((i) => i !== null) ? checkValue(d, { choices: all as number[] }) : own();
    }
    case "rank":
      return checkValue(d, { order: words.map(pick) });
    case "scale":
      if (!/^\d+$/.test(words[0]) || words.length > 1) throw new Error(`Answer with a number from ${d.min} to ${d.max}`);
      return checkValue(d, { scale: Number(words[0]) });
    case "rows": {
      const rows: Array<number | null> = d.rows.map(() => null);
      if (words.every((w) => w.includes("="))) {
        for (const w of words) {
          const [row, ...rest] = w.split("=");
          const r = optionOf(d.rows, row);
          if (r === null) throw new Error(`"${row.trim()}" isn't one of the rows`);
          rows[r] = pick(rest.join("="));
        }
      } else {
        if (words.length !== d.rows.length) throw new Error(`Give one answer for each of the ${d.rows.length} rows, in order, or Row=Option`);
        words.forEach((w, r) => (rows[r] = pick(w)));
      }
      return checkValue(d, { rows });
    }
  }
}

/** "yes", "y", "no", "n" for a yes_no question whose options are Yes and No. */
function yesNo(w: string, d: Shape): number | null {
  const t = w.toLowerCase();
  const yes = d.options.findIndex((o) => o.label.toLowerCase() === "yes");
  const no = d.options.findIndex((o) => o.label.toLowerCase() === "no");
  return /^(y|yep|yeah|sure|ok)$/.test(t) && yes >= 0 ? yes : /^(n|nope|nah)$/.test(t) && no >= 0 ? no : null;
}

/** Check an answer as data against its question (the app sends these); throws an Error saying what's wrong. Returns it cleaned. */
export function checkValue(d: Shape, v: unknown): DecisionValue {
  const o = (v ?? {}) as Record<string, unknown>;
  const n = d.options.length;
  const isOption = (i: unknown): i is number => Number.isInteger(i) && (i as number) >= 0 && (i as number) < n;
  if (typeof o.text === "string") {
    const text = o.text.trim();
    if (!text) throw new Error("Say the answer in your own words");
    if (text.length > COMMENT_MAX) throw new Error(`Keep the answer to ${COMMENT_MAX} characters`);
    if (d.kind === "rank" || d.kind === "scale") throw new Error(`A ${d.kind} question is answered with ${d.kind === "rank" ? "an order" : "a number"}`);
    return { text };
  }
  switch (d.kind) {
    case "one":
    case "compare":
    case "yes_no":
      if (!isOption(o.choice)) throw new Error(`Pick an option from 1 to ${n}`);
      return { choice: o.choice };
    case "many": {
      const c = o.choices;
      if (!Array.isArray(c) || !c.every(isOption)) throw new Error(`Pick options from 1 to ${n}`);
      const choices = [...new Set(c as number[])].sort((a, b) => a - b);
      if (d.min !== null && choices.length < d.min) throw new Error(`Pick at least ${d.min}`);
      if (d.max !== null && choices.length > d.max) throw new Error(`Pick at most ${d.max}`);
      return { choices };
    }
    case "rank": {
      const order = o.order;
      if (!Array.isArray(order) || order.length !== n || !order.every(isOption) || new Set(order).size !== n) throw new Error(`Put all ${n} options in order, each once`);
      return { order: order as number[] };
    }
    case "scale":
      if (!Number.isInteger(o.scale) || (o.scale as number) < d.min! || (o.scale as number) > d.max!) throw new Error(`Answer with a number from ${d.min} to ${d.max}`);
      return { scale: o.scale as number };
    case "rows": {
      const rows = o.rows;
      if (!Array.isArray(rows) || rows.length !== d.rows.length || !rows.every((r) => r === null || isOption(r))) throw new Error(`Give a choice (or none) for each of the ${d.rows.length} rows`);
      if (rows.every((r) => r === null)) throw new Error("Choose for at least one row");
      return { rows: rows as Array<number | null> };
    }
    case "text":
      throw new Error("Say the answer in words");
  }
}

/** An answer as words: "SQLite", "Postgres, Redis", "1. B, 2. A", "4 of 1–5", "Talk A: Go; Talk B: Skip". */
export function answerText(d: Pick<Decision, "options" | "rows" | "min" | "max" | "labels">, v: DecisionValue): string {
  const label = (i: number) => d.options[i]?.label ?? `option ${i + 1}`;
  if ("text" in v) return v.text;
  if ("choice" in v) return label(v.choice);
  if ("choices" in v) return v.choices.length ? v.choices.map(label).join(", ") : "None of them";
  if ("order" in v) return v.order.map((i, n) => `${n + 1}. ${label(i)}`).join(", ");
  if ("scale" in v) {
    const end = d.labels && (v.scale === d.min ? d.labels[0] : v.scale === d.max ? d.labels[1] : "");
    return `${v.scale} of ${d.min}–${d.max}${end ? ` (${end})` : ""}`;
  }
  return d.rows.map((r, i) => `${r}: ${v.rows[i] === null ? "no answer" : label(v.rows[i]!)}`).join("; ");
}

/** Who asked, as the daily note says it: "Claude Code", or the person's name. */
const asker = (d: Pick<Decision, "agent" | "asked_by">) => d.agent ?? d.asked_by;
const bold = (s: string) => `**${oneLine(s).replace(/\*/g, "\\*")}**`;

/**
 * The lines a settled decision adds to the daily note's Decisions section: the question and what
 * was decided (a choice for each row on lines of their own), then the comment, indented under it.
 *
 *     - Postgres or SQLite for the sync service? **Postgres** (asked by Claude Code, about [[Sync]])
 *       We already run Postgres for billing.
 */
export function journalLines(d: Decision, linkTo?: (path: string) => string): string[] {
  const about = d.note ? `, about ${linkTo ? linkTo(d.note) : `[[${d.note.replace(/\.md$/, "")}]]`}` : "";
  const v = d.value;
  const perRow = d.status === "answered" && v && "rows" in v;
  const outcome = d.status === "dismissed" ? "_Not deciding_" : perRow ? "" : bold(d.answer ?? "");
  const lines = [`- ${oneLine(d.question)}${outcome ? ` ${outcome}` : ""} (asked by ${asker(d)}${about})`];
  if (perRow) d.rows.forEach((r, i) => lines.push(`  - ${oneLine(r)}: ${v.rows[i] === null ? "_no answer_" : bold(d.options[v.rows[i]!].label)}`));
  for (const l of (d.comment ?? "").split(/\r?\n/)) if (l.trim()) lines.push(`  ${l.trimEnd()}`);
  return lines;
}

/** Decisions as text for people and agents: open ones with their choices, settled ones with the answer. */
export function fmtDecisions(list: Decision[]): string {
  if (!list.length) return "No decisions here. Ask one with ask_decision (commonink decision ask).";
  return list.map(fmtDecision).join("\n\n");
}

const KIND_SAYS: Record<DecisionKind, string> = {
  one: "pick one",
  many: "pick any",
  yes_no: "yes or no",
  rows: "a choice for each row",
  compare: "compare and pick one",
  rank: "put in order",
  scale: "a number",
  text: "in words",
};

export function fmtDecision(d: Decision): string {
  const lines = [`[${d.id}] ${d.question} (${KIND_SAYS[d.kind]})`];
  if (d.status === "open") {
    for (const r of d.rows) lines.push(`  Row: ${r}`);
    const rec = d.recommended;
    const recommended = (i: number) => !!rec && (("choice" in rec && rec.choice === i) || ("choices" in rec && rec.choices.includes(i)));
    d.options.forEach((o, i) => lines.push(`  ${i + 1}. ${o.label}${o.detail ? `: ${o.detail}` : ""}${recommended(i) ? " (recommended)" : ""}`));
    if (d.kind === "scale") lines.push(`  From ${d.min}${d.labels ? ` (${d.labels[0]})` : ""} to ${d.max}${d.labels ? ` (${d.labels[1]})` : ""}`);
    if (rec && !("choice" in rec) && !("choices" in rec)) lines.push(`  Recommended: ${answerText(d, rec)}`);
    lines.push(`  Open, asked by ${d.asked_by} ${new Date(d.asked_at).toISOString().slice(0, 16).replace("T", " ")} UTC`);
  } else if (d.status === "answered") {
    const v = d.value;
    const how = !v ? "" : "text" in v ? " (in their own words)" : "choice" in v ? ` (option ${v.choice + 1})` : "";
    lines.push(`  Answer: ${d.answer}${how}`);
    if (d.comment) lines.push(`  Comment: ${d.comment}`);
    lines.push(`  By ${d.answered_by}${d.journal ? `, recorded in ${d.journal}` : ""}`);
  } else {
    lines.push(d.status === "dismissed" ? `  Dismissed by ${d.answered_by}: they're not deciding this${d.comment ? ` (${d.comment})` : ""}` : "  Withdrawn by whoever asked");
  }
  if (d.note) lines.push(`  About: ${d.note}`);
  return lines.join("\n");
}
