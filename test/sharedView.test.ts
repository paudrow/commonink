// A shared link's page: the note it shares, and nothing of what it links or embeds unless that's
// shared too. The server answers "no access" (never a title); the page must show that, not guess.
import "./dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";

document.body.append(Object.assign(document.createElement("div"), { id: "app" }));
const TOKEN = "a".repeat(64);
const PAGE = {
  id: "page2345",
  path: "Try/Public page.md",
  title: "Public page",
  kind: "md",
  version: "v1",
  role: "viewer",
  content:
    "# Public page\n\nIt links [[Secret numbers]] and [[Also public]], and embeds:\n\n![[Secret numbers]]\n\n::query{tag=hush}\n\n" +
    "> [!NOTE]\n> In a callout: ![[Secret numbers]]\n\nA footnote.[^1]\n\n[^1]: About [[Secret numbers]].\n",
};
const requests: string[] = [];
globalThis.fetch = (async (url: string) => {
  requests.push(url);
  const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
  if (url === "/api/me") return reply({ error: "Sign in first", devLogin: false }, 401);
  if (url === `/api/s/${TOKEN}/list`) return reply([{ id: PAGE.id }]);
  if (url === `/api/s/${TOKEN}/note?id=${PAGE.id}`) return reply(PAGE);
  if (url.startsWith(`/api/s/${TOKEN}/resolve?target=Also%20public`)) return reply({ id: "also2345", path: "Try/Also public.md", title: "Also public", kind: "md", version: "v", role: "viewer" });
  if (url.startsWith(`/api/s/${TOKEN}/resolve?`)) return reply({ noAccess: true });
  return reply({ error: "Not found" }, 404);
}) as typeof fetch;

const { mountSharedView, sharedRoute } = await import("../web/src/sharedView.ts");

test("a link page shows its note; a link or embed to what isn't shared says no access, and widgets don't run", async () => {
  assert.deepEqual([sharedRoute(`/s/${TOKEN}`), sharedRoute("/shared/ws123/abcd2345"), sharedRoute("/s/short"), sharedRoute("/notes")], [{ link: TOKEN }, { workspace: "ws123", note: "abcd2345" }, null, null]);
  await mountSharedView({ link: TOKEN });
  for (let i = 0; i < 20 && document.querySelectorAll(".sv-noaccess").length === 0; i++) await new Promise((r) => setTimeout(r, 10));
  const body = document.querySelector(".sv-body")!;
  assert.equal(document.querySelector(".sv-title")!.textContent, "Public page");
  assert.equal((document.querySelector("#app") as HTMLElement).hidden, true, "no workspace around it");
  assert.equal(document.querySelectorAll(".sv-noaccess").length, 2, "the embeds, in the body and in a callout");
  assert.deepEqual([...body.querySelectorAll(".sv-dead")].map((n) => n.textContent), ["Secret numbers", "Secret numbers"], "links (the footnote's too) keep the words the note itself wrote, but go nowhere");
  assert.equal(body.querySelector<HTMLAnchorElement>('a[href*="also2345"]')?.getAttribute("href"), `/s/${TOKEN}?note=also2345`);
  assert.match(body.textContent ?? "", /A query widget: it shows only inside the workspace/);
  assert.equal(requests.some((u) => /\/(search|feed|tasks|notes)\b/.test(u)), false, "it asks for nothing else of the workspace");
  assert.equal(document.querySelector('meta[name="robots"]')?.getAttribute("content"), "noindex, nofollow");
  assert.equal(document.querySelector(".sv-actions")!.textContent, "Sign in");
});
