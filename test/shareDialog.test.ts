// The share dialog's link. A link's URL is its token, which lets anyone in with the link's role, so
// the server sends it only to editors and owners; a viewer is told a link exists, with nothing to copy.
import "./dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";

const LINK = { id: "sh1", note: "plan2345", folder: null, kind: "link", name: null, email: null, role: "editor", expiresAt: null, createdBy: "u1", createdAt: 1 };
let url: string | null;
globalThis.fetch = (async (req: string) => {
  const json = (data: unknown) => new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
  if (req === "/api/members") return json([]);
  if (req.startsWith("/api/shares")) return json({ target: { note: LINK.note }, path: "Plan.md", shares: [{ ...LINK, url }], inherited: [] });
  return new Response("{}", { status: 404 });
}) as typeof fetch;

const { showShareDialog } = await import("../web/src/shareDialog.ts");
const open = async (canShare: boolean) => {
  await showShareDialog({ path: "Plan.md" }, { canShare, toast() {}, changed() {}, workspaceSettings() {} });
  const dialog = document.querySelector("#share-dialog")!;
  const buttons = [...dialog.querySelectorAll("button")].map((b) => b.textContent);
  return { buttons, text: dialog.textContent! };
};

test("an editor can copy the link", async () => {
  url = "/s/" + "a".repeat(64);
  const { buttons, text } = await open(true);
  assert.ok(buttons.includes("Copy link"));
  assert.doesNotMatch(text, /Only editors can copy/);
});

test("a viewer gets no URL, so no Copy link: they're told who can", async () => {
  url = null;
  const { buttons, text } = await open(false);
  assert.ok(!buttons.includes("Copy link"));
  assert.match(text, /Anyone with the link/);
  assert.match(text, /Only editors can copy this link/);
  assert.doesNotMatch(text, /null|undefined/);
});
