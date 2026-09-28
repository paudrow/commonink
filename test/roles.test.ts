import { test } from "node:test";
import assert from "node:assert/strict";
import { viewerMayWrite } from "../cloud/src/roles.ts";

test("online, a viewer's writes reach a workspace only for what can be their own", () => {
  const allowed = ["POST /favorites/star", "POST /favorites/unstar", "PUT /favorites", "POST /smart-folders", "POST /smart-folders/delete"];
  const refused = ["PUT /note", "POST /note", "POST /move", "POST /archive", "POST /tasks/set", "POST /tags/rename", "PUT /asset-tags", "POST /restore"];
  assert.deepEqual(
    [...allowed, ...refused].map((w) => [w, viewerMayWrite(...(w.split(" ") as [string, string]))]),
    [...allowed.map((w) => [w, true]), ...refused.map((w) => [w, false])],
  );
});
