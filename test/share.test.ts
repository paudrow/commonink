// The Share menu (web/src/share.ts), and the two things per-note sharing (#12) plugs into: the
// "Share with people…" slot and the button's shared state.
import "./dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";

const { setShareState, setShareWithPeople, toggleShareMenu } = await import("../web/src/share.ts");

const note = (kind: "md" | "html" = "md") => ({ path: "Plan.md", title: "Plan", kind, url: "https://ink.test/notes/plan-abcd2345", content: () => "# Plan\n" });
const items = () => [...document.querySelectorAll(".share-menu [role=menuitem]")].map((b) => `${b.querySelector("span")?.textContent}${b.hasAttribute("disabled") ? " (off)" : ""}`);

function button() {
  document.body.replaceChildren();
  const b = document.createElement("button");
  b.id = "share-btn";
  document.body.append(b);
  return b;
}

test("the menu has Copy link, Print, the exports, and Google Drive turned off; an HTML note gets its link and its file", () => {
  const b = button();
  toggleShareMenu(b, note(), () => {});
  assert.deepEqual(items(), ["Copy link", "Print…", "Markdown", "Web page", "PDF", "Save to Google Drive (off)"]);
  assert.equal(b.getAttribute("aria-expanded"), "true");
  assert.equal(document.activeElement?.textContent?.startsWith("Copy link"), true, "the first item has the focus");
  document.querySelector(".share-menu")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(document.querySelector(".share-menu"), null, "Escape closes it");
  assert.equal(b.getAttribute("aria-expanded"), "false");
  toggleShareMenu(b, note("html"), () => {});
  assert.deepEqual(items(), ["Copy link", "HTML file", "Save to Google Drive (off)"]);
  toggleShareMenu(b, note("html"), () => {});
  assert.equal(document.querySelector(".share-menu"), null, "pressing the button again closes it");
});

test("per-note sharing fills its slot under Copy link, and lights the button when a note is shared", () => {
  const b = button();
  const shared: string[] = [];
  setShareWithPeople({ label: "Share with people…", icon: "user", run: (n) => void shared.push(n.path) });
  toggleShareMenu(b, note(), () => {});
  assert.deepEqual(items().slice(0, 2), ["Copy link", "Share with people…"]);
  (document.querySelectorAll(".share-menu [role=menuitem]")[1] as HTMLButtonElement).click();
  assert.deepEqual(shared, ["Plan.md"]);
  setShareWithPeople(null);

  setShareState(true);
  assert.ok(b.classList.contains("is-on"));
  assert.match(b.getAttribute("aria-label")!, /^Shared\. Share, print or export/);
  setShareState(false);
  assert.ok(!b.classList.contains("is-on"));
  assert.match(b.getAttribute("aria-label")!, /^Share, print or export/);
});
