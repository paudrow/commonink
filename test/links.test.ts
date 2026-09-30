import { test } from "node:test";
import assert from "node:assert/strict";
import { externalTitle, linkKind } from "../web/src/links.ts";

test("http, https and mailto links leave the app; anything else is a note", () => {
  assert.deepEqual(
    ["https://example.com/a", "HTTP://x.org", "mailto:sam@example.com", " https://a.b ", "commonink:Launch", "Projects/Launch.md", "Launch", "#heading", "ftp-notes.md", "javascript:alert(1)"].map(linkKind),
    ["external", "external", "external", "external", "internal", "internal", "internal", "internal", "internal", "internal"],
  );
});

test("an external link's tooltip names its domain, or the address a mailto writes to", () => {
  assert.deepEqual(
    ["https://www.github.com/paudrow/commonink", "http://docs.example.org:8080/x", "mailto:sam%40acme.test?subject=Hi", "https://", "mailto:%", "mailto:<img src=x onerror=alert(1)>@x.org", "https://%zz"].map(externalTitle),
    ["github.com · opens in your browser", "docs.example.org · opens in your browser", "sam@acme.test · opens in your browser", "Opens in your browser", "Opens in your browser", "Opens in your browser", "Opens in your browser"],
  );
});
