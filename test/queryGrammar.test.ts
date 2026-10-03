import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAttrs, serializeAttrs } from "../src/core/directive.ts";
import { formatQuery, parseQuery, queryProblem, toQuery } from "../src/core/query.ts";
import { andJoin, evaluate, format, parse, SYNTAX, syntaxText, type Expr } from "../src/core/queryGrammar.ts";
import { openTempVault } from "./helpers.ts";

/** An expression as a short string: words as themselves, groups in brackets. */
function show(e: Expr | null): string {
  if (!e) return "";
  switch (e.kind) {
    case "text":
      return e.phrase ? `"${e.words.join(" ")}"` : e.words[0];
    case "tag":
      return `#${e.tag}`;
    case "folder":
      return `in:${e.folders.join("|")}`;
    case "date":
      return `${e.field}${e.op}${e.day}`;
    case "not":
      return `NOT ${show(e.item)}`;
    case "and":
      return `[${e.items.map(show).join(" & ")}]`;
    case "or":
      return `[${e.items.map(show).join(" | ")}]`;
  }
}
const read = (q: string) => show(parse(q).expr);

test("AND goes before OR, and side by side is AND", () => {
  assert.equal(read("a b OR c"), "[[a & b] | c]");
  assert.equal(read("a AND b OR c"), "[[a & b] | c]");
  assert.equal(read("a OR b c"), "[a | [b & c]]");
  assert.equal(read("a OR b OR c"), "[a | b | c]");
  assert.equal(read("a AND b"), "[a & b]");
});

test("parentheses group, and nest", () => {
  assert.equal(read("(a OR b) c"), "[[a | b] & c]");
  assert.equal(read("(a OR b) AND (c OR d)"), "[[a | b] & [c | d]]");
  assert.equal(read("a (b (c OR d))"), "[a & b & [c | d]]");
  assert.equal(read("(a)"), "a");
});

test("a dash binds tightest, and leaves out a whole group", () => {
  assert.equal(read("-a b"), "[NOT a & b]");
  assert.equal(read("a -(b OR c)"), "[a & NOT [b | c]]");
  assert.equal(read("-(a b) OR c"), "[NOT [a & b] | c]");
  assert.equal(read('-"old idea" -tag=x -folder=Archive'), '[NOT "old idea" & NOT #x & NOT in:Archive]');
  // -tag=a,b leaves out both tags, as it always did; -tag=a|b leaves out either.
  assert.equal(read("-tag=a,b"), "[NOT #a & NOT #b]");
  assert.equal(read("-tag=a|b"), "NOT [#a | #b]");
  assert.equal(read("-modified>-7d"), "NOT modified>-7d");
});

test("every kind of term works inside a group", () => {
  assert.equal(read('(tag=work OR tag=home) -folder=Archive "launch plan"'), '[[#work | #home] & NOT in:Archive & "launch plan"]');
  assert.equal(read("(folder=Projects OR modified>-7d) -(created<2026-01-01 OR tag=old)"), "[[in:Projects | modified>-7d] & NOT [created<2026-01-01 | #old]]");
  assert.equal(read("folder='Health and Fitness' OR folder=A|B/"), "[in:Health and Fitness | in:A|B]");
  assert.equal(read("tag=a|b tag=c,d"), "[[#a | #b] & #c & #d]");
});

test("sort= sits outside the boolean terms", () => {
  assert.deepEqual(parse("(a OR b) sort=title"), { expr: parse("a OR b").expr, sort: "title", error: null });
  assert.equal(parse("(a sort=title)").error?.message, "sort= goes on its own, outside ( ) and without a dash (at character 4)");
  assert.equal(parse("a -sort=title").error?.message, "sort= goes on its own, outside ( ) and without a dash (at character 4)");
  assert.match(parse("sort=size").error!.message, /^"sort" is modified, date, oldest, title or created, not "size" \(at character 1\)$/);
});

test("mistakes say what's wrong and where", () => {
  const error = (q: string) => parse(q).error?.message ?? null;
  assert.equal(error("(a OR b"), 'Missing ")" for the "(" at character 1');
  assert.equal(error("a OR b)"), 'There\'s no "(" for the ")" at character 7');
  assert.equal(error("a OR"), "Nothing after OR at character 3: put a word or filter on each side");
  assert.equal(error("OR a"), "Nothing before OR at character 1: put a word or filter on each side");
  assert.equal(error("a AND"), "Nothing after AND at character 3: put a word or filter on each side");
  assert.equal(error("AND a"), "Nothing before AND at character 1: put a word or filter on each side");
  assert.equal(error("(a OR) b"), "Nothing after OR at character 4: put a word or filter on each side");
  assert.equal(error("a ()"), "Nothing inside the ( ) at character 3");
  assert.equal(error("tag=x OR folder=/"), "Write folder=… with a folder's name, like folder=Projects (at character 10)");
  assert.equal(parse("(a OR b").error?.at, 0);
  // The rest still reads, so a list still shows something while a query is half typed.
  assert.equal(read("(a OR b"), "[a | b]");
  assert.equal(read("a OR"), "a");
  // A query with a mistake can't be saved; the message is the same one.
  assert.equal(queryProblem('q="(a OR b"'), 'Missing ")" for the "(" at character 1');
  assert.equal(queryProblem("(tag=work OR tag=home)"), 'Put words, ( ) and OR inside q="…", like q="(budget OR costs) -draft"');
});

