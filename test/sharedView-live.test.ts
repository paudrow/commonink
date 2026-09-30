// A note shared with you by name stays live. When sharing changes the server closes the connection
// (4003), and signing out closes it too (4001): the page asks again what's shared, then goes on with
// the role it has now, or ends without keeping the note on screen.
import "./dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";

document.body.append(Object.assign(document.createElement("div"), { id: "app" }));
const NOTE = { id: "plan2345", path: "Plans/Plan.md", title: "Plan", kind: "md", version: "v1", role: "editor", content: "# Plan\n\nThe secret plan.\n" };
let reply: () => Response;
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
globalThis.fetch = (async (url: string) => {
  if (url === "/api/me") return json({ user: { id: "u1", name: "Sam", email: "sam@example.com" }, workspaces: [] });
  if (url === `/api/w/ws1/shared/note?id=${NOTE.id}`) return reply();
  return json({ error: "Not found" }, 404);
}) as typeof fetch;

/** The page's live connections, closed as the server would. */
const sockets: FakeSocket[] = [];
class FakeSocket extends EventTarget {
  constructor(readonly url: string) {
    super();
    sockets.push(this);
  }
  close(code: number) {
    this.dispatchEvent(Object.assign(new Event("close"), { code }));
  }
}
globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;

const { mountSharedView } = await import("../web/src/sharedView.ts");
const until = async (ok: () => boolean) => {
  for (let i = 0; i < 50 && !ok(); i++) await new Promise((r) => setTimeout(r, 5));
  assert.ok(ok());
};
const $ = (s: string) => document.querySelector(s)!;
const buttons = () => [...$(".sv-actions").children].map((b) => b.textContent);

test("sharing changed: the page asks again, and carries on as a viewer, then ends when the share is gone", async () => {
  reply = () => json(NOTE);
  await mountSharedView({ workspace: "ws1", note: NOTE.id });
  assert.equal(sockets.length, 1);
  assert.deepEqual(buttons(), ["Edit", "Your notes"]);

  // Downgraded to a viewer while editing: what was typed stays, read-only, and can't be saved.
  (($(".sv-actions button") as HTMLButtonElement)).click();
  const box = $(".sv-editor") as HTMLTextAreaElement;
  box.value = "My unsaved words";
  reply = () => json({ ...NOTE, role: "viewer", version: "v2", content: "# Plan\n\nChanged.\n" });
  sockets[0].close(4003);
  await until(() => sockets.length === 2);
  assert.match($(".sv-badge").textContent!, /View only/);
  assert.equal(box.readOnly, true);
  assert.equal(box.value, "My unsaved words");
  assert.match($(".sv-status").textContent!, /can only view this now, so your changes can't be saved/);
  assert.deepEqual(buttons(), ["Leave without saving"]);
  ($(".sv-actions button") as HTMLButtonElement).click();
  await until(() => !document.querySelector(".sv-editor"));
  assert.match($(".sv-body").textContent!, /Changed\./);
  assert.deepEqual(buttons(), ["Your notes"]);

  // Unshared: nothing of the note stays on the page, and it stops listening.
  reply = () => json({ error: "That note doesn't exist, or it isn't shared with you" }, 404);
  sockets[1].close(4003);
  await until(() => /isn't shared with you any more/.test($(".sv-title").textContent!));
  assert.doesNotMatch(document.body.textContent!, /Changed|secret plan/);
  assert.equal($(".sv-badge").textContent, "");
  assert.deepEqual(buttons(), ["Your notes"]);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(sockets.length, 2, "no reconnecting to what isn't shared");
});

test("signed out (4001): the page ends and offers to sign in", async () => {
  reply = () => json(NOTE);
  document.querySelectorAll(".sv").forEach((n) => n.remove());
  await mountSharedView({ workspace: "ws1", note: NOTE.id });
  const socket = sockets.at(-1)!;
  reply = () => json({ error: "Sign in first" }, 401);
  const t = Date.now();
  socket.close(4001);
  await new Promise((r) => setTimeout(r, 3100));
  await until(() => /signed out/.test($(".sv-title").textContent!));
  assert.ok(Date.now() - t >= 3000, "a close that isn't about sharing waits before asking again");
  assert.doesNotMatch($(".sv-body").textContent!, /secret plan/);
  assert.deepEqual(buttons(), ["Sign in"]);
});
