// The page HTML notes run in. It asks the app's frame for the note's HTML and writes it in. It carries its
// own policy, so a note's inline scripts run without the app's CSP nonce, and `sandbox allow-scripts`
// gives it an opaque origin even when opened on its own: no cookies, no API, no reaching the app.

export const SANDBOX_PATH = "/sandbox";

const PAGE = `<!doctype html><meta charset="utf-8"><script>
addEventListener("message", function run(e) {
  if (e.source !== parent || typeof (e.data && e.data.commonInkHtml) !== "string") return;
  removeEventListener("message", run);
  document.open();
  document.write(e.data.commonInkHtml);
  document.close();
});
parent.postMessage({ commonInkSandbox: "ready" }, "*");
</script>`;

export const sandboxPage = () =>
  new Response(PAGE, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": "sandbox allow-scripts; frame-ancestors 'self'",
      "Cache-Control": "public, max-age=3600",
    },
  });
