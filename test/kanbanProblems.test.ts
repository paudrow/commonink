import { test } from "node:test";
import assert from "node:assert/strict";
import { boardsIn, fixesFor, fixProblem, moveCard, unclosedBoard } from "../src/core/kanban.ts";

const TODAY = "2026-09-28";

test("a repeating card moved into Done leaves its next occurrence at the top of the first column", () => {
  const md = "x\n:::kanban\n## To do\n- [ ] Other\n## Done\n:::\n\n:::kanban\n## Doing\n- [ ] Water plants rec:weekly due:2026-09-28\n## Done\n:::\n";
  const next = (line: string, done: string) => (line.includes("rec:") ? line.replace("[x]", "[ ]").replace(` done:${done}`, "").replace("2026-09-28", "2026-10-05") : null);
  assert.equal(
    moveCard(md, 9, { board: 1, column: 1 }, 0, TODAY, next),
    `x\n:::kanban\n## To do\n- [ ] Other\n## Done\n:::\n\n:::kanban\n## Doing\n- [ ] Water plants rec:weekly due:2026-10-05\n## Done\n- [x] Water plants rec:weekly due:2026-09-28 done:${TODAY}\n:::\n`,
  );
  assert.equal(
    moveCard(md, 3, { board: 0, column: 1 }, 0, TODAY, next),
    `x\n:::kanban\n## To do\n## Done\n- [x] Other done:${TODAY}\n:::\n\n:::kanban\n## Doing\n- [ ] Water plants rec:weekly due:2026-09-28\n## Done\n:::\n`,
  );
});

const MESSY = `# Plan

:::kanban{wip=3}
A note about this board.

## To do
- [ ] One
Loose text here
more loose text

- [ ] Two
## To do
---
:::
`;

test("lines a board can't place are reported as problems with where they are, and nothing is dropped", () => {
  const [board] = boardsIn(MESSY);
  assert.deepEqual(
    board.problems.map((p) => [p.kind, p.from, p.to, p.message]),
    [
      ["unknown-setting", 2, 3, "The board doesn't use wip="],
      ["before-columns", 3, 4, "Line 4 before the first column isn't part of any column"],
      ["stray", 7, 9, "Lines 8–9 in To do aren't cards"],
      ["duplicate-column", 11, 12, "Two columns are called To do: agents can only tell them apart by number"],
      ["stray", 12, 13, "Line 13 in To do isn't a card"],
    ],
  );
  assert.deepEqual(board.columns.map((c) => c.cards.map((k) => k.text)), [["One", "Two"], []]);
  assert.deepEqual(board.problems.map((p) => fixesFor(p, board)), [["remove"], ["move", "remove"], ["cards", "remove"], [], ["cards", "remove"]]);
});

test("each quick fix changes only its problem's lines", () => {
  assert.equal(fixProblem(MESSY, 0, 0, "remove"), MESSY.replace(":::kanban{wip=3}", ":::kanban"));
  assert.equal(fixProblem(MESSY, 0, 1, "move"), MESSY.replace("A note about this board.\n", "").replace("## To do\n- [ ] One", "## To do\n- [ ] A note about this board.\n- [ ] One"));
  assert.equal(fixProblem(MESSY, 0, 1, "remove"), MESSY.replace("A note about this board.\n", ""));
  assert.equal(fixProblem(MESSY, 0, 2, "cards"), MESSY.replace("Loose text here\nmore loose text\n", "- [ ] Loose text here\n- [ ] more loose text\n"));
  assert.equal(fixProblem(MESSY, 0, 2, "remove"), MESSY.replace("Loose text here\nmore loose text\n", ""));
  assert.equal(fixProblem(MESSY, 0, 4, "cards"), MESSY.replace("---\n:::", "- [ ] ---\n:::"));
  assert.throws(() => fixProblem(MESSY, 0, 3, "remove"), /isn't on the board any more/);
  const fixed = [4, 2, 1, 0].reduce((md, i) => fixProblem(md, 0, i, "remove"), MESSY);
  assert.deepEqual(boardsIn(fixed)[0].problems.map((p) => p.kind), ["duplicate-column"]);
});

const BASE = `# Launch

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

test("fuzz: random edits never break the parser, problems stay inside their board, and a card's moves round-trip every other line", () => {
  let seed = Number(process.env.FUZZ_SEED ?? 7); // FUZZ_SEED=n tries other edits
  const rand = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed % n);
  const fence = "`".repeat(3);
  const pieces = ["## A", "### B", "# C", "- [ ] card", "* star", "1. first", "  nested", "text", "", ":::", ":::kanban", ":::kanban{x=1}", "---", fence, "> quote", "- [x] done:2026-01-01", "## Done {color=red}", "## {color=", "#", "\r"];
  let boardsSeen = 0;
  for (let run = 0; run < 500; run++) {
    const lines = BASE.split("\n");
    for (let k = 0, n = 1 + rand(6); k < n; k++) {
      const at = rand(lines.length);
      const op = rand(4);
      if (op === 0) lines.splice(at, 1);
      else if (op === 1) lines.splice(at, 0, pieces[rand(pieces.length)]);
      else if (op === 2) lines[at] = lines[at].replace(/^#+/, "#".repeat(1 + rand(6)));
      else lines[at] = pieces[rand(pieces.length)];
    }
    const md = lines.join("\n");
    const boards = boardsIn(md);
    unclosedBoard(md);
    boardsSeen += boards.length;
    boards.forEach((b, bi) => {
      for (const p of b.problems) assert.ok(p.from >= b.from && p.to <= b.close && p.from < p.to, md);
      const col = b.columns.findIndex((c) => !c.done && c.cards.length);
      if (col < 0) return;
      const card = b.columns[col].cards[0];
      const without = (text: string, c: { from: number; to: number }) => text.split("\n").filter((_, i) => i < c.from || i >= c.to).join("\n");
      for (const to of b.columns.keys()) {
        if (b.columns[to].done) continue;
        const there = moveCard(md, card.from, { board: bi, column: to }, Infinity, TODAY);
        const moved = boardsIn(there)[bi].columns[to].cards.at(-1)!;
        const pad = md.split("\n")[card.from].match(/^ */)![0].length;
        const lines = md.split("\n").slice(card.from, card.to).map((l) => l.slice(Math.min(pad, l.match(/^ */)![0].length)));
        assert.equal(there.split("\n").slice(moved.from, moved.to).join("\n"), lines.join("\n"), md);
        assert.equal(without(there, moved), without(md, card), md);
      }
    });
  }
  assert.ok(boardsSeen > 200, `only ${boardsSeen} boards survived the edits`);
});

test("with the recurrence engine in, a repeating card moved into Done starts its next week in the first column", () => {
  // Done is the board's first column here, so the next one goes to the first that isn't Done.
  const md = ":::kanban\n## Done\n## To do\n- [ ] Plan\n## Doing\n- [ ] Water plants rec:weekly due:2026-09-28 #home\n:::\n";
  assert.equal(
    moveCard(md, 5, { board: 0, column: 0 }, 0, TODAY),
    `:::kanban\n## Done\n- [x] Water plants rec:weekly due:2026-09-28 #home done:${TODAY}\n## To do\n- [ ] Water plants rec:weekly due:2026-10-05 #home\n- [ ] Plan\n## Doing\n:::\n`,
  );
  // A card that doesn't repeat leaves nothing behind.
  assert.equal(moveCard(":::kanban\n## To do\n- [ ] Other\n## Done\n:::\n", 2, { board: 0, column: 1 }, 0, TODAY), `:::kanban\n## To do\n## Done\n- [x] Other done:${TODAY}\n:::\n`);
});
