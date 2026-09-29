// The web app's Content-Security-Policy, the same online (cloud/src/headers.ts) and locally
// (src/server/main.ts). Every allowance is there for something the app does;
// docs/security/threat-model.md says which. No Node imports.

/** Scripts run only from our own files, or inline with this response's `nonce`. `url` is the page's. */
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
