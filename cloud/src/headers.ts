// Security headers on everything the Worker sends. Every allowance in the app's policy is there for
// something the app does; docs/security/threat-model.md says which.

/** The app's policy. Scripts run only from our own files, or inline with this response's nonce. */
export function appPolicy(nonce: string, url: URL) {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    // CodeMirror, mermaid and the widgets set styles at runtime. Styles can't run code.
    "style-src 'self' 'unsafe-inline'",
    // Pasted images, link-card images and favicons come from anywhere on the web.
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: https:",
    "font-src 'self' data:",
    // Live updates, and Bluesky's handle lookup for post embeds.
    `connect-src 'self' ${url.protocol === "https:" ? "wss" : "ws"}://${url.host} https://public.api.bsky.app`,
    // HTML notes (in /sandbox, which has its own policy) and embeds: YouTube, X, Mastodon on any server…
    "frame-src 'self' https:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/** Anything else we send that has no policy of its own (JSON, redirects, icons). */
const NOTHING = "default-src 'none'; frame-ancestors 'none'";

const COMMON: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  // Other sites see our origin, never a note's URL (it has the title in it).
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), hid=(), midi=(), browsing-topics=()",
  "Cross-Origin-Opener-Policy": "same-origin",
};

/** Add the security headers to a response. HTML pages get a fresh nonce on each of their scripts. */
export function secure(res: Response, url: URL): Response {
  if (res.status === 101) return res; // a WebSocket: nothing to add, and its headers can't change
  const out = new Response(res.body, res);
  const h = out.headers;
  for (const [k, v] of Object.entries(COMMON)) if (!h.has(k)) h.set(k, v);
  if (url.protocol === "https:") h.set("Strict-Transport-Security", "max-age=31536000");
  if (h.has("Content-Security-Policy")) return out;
  if (!String(h.get("Content-Type")).startsWith("text/html")) {
    h.set("Content-Security-Policy", NOTHING);
    return out;
  }
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
  h.set("Content-Security-Policy", appPolicy(nonce, url));
  // The nonce is new every time, so the page can't be reused from a cache.
  h.set("Cache-Control", "no-store");
  h.delete("ETag");
  h.delete("Last-Modified");
  return new HTMLRewriter()
    .on("script", {
      element(el) {
        el.setAttribute("nonce", nonce);
      },
    })
    .transform(out);
}

/**
 * Ask the static assets for a file. Conditional headers are dropped: a "304 Not Modified" would
 * pair a cached page (and its old nonce) with this response's new policy, and nothing would run.
 */
export function fetchAsset(assets: Fetcher, req: Request) {
  const headers = new Headers(req.headers);
  headers.delete("If-None-Match");
  headers.delete("If-Modified-Since");
  return assets.fetch(new Request(req, { headers }));
}
