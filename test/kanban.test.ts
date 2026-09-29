import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addCard, addColumn, boardsIn, cardAsNote, cardLink, checkCard, deleteCard, editCard, moveCard, moveColumn, noteName, renameColumn, setBoardArgs,
} from "../src/core/kanban.ts";
import { openTempVault } from "./helpers.ts";

const TODAY = "2026-09-28";

const NOTE = `# Launch

Notes above the board.

:::kanban
## Backlog
- [ ] [[Pricing page]] #business
- [ ] Draft the announcement @audrow due:2026-10-15
  Talk to legal first.

  - [ ] a nested step

## Doing
- [ ] [[Stripe billing]]

## Done
- [x] [[Landing page]]
:::

Notes below the board.
`;

/** Lines 0-based, the way the board addresses cards. */
const lineOf = (md: string, text: string) => md.split("\n").findIndex((l) => l.includes(text));

test("a :::kanban block's headings are columns and its list items are cards, with the lines nested under each", () => {
  const [board] = boardsIn(NOTE);
  assert.deepEqual(
    board.columns.map((c) => [c.title, c.done, c.cards.map((k) => [k.checked, k.text, k.details])]),
    [
      ["Backlog", false, [[false, "[[Pricing page]] #business", []], [false, "Draft the announcement @audrow due:2026-10-15", ["Talk to legal first.", "", "- [ ] a nested step"]]]],
      ["Doing", false, [[false, "[[Stripe billing]]", []]]],
      ["Done", true, [[true, "[[Landing page]]", []]]],
    ],
  );
  assert.deepEqual([board.from, board.close, board.level], [4, 17, 2]);
});

test("a note can hold several boards; one in code, or one never closed, isn't a board", () => {
  const md = "```md\n:::kanban\n## Not a column\n:::\n```\n\n:::kanban{done=Shipped}\n### Ideas\n* one\n### Shipped\n:::\n\ntext\n\n:::kanban\n## A\n:::\n\n:::kanban\n## Open\n";
  const boards = boardsIn(md);
  assert.deepEqual(boards.map((b) => [b.args, b.level, b.columns.map((c) => `${c.title}${c.done ? " (done)" : ""}:${c.cards.length}`)]), [
    [{ done: "Shipped" }, 3, ["Ideas:1", "Shipped (done):0"]],
    [{}, 2, ["A:0"]],
  ]);
});

test("moving a card changes only where its lines are: text around the board, blank lines and its nested lines stay byte for byte", () => {
  const moved = moveCard(NOTE, lineOf(NOTE, "Draft the announcement"), { board: 0, column: 1 }, 1, TODAY);
  assert.equal(
    moved,
    `# Launch

Notes above the board.

:::kanban
## Backlog
- [ ] [[Pricing page]] #business

## Doing
- [ ] [[Stripe billing]]
- [ ] Draft the announcement @audrow due:2026-10-15
  Talk to legal first.

  - [ ] a nested step

## Done
- [x] [[Landing page]]
:::

Notes below the board.
`,
  );
  const back = moveCard(moved, lineOf(moved, "Draft the announcement"), { board: 0, column: 0 }, 1, TODAY);
  assert.equal(back, NOTE);
  assert.equal(moveCard(NOTE, lineOf(NOTE, "Pricing page"), { board: 0, column: 0 }, 5, TODAY), NOTE.replace("- [ ] [[Pricing page]] #business\n", "").replace("  - [ ] a nested step\n", "  - [ ] a nested step\n- [ ] [[Pricing page]] #business\n"));
});

test("a card moved into the done column is ticked with today's date, and moved out of it is unticked", () => {
  const done = moveCard(NOTE, lineOf(NOTE, "Stripe billing"), { board: 0, column: 2 }, 0, TODAY);
  assert.equal(done, NOTE.replace("## Doing\n- [ ] [[Stripe billing]]\n", "## Doing\n").replace("## Done\n", `## Done\n- [x] [[Stripe billing]] done:${TODAY}\n`));
  const reopened = moveCard(done, lineOf(done, "Stripe billing"), { board: 0, column: 1 }, 0, TODAY);
  assert.equal(reopened, NOTE);
  const shipped = "Intro\n:::kanban{done=Shipped}\n## Done-ish\n- [ ] a\n## Shipped\n:::\n";
  assert.equal(moveCard(shipped, 3, { board: 0, column: 1 }, 0, TODAY), `Intro\n:::kanban{done=Shipped}\n## Done-ish\n## Shipped\n- [x] a done:${TODAY}\n:::\n`);
});

