// The share dialog's link. A link's URL is its token, which lets anyone in with the link's role, so
// the server sends it only to editors and owners; a viewer is told a link exists, with nothing to copy.
import "./dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";

const LINK = { id: "sh1", note: "plan2345", folder: null, kind: "link", name: null, email: null, role: "editor", expiresAt: null, createdBy: "u1", createdAt: 1 };
let url: string | null;
/** Whether the server takes a change to a share. */
let saves = true;
globalThis.fetch = (async (req: string) => {
  const json = (data: unknown) => new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
  if (req === "/api/members") return json([]);
  if (req === "/api/shares/update") return saves ? json({ ok: true }) : new Response(JSON.stringify({ error: "Only editors can change sharing" }), { status: 403, headers: { "Content-Type": "application/json" } });
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

// A dropdown shows the new choice whether or not it was saved, so the dialog says which happened.
const choose = async (label: string, value: string) => {
  const said: string[] = [];
  await showShareDialog({ path: "Plan.md" }, { canShare: true, toast: (t) => said.push(t.text), changed() {}, workspaceSettings() {} });
  const select = document.querySelector<HTMLSelectElement>(`#share-dialog select[aria-label="${label}"]`)!;
  select.value = value;
  select.dispatchEvent(new window.Event("change"));
  await new Promise((r) => setTimeout(r, 20));
  return said;
};

test("changing the link's role or expiry says it was saved", async () => {
  url = "/s/" + "a".repeat(64);
  saves = true;
  assert.deepEqual(await choose("Link role", "viewer"), ["People with the link can only read now"]);
  assert.deepEqual(await choose("Link expiry", "7"), ["The link works for 7 more days"]);
});

test("a change the server refuses says why, and doesn't say it was saved", async () => {
  url = "/s/" + "a".repeat(64);
  saves = false;
  assert.deepEqual(await choose("Link role", "viewer"), ["Only editors can change sharing"]);
});
