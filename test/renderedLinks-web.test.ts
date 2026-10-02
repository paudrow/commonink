// Links in markdown shown outside the editor (note cards, embeds, a board card's details) go where
// the same link in the editor goes.
import "./dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";

const { followRenderedLink } = await import("../web/src/gfm.ts");
const { mountBoard } = await import("../web/src/kanban.ts");

const opened: string[] = [];
(window as unknown as { open: (u: string) => void }).open = (u: string) => void opened.push(`tab ${u}`);

test("a rendered link opens a web page in a tab, a note or calendar link in the app, and leaves mailto: to the browser", () => {
  opened.length = 0;
  const root = document.createElement("div");
  const open = (t: string) => void opened.push(t);
  const hrefs = ["https://example.com", "commonink:Launch%20plan", "Plan.md", "Projects/Spec%20v2.md", "/calendar", "#notes", "javascript:alert(1)", "mailto:sam@example.com"];
  assert.deepEqual(
    hrefs.map((href) => followRenderedLink(href, root, open)),
    [true, true, true, true, true, true, true, false],
  );
  assert.deepEqual(opened, ["tab https://example.com", "Launch plan", "Plan.md", "Projects/Spec v2.md", "/calendar"]);
});

test("a link in a board card's details opens, rather than doing nothing", () => {
  const md = "# Launch\n\n:::kanban\n## Backlog\n- [ ] Ship it\n  See [[Pricing]], [the plan](Plan.md) and [mail](mailto:sam@example.com).\n:::\n";
  const went: string[] = [];
  const ctx = { openTarget: (t: string, from: string) => void went.push(`${t} from ${from}`) } as never;
  const root = document.createElement("div");
  document.body.append(root);
  mountBoard(root, { ctx, path: "Launch.md", text: () => md, write() {}, undo() {}, redo() {}, readOnly: false, editText() {}, resized() {} }, 0);
  const links = [...root.querySelectorAll<HTMLAnchorElement>(".kb-details a")];
  assert.equal(links.length, 3);
  const clicks = links.map((a) => a.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })));
  assert.deepEqual(went, ["Pricing from Launch.md", "Plan.md from Launch.md"]);
  assert.deepEqual(clicks, [false, false, true]); // the app's links are handled; the mailto: goes on to the browser
  root.remove();
});