test("ticking a repeating card puts the next one after it (its nested lines stay with it); unticking straight after takes that back", () => {
  const md = ":::kanban\r\n## Doing\r\n- [ ] Pay rent due:2026-10-01 rec:monthly\r\n  From savings.\r\n- [ ] Other\r\n:::\r\n";
  const ticked = checkCard(md, 2, true, TODAY);
  assert.equal(ticked, `:::kanban\r\n## Doing\r\n- [x] Pay rent due:2026-10-01 rec:monthly done:${TODAY}\r\n  From savings.\r\n- [ ] Pay rent due:2026-11-01 rec:monthly\r\n- [ ] Other\r\n:::\r\n`);
  assert.equal(checkCard(ticked, 2, false, TODAY), md);
  const { quire } = openTempVault({ "Bills.md": md });
  quire.editCard("Bills", "Pay rent", { done: true }, "agent", TODAY);
  assert.equal(quire.read("Bills").content, ticked);
});

test("editing a card's text keeps its checkbox and nested lines; new detail lines nest under it", () => {
  const at = lineOf(NOTE, "Draft the announcement");
  const text = "Draft the launch post @audrow due:2026-10-15";
  assert.equal(editCard(NOTE, at, `${text}\nTalk to legal first.\n\n- [ ] a nested step`), NOTE.replace("Draft the announcement @audrow", "Draft the launch post @audrow"));
  assert.equal(editCard(NOTE, at, text), NOTE.replace("- [ ] Draft the announcement @audrow due:2026-10-15\n  Talk to legal first.\n\n  - [ ] a nested step\n", `- [ ] ${text}\n`));
  const pricing = lineOf(NOTE, "Pricing page");
  assert.equal(editCard(NOTE, pricing, "[[Pricing page]] #business\nCompare three tiers."), NOTE.replace("#business\n", "#business\n  Compare three tiers.\n"));
});

test("cards are added last (or at a place) in a column, checked in the done column, and deleted with their nested lines", () => {
  assert.equal(addCard(NOTE, { board: 0, column: 1 }, "Webhooks\nRetry on 500s", TODAY), NOTE.replace("- [ ] [[Stripe billing]]\n", "- [ ] [[Stripe billing]]\n- [ ] Webhooks\n  Retry on 500s\n"));
  assert.equal(addCard(NOTE, { board: 0, column: 0 }, "First", TODAY, 0), NOTE.replace("## Backlog\n", "## Backlog\n- [ ] First\n"));
  assert.equal(addCard(NOTE, { board: 0, column: 2 }, "Ship it", TODAY), NOTE.replace("[[Landing page]]\n", `[[Landing page]]\n- [x] Ship it done:${TODAY}\n`));
  assert.equal(addCard("## Board\n:::kanban\n## Empty\n\n## Next\n:::\n", { board: 0, column: 0 }, "One", TODAY), "## Board\n:::kanban\n## Empty\n- [ ] One\n\n## Next\n:::\n");
  assert.throws(() => addCard(NOTE, { board: 0, column: 0 }, "   ", TODAY), /needs some text/);
  assert.equal(deleteCard(NOTE, lineOf(NOTE, "Draft the announcement")), NOTE.replace("- [ ] Draft the announcement @audrow due:2026-10-15\n  Talk to legal first.\n\n  - [ ] a nested step\n", ""));
  assert.equal(checkCard(NOTE, lineOf(NOTE, "Pricing page"), true, TODAY), NOTE.replace("- [ ] [[Pricing page]] #business", `- [x] [[Pricing page]] #business done:${TODAY}`));
  assert.equal(checkCard(NOTE, lineOf(NOTE, "Landing page"), false, TODAY), NOTE.replace("- [x] [[Landing page]]", "- [ ] [[Landing page]]"));
});

