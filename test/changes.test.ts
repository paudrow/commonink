import { test } from "node:test";
import assert from "node:assert/strict";
import { changeVerb } from "../src/core/format.ts";

test("a move within its folder reads as a rename; to another folder, as a move", () => {
  const verb = (from_path: string, path: string) => changeVerb({ op: "move", from_path, path });
  assert.deepEqual(
    [verb("Untitled.md", "Groceries.md"), verb("Projects/Untitled.md", "Projects/Launch.md"), verb("Untitled.md", "Projects/Untitled.md"), verb("Ideas/Plan.md", "Projects/Plan.md")],
    ["renamed", "renamed", "moved", "moved"],
  );
  assert.equal(changeVerb({ op: "archive", from_path: "Plan.md", path: "Archive/Plan.md" }), "archived");
  assert.equal(changeVerb({ op: "edit", from_path: null, path: "Plan.md" }), "edited");
});