test("an expression written out reads back the same", () => {
  for (const q of [
    '(tag=work OR tag=home) -folder=Archive "launch plan"',
    "(alpha OR beta) AND tag=draft",
    "a -(b OR c) OR -(d e) f",
    "-tag=a,b tag=c|d folder='Health and Fitness' folder=A|B",
    "((a OR b) (c OR (d e))) OR -f",
    "modified>-7d -created<=2026-09-01 e-mail",
  ]) {
    const { expr, error } = parse(q);
    assert.equal(error, null, q);
    assert.deepEqual(parse(format(expr)).expr, expr, q);
  }
  assert.equal(format(parse("a (b OR c) -(d OR e)").expr), "a (b OR c) -(d OR e)");
});

test("grouping survives saving: a smart folder, a notes ::view's settings and the attrs they're written as", () => {
  const q = `(tag=work OR tag=home) -folder=Archive 'launch plan'`;
  const saved = formatQuery(parseQuery(serializeAttrs({ q, sort: "title" })));
  assert.equal(saved, `q="${q}" sort=title`);
  assert.equal(parseQuery(saved).q, q);
  assert.equal(parseAttrs(saved).q, q);
  // Filters written as keys of their own join q without changing what an OR in it means.
  assert.equal(toQuery({ q: "budget OR costs", modified: ">-7d", "-folder": "Archive" }).q, "(budget OR costs) modified>-7d -folder=Archive");
  assert.equal(parseQuery('q="a OR b" -tag=x').q, "(a OR b) -tag=x");
  assert.equal(andJoin("a OR b", "c"), "(a OR b) c");
  assert.equal(andJoin("a b", "c OR d"), "a b (c OR d)");
  assert.equal(andJoin("a OR b sort=title", "c"), "(a OR b) sort=title c");
  assert.equal(andJoin("", "c"), "c");
});

test("the smart folder editor's forms keep their meaning: a b, a OR b, folder=\"A|B\"", () => {
  assert.equal(read("alpha beta"), "[alpha & beta]");
  assert.equal(read("alpha OR beta"), "[alpha | beta]");
  assert.deepEqual(parseQuery('folder="A|B" q="alpha OR beta"'), { q: "alpha OR beta", folder: "A|B" });
  assert.equal(formatQuery(parseQuery('folder="Projects/|Areas/Health and Fitness"')), 'folder="Projects|Areas/Health and Fitness"');
  assert.equal(queryProblem('folder="A|B" q="alpha beta"'), null);
});

test("evaluate does and, or and not over a term test", () => {
  const has = (...words: string[]) => (t: { kind: string; words?: string[] }) => t.kind === "text" && words.includes(t.words![0]);
  const { expr } = parse("(a OR b) -c");
  assert.equal(evaluate(expr, has("a")), true);
  assert.equal(evaluate(expr, has("b", "c")), false);
  assert.equal(evaluate(expr, has("d")), false);
  assert.equal(evaluate(null, has()), true);
});

test("the syntax help lists every operator and field, each with an example that reads", () => {
  for (const s of SYNTAX) assert.equal(parse(s.example).error, null, s.example);
  for (const want of ["AND", "OR", "-term", "( … )", "tag=", "folder=", "modified", "created", "sort="]) {
    assert.ok(SYNTAX.some((s) => s.syntax.includes(want)), want);
  }
  const text = syntaxText();
  for (const s of SYNTAX) assert.ok(text.includes(s.example), s.example);
});

test("the feed runs grouped queries over a vault", () => {
  const { vault } = openTempVault({
    "Projects/Alpha.md": "# Alpha\n\nThe launch plan. #work #draft\n",
    "Projects/Beta.md": "# Beta\n\nBudget notes. #home\n",
    "Areas/Health and Fitness/Gamma.md": "# Gamma\n\nRunning plan. #home\n",
    "Archive/Delta.md": "# Delta\n\nThe launch plan, old. #work\n",
    "Inbox/Epsilon.md": "# Epsilon\n\nalpha beta launch\n",
  });
  const titles = (src: string) => vault.feed(parseQuery(src)).items.map((i) => i.title).sort();
  assert.deepEqual(titles(`q="(tag=work OR tag=home) -folder=Archive 'launch plan'"`), ["Alpha"]);
  assert.deepEqual(titles(`q="(tag=work OR tag=home) -folder=Projects"`), ["Gamma"]);
  assert.deepEqual(titles('q="plan OR budget -tag=home"'), ["Alpha", "Gamma"]);
  assert.deepEqual(titles('q="(plan OR budget) -tag=home"'), ["Alpha"]);
  assert.deepEqual(titles('q="launch -(tag=draft OR folder=Inbox)"'), []);
  assert.deepEqual(titles('q="launch -(tag=draft OR folder=Areas)"'), ["Epsilon"]);
  assert.deepEqual(titles('folder="Projects|Areas/Health and Fitness"'), ["Alpha", "Beta", "Gamma"]);
  assert.deepEqual(titles(`q="folder=Projects|Inbox launch"`), ["Alpha", "Epsilon"]);
  assert.deepEqual(titles(`q="folder='Areas/Health and Fitness' OR tag=draft"`), ["Alpha", "Gamma"]);
  assert.deepEqual(titles('q="alpha beta"'), ["Epsilon"]);
  assert.deepEqual(titles('q="alpha OR beta"'), ["Alpha", "Beta", "Epsilon"]);
  assert.deepEqual(titles('q="(alpha OR beta) AND tag=home"'), ["Beta"]);
  // sort= in the words orders the list, as the sort key does.
  assert.deepEqual(vault.feed({ q: "plan sort=title" }).items.map((i) => i.title), ["Alpha", "Gamma"]);
  // Search reads groups too (its filters aside).
  assert.deepEqual(vault.search("(budget OR running) -notes").map((h) => h.title), ["Gamma"]);
});