test("columns are added at the end, renamed in place, and reordered with the blank lines between them left where they were", () => {
  assert.equal(addColumn(NOTE, 0, "Review"), NOTE.replace("- [x] [[Landing page]]\n", "- [x] [[Landing page]]\n\n## Review\n"));
  assert.equal(renameColumn(NOTE, { board: 0, column: 1 }, "In progress"), NOTE.replace("## Doing", "## In progress"));
  assert.equal(
    moveColumn(NOTE, { board: 0, column: 2 }, 0),
    NOTE.replace(
      /## Backlog[\s\S]*:::\n\n/,
      "## Done\n- [x] [[Landing page]]\n\n## Backlog\n- [ ] [[Pricing page]] #business\n- [ ] Draft the announcement @audrow due:2026-10-15\n  Talk to legal first.\n\n  - [ ] a nested step\n\n## Doing\n- [ ] [[Stripe billing]]\n:::\n\n",
    ),
  );
  assert.equal(moveColumn(moveColumn(NOTE, { board: 0, column: 0 }, 2), { board: 0, column: 2 }, 0), NOTE);
});

test("a board's settings live on its opening line", () => {
  const md = setBoardArgs(NOTE, 0, { done: "Shipped it" });
  assert.equal(md, NOTE.replace(":::kanban\n", ':::kanban{done="Shipped it"}\n'));
  assert.deepEqual(boardsIn(md)[0].columns.map((c) => c.done), [false, false, false]);
  assert.equal(setBoardArgs(md, 0, {}), NOTE);
});

test("Windows line endings survive every change", () => {
  const crlf = NOTE.replace(/\n/g, "\r\n");
  const moved = moveCard(crlf, lineOf(crlf, "Stripe billing"), { board: 0, column: 2 }, 0, TODAY);
  assert.equal(moved, NOTE.replace("## Doing\n- [ ] [[Stripe billing]]\n", "## Doing\n").replace("## Done\n", `## Done\n- [x] [[Stripe billing]] done:${TODAY}\n`).replace(/\n/g, "\r\n"));
  assert.equal(addCard(crlf, { board: 0, column: 1 }, "New\nmore", TODAY), NOTE.replace("[[Stripe billing]]\n", "[[Stripe billing]]\n- [ ] New\n  more\n").replace(/\n/g, "\r\n"));
  assert.equal(boardsIn(crlf)[0].columns[0].cards[1].text, "Draft the announcement @audrow due:2026-10-15");
});

test("a card that is a [[link]] names its note; Open as note moves its details into a new note and links to it", () => {
  assert.deepEqual(cardLink({ text: "[[Stripe billing|Billing]] @sam due:2026-10-01" }), { target: "Stripe billing", label: "Billing" });
  assert.equal(cardLink({ text: "Read [[Stripe billing]] first" }), null);
  const card = boardsIn(NOTE)[0].columns[0].cards[1];
  assert.equal(noteName(card), "Draft the announcement");
  assert.equal(noteName({ text: "Fix: C#/C++ [[Build|builds]]?" }), "Fix C C++ builds");
  assert.deepEqual(cardAsNote(card, "Draft the announcement"), {
    body: "# Draft the announcement\n\nTalk to legal first.\n\n- [ ] a nested step\n",
    text: "[[Draft the announcement]] @audrow due:2026-10-15",
  });
});

// ---------------------------------------------------------------- in a vault

const LAUNCH = `# Launch

- [ ] Book the venue

:::kanban
## Backlog
- [ ] [[Pricing page]] #business
- [ ] Draft the announcement @audrow due:2026-10-15

## Doing
- [ ] [[Stripe billing]]

## Done
- [x] [[Landing page]]
:::

- [ ] Send the recap
`;

function launchVault() {
  return openTempVault(
    { "Launch.md": LAUNCH, "Projects/Pricing page.md": "# Pricing page\n\n- [ ] Tiers\n", "Stripe billing.md": "# Stripe billing\n" },
    { now: () => Date.parse(`${TODAY}T12:00:00`) },
  );
}

