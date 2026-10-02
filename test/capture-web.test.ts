// The capture screen's saving: which note a share goes to (made if missing), under Captured, through
// the note API (so its role checks apply), putting the capture in again if the note changed meanwhile.
// And reading a share back from where the service worker kept it.
import "./dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";

const { saveCapture, readShare, forgetShare } = await import("../web/src/capture.ts");
const { today } = await import("../web/src/taskChips.ts");

/** A fake note API over a map of notes; `conflicts` 409s that many saves first. */
function server(start: Record<string, string>, o: { conflicts?: number; role?: "editor" | "viewer" } = {}) {
  const notes = new Map(Object.entries(start));
  let version = 1;
  const versions = new Map([...notes.keys()].map((p) => [p, String(version++)]));
  let conflicts = o.conflicts ?? 0;
  const calls: string[] = [];
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  globalThis.fetch = (async (input: string, init?: RequestInit) => {
    const url = new URL(input, "http://localhost");
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push(`${method} ${url.pathname}`);
    const write = () => {
      if (o.role === "viewer") return reply(403, { error: "Viewers can't change notes" });
      return null;
    };
    if (url.pathname === "/api/today/journal") {
      const path = `Journal/${body.today}.md`;
      if (!notes.has(path)) (write() ?? 0, notes.set(path, `# ${body.today}\n\n## Tasks\n\n## Log\n`), versions.set(path, String(version++)));
      return reply(200, { path, created: true });
    }
    if (url.pathname === "/api/resolve") {
      const t = url.searchParams.get("target")!;
      return reply(200, { path: [...notes.keys()].find((p) => p.replace(/\.md$/, "").toLowerCase() === t.toLowerCase()) ?? null });
    }
    if (url.pathname === "/api/note" && method === "GET") {
      const path = url.searchParams.get("path")!;
      return notes.has(path) ? reply(200, { path, content: notes.get(path), version: versions.get(path) }) : reply(404, { error: "No such note" });
    }
    if (url.pathname === "/api/note" && method === "POST") {
      const denied = write();
      if (denied) return denied;
      if (notes.has(body.path)) return reply(409, { error: "Exists" });
      notes.set(body.path, body.content);
      versions.set(body.path, String(version++));
      return reply(200, { path: body.path, version: versions.get(body.path) });
    }
    if (url.pathname === "/api/note" && method === "PUT") {
      const denied = write();
      if (denied) return denied;
      if (conflicts > 0 || body.baseVersion !== versions.get(body.path)) {
        if (conflicts-- > 0) {
          notes.set(body.path, `${notes.get(body.path)}\nSomeone else's line\n`);
          versions.set(body.path, String(version++));
        }
        return reply(409, { error: "Changed meanwhile" });
      }
      notes.set(body.path, body.content);
      versions.set(body.path, String(version++));
      return reply(200, { path: body.path, version: versions.get(body.path) });
    }
    return reply(404, { error: `unexpected ${method} ${url.pathname}` });
  }) as typeof fetch;
  return { notes, calls };
}

const hooks = (names: string[] = []) => ({ notes: () => [], upload: async () => names });

test("by default a share goes to today's journal note, made from the journal template, under Captured", async () => {
  const s = server({});
  const r = await saveCapture({ kind: "today" }, { title: "Rust 2027", url: "https://example.com/rust" }, [], hooks());
  const day = today();
  assert.equal(r.path, `Journal/${day}.md`);
  assert.equal(s.notes.get(r.path), `# ${day}\n\n## Tasks\n\n## Log\n\n## Captured\n\nRust 2027\n\nhttps://example.com/rust\n`);
  assert.equal(r.line, 9);
});

test("Inbox is made if it isn't there; a picked note that doesn't exist yet is made too; images are embedded", async () => {
  const s = server({ "Ideas.md": "# Ideas\n" });
  await saveCapture({ kind: "inbox" }, { text: "Call Sam" }, [], hooks());
  assert.equal(s.notes.get("Inbox.md"), "# Inbox\n\n## Captured\n\nCall Sam\n");
  await saveCapture({ kind: "note", name: "ideas" }, { text: "A thought" }, [new File(["x"], "a.png", { type: "image/png" })], hooks(["a.png"]));
  assert.equal(s.notes.get("Ideas.md"), "# Ideas\n\n## Captured\n\nA thought\n\n![[a.png]]\n");
  await saveCapture({ kind: "note", name: "Reading list" }, { url: "https://example.com/b" }, [], hooks());
  assert.equal(s.notes.get("Reading list.md"), "# Reading list\n\n## Captured\n\nhttps://example.com/b\n");
});

test("if the note changed meanwhile, the capture goes into the new version; a viewer's save is refused by the API", async () => {
  const s = server({ "Inbox.md": "# Inbox\n" }, { conflicts: 1 });
  await saveCapture({ kind: "inbox" }, { text: "Mine" }, [], hooks());
  assert.equal(s.notes.get("Inbox.md"), "# Inbox\n\nSomeone else's line\n\n## Captured\n\nMine\n");
  assert.deepEqual(s.calls.filter((c) => c === "PUT /api/note").length, 2);
  server({ "Inbox.md": "# Inbox\n" }, { role: "viewer" });
  await assert.rejects(saveCapture({ kind: "inbox" }, { text: "Nope" }, [], hooks()), /Viewers can't change notes/);
  await assert.rejects(saveCapture({ kind: "inbox" }, {}, [], hooks()), /nothing to save/);
});

test("a share the service worker kept is read back, images and all, and forgotten once it's used", async () => {
  const store = new Map<string, Response>();
  const k = (r: Request | string) => new URL(typeof r === "string" ? r : r.url, "http://localhost").href;
  (globalThis as Record<string, unknown>).caches = {
    open: async () => ({
      match: async (r: string) => store.get(k(r))?.clone(),
      keys: async () => [...store.keys()].map((u) => new Request(u)),
      delete: async (r: Request) => store.delete(k(r)),
    }),
  };
  store.set(k("/shares/abc123"), new Response(JSON.stringify({ title: "T", text: "X", url: "https://e.x/", files: [{ name: "p.png", type: "image/png" }] })));
  store.set(k("/shares/abc123/0"), new Response("bytes"));
  store.set(k("/shares/other"), new Response("{}"));
  const got = (await readShare("abc123"))!;
  assert.deepEqual(got.shared, { title: "T", text: "X", url: "https://e.x/" });
  assert.deepEqual([got.files[0].name, got.files[0].type, await got.files[0].text()], ["p.png", "image/png", "bytes"]);
  assert.equal(await readShare("../evil"), null, "only a share's own id");
  assert.equal(await readShare("gone"), null);
  await forgetShare("abc123");
  assert.deepEqual([...store.keys()], [k("/shares/other")]);
});
