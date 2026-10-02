// Shared with me: the common page header and empty state, a workspace's notes as rows.
import "./dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderSharedList, sharedPage } from "../web/src/sharedPage.ts";

const note = (id: string, title: string, role: "viewer" | "editor", kind: "md" | "html" | "asset" = "md") => ({ id, path: `Shared/${title}.md`, title, kind, version: "1", role });

test("the page has the same header as the other list pages", () => {
  const { page } = sharedPage();
  assert.ok(page.classList.contains("page"));
  assert.equal(page.querySelector(".page-head h1")!.textContent, "Shared with me");
  assert.ok(page.querySelector(".page-head .page-sub"));
});

test("nothing shared shows the shared empty state", () => {
  const { body } = sharedPage();
  renderSharedList(body, [], () => {});
  assert.equal(body.querySelector(".empty-state b")!.textContent, "Nothing shared with you yet");
  assert.equal(body.querySelector(".sh-row"), null);
});

test("notes are listed under their workspace, each linking to its own page", () => {
  const { body } = sharedPage();
  renderSharedList(body, [{ workspace: { id: "w1", name: "Sam's notes" }, notes: [note("n1", "Plan", "editor"), note("n2", "Read me", "viewer")] }], () => {});
  assert.equal(body.querySelector(".sh-group h2")!.textContent, "Sam's notes2");
  const rows = [...body.querySelectorAll<HTMLAnchorElement>("a.sh-row")];
  assert.deepEqual(
    rows.map((r) => [r.getAttribute("href"), r.querySelector(".sh-title")!.textContent, r.querySelector(".sh-role")!.textContent]),
    [
      ["/shared/w1/n1", "Plan", "Can edit"],
      ["/shared/w1/n2", "Read me", "View only"],
    ],
  );
  assert.equal(body.querySelector(".empty-state"), null);
});

test("a list that couldn't load says so and offers to try again", () => {
  const { body } = sharedPage();
  let retried = 0;
  renderSharedList(body, null, () => retried++);
  assert.equal(body.querySelector(".empty-state b")!.textContent, "Couldn't load what's shared with you");
  body.querySelector<HTMLButtonElement>(".empty-state button")!.click();
  assert.equal(retried, 1);
});