test("board cards are tasks under their column; the note's own tasks keep their heading, even after the board", () => {
  const { quire } = launchVault();
  assert.deepEqual(
    quire.tasks({ note: "Launch" }).map((t) => `${t.line} ${t.heading}: ${t.summary}${t.done ? " (done)" : ""}`),
    ["3 Launch: Book the venue", "7 Backlog: [[Pricing page]]", "8 Backlog: Draft the announcement", "11 Doing: [[Stripe billing]]", "14 Done: [[Landing page]] (done)", "17 Launch: Send the recap"],
  );
  assert.deepEqual(quire.tasks({ assignee: "audrow" }).map((t) => t.line), [8]);
  assert.deepEqual(quire.outline("Launch").map((h) => h.text), ["Launch", "Backlog", "Doing", "Done"]);
});

test("links, backlinks and tags on cards are indexed like any others, and renaming a linked note keeps its card linked", () => {
  const { quire } = launchVault();
  assert.deepEqual(quire.backlinks("Stripe billing").map((b) => `${b.path}:${b.line} ${b.text}`), ["Launch.md:11 - [ ] [[Stripe billing]]"]);
  assert.deepEqual(quire.tagged("business").map((u) => `${u.kind} ${u.path}:${u.line}`), ["task Launch.md:7"]);
  quire.move("Stripe billing", "Projects/Billing with Stripe", "you");
  assert.equal(quire.boards("Launch").boards[0].columns[1].cards[0].text, "[[Billing with Stripe]]");
  assert.equal(quire.read("Launch").content, LAUNCH.replace("[[Stripe billing]]", "[[Billing with Stripe]]"));
});

test("agents add, move and edit cards by column name and card words; each is one logged change that restore undoes", () => {
  const { quire } = launchVault();
  quire.addCard("Launch", "doing", "Webhooks @sam", "agent");
  const moved = quire.moveCard("Launch", "stripe", "Done", "agent", { position: 1 });
  assert.equal(moved.change?.source, "agent");
  quire.editCard("Launch", "announcement", { text: "Draft the launch post due:2026-10-16\nAsk legal." }, "agent");
  quire.editCard("Launch", "L7", { done: true }, "agent");
  assert.equal(
    quire.read("Launch").content,
    LAUNCH.replace("- [ ] [[Pricing page]] #business", `- [x] [[Pricing page]] #business done:${TODAY}`)
      .replace("- [ ] Draft the announcement @audrow due:2026-10-15", "- [ ] Draft the launch post due:2026-10-16\n  Ask legal.")
      .replace("## Doing\n- [ ] [[Stripe billing]]\n", "## Doing\n- [ ] Webhooks @sam\n")
      .replace("## Done\n", `## Done\n- [x] [[Stripe billing]] done:${TODAY}\n`),
  );
  const log = quire.changes({ path: "Launch.md" });
  assert.deepEqual(log.map((c) => `${c.op} by ${c.source}`), ["edit by agent", "edit by agent", "edit by agent", "edit by agent"]);
  for (const c of log) quire.restore(c.id, "you");
  assert.equal(quire.read("Launch").content, LAUNCH);
});

test("agents get a clear error for a card or column that isn't there or could be several", () => {
  const { quire } = launchVault();
  assert.throws(() => quire.moveCard("Launch", "page", "Done", "agent"), /"page" matches 2 cards in Launch\.md; name the card by its line number/);
  assert.throws(() => quire.moveCard("Launch", "nothing like it", "Done", "agent"), /No card in Launch\.md matches "nothing like it"/);
  assert.throws(() => quire.addCard("Launch", "Review", "x", "agent"), /No column "Review" on the board in Launch\.md\. Columns: Backlog, Doing, Done/);
  assert.throws(() => quire.addCard("Stripe billing", "Doing", "x", "agent"), /Stripe billing\.md has no board/);
  assert.throws(() => quire.addCard("Launch", "Doing", " ", "agent"), /A card needs some text/);
});
