import { test } from "node:test";
import assert from "node:assert/strict";
import { changeVerb, groupChanges } from "../src/core/format.ts";
import { openTempVault } from "./helpers.ts";

test("a run of autosaves counts its net change, the same as the diff of that run", () => {
  const { quire } = openTempVault();
  quire.create("Churn.md", "# Churn\n\none\ntwo\n", "you");
  quire.save("Churn.md", "# Churn\n\none\ntwo\nthree\nfour\nfive\nsix\n", { source: "you" });
  quire.save("Churn.md", "# Churn\n\nONE\ntwo\nthree\n", { source: "you" });
  quire.save("Churn.md", "# Churn\n\nONE\ntwo\nthree\nfour\n", { source: "you" });
  const [saves, created] = groupChanges(quire.changes({ path: "Churn.md" }));
  assert.deepEqual([saves.count, saves.summary, created.op], [3, "+6 −4", "create"]);
  const ids = [saves.first, saves.first + 1, saves.id];
  assert.deepEqual(quire.diffSet(ids)[0].runs.map((r) => r.stat), [{ add: 3, del: 1 }]);
  assert.deepEqual(quire.diffStats([ids, [created.id], [saves.id], [999]]), [{ add: 3, del: 1 }, { add: 4, del: 0 }, { add: 1, del: 0 }, null]);
});

test("a move within its folder reads as a rename; to another folder, as a move", () => {
  const verb = (from_path: string, path: string) => changeVerb({ op: "move", from_path, path });
  assert.deepEqual(
    [verb("Untitled.md", "Groceries.md"), verb("Projects/Untitled.md", "Projects/Launch.md"), verb("Untitled.md", "Projects/Untitled.md"), verb("Ideas/Plan.md", "Projects/Plan.md")],
    ["renamed", "renamed", "moved", "moved"],
  );
  assert.equal(changeVerb({ op: "archive", from_path: "Plan.md", path: "Archive/Plan.md" }), "archived");
  assert.equal(changeVerb({ op: "edit", from_path: null, path: "Plan.md" }), "edited");
});
