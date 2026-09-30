// Common Ink's service worker, with two jobs and nothing more:
// - keep the app's built files (/assets/…, named by their contents, so they never change) so the
//   installed app starts fast;
// - receive what the phone's share sheet sends (the manifest's share_target), keep it until the
//   app has read it, and open the capture screen.
// It never keeps pages, notes or API answers: those always come from the network (offline notes
// are #35). Served with a policy that lets it fetch only from Common Ink (cloud/src/headers.ts).
const ASSETS = "commonink-assets-v1";
const SHARES = "commonink-shares";
/** Built files kept at most; the oldest go first (each deploy adds new names). */
const KEEP_ASSETS = 300;
/** A share the app never read goes after a week. */
const SHARE_DAYS = 7;
/** Images taken from one share, at most. */
const MAX_FILES = 10;

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (e) =>
  e.waitUntil(
    (async () => {
      for (const name of await caches.keys()) if (name !== ASSETS && name !== SHARES) await caches.delete(name);
      await self.clients.claim();
    })(),
  ),
);

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;
  if (e.request.method === "POST" && url.pathname === "/share") return e.respondWith(receive(e.request));
  if (e.request.method === "GET" && url.pathname.startsWith("/assets/")) e.respondWith(asset(e.request));
});

/** A built file: from the cache, or fetched once and kept. */
async function asset(request) {
  const cache = await caches.open(ASSETS);
  const kept = await cache.match(request);
  if (kept) return kept;
  const res = await fetch(request);
  if (res.ok) {
    await cache.put(request, res.clone());
    const keys = await cache.keys();
    for (const old of keys.slice(0, Math.max(0, keys.length - KEEP_ASSETS))) await cache.delete(old);
  }
  return res;
}

/** A share: its title, text, link and images kept under a new id, then on to /capture?share=<id>. */
async function receive(request) {
  const go = (share) => Response.redirect(new URL(`/capture?share=${share}`, self.location.origin).href, 303);
  let form;
  try {
    form = await request.formData();
  } catch {
    return go("none");
  }
  const cache = await caches.open(SHARES);
  await forgetOld(cache);
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const field = (name) => {
    const v = form.get(name);
    return typeof v === "string" ? v : "";
  };
  const files = form
    .getAll("files")
    .filter((f) => typeof f === "object" && f.size > 0)
    .slice(0, MAX_FILES);
  const meta = { title: field("title"), text: field("text"), url: field("url"), files: files.map((f, i) => ({ name: f.name || `shared-${i + 1}`, type: f.type })) };
  for (const [i, f] of files.entries()) await cache.put(`/shares/${id}/${i}`, new Response(f, { headers: { "Content-Type": f.type || "application/octet-stream" } }));
  await cache.put(`/shares/${id}`, new Response(JSON.stringify(meta), { headers: { "Content-Type": "application/json" } }));
  return go(id);
}

/** Shares older than SHARE_DAYS (the id starts with the time it came in). */
async function forgetOld(cache) {
  const cutoff = Date.now() - SHARE_DAYS * 86_400_000;
  for (const req of await cache.keys()) {
    const id = new URL(req.url).pathname.split("/")[2] ?? "";
    const at = parseInt(id.slice(0, 8), 36);
    if (Number.isFinite(at) && at < cutoff) await cache.delete(req);
  }
}
