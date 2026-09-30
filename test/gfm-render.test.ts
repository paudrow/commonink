// GitHub-flavored markdown in rendered notes, and what the HTML allowlist lets through.
import "./dom.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpuMs } from "./helpers.ts";

const { renderMarkdown } = await import("../web/src/render.ts");
const r = (md: string) => renderMarkdown(md, "Notes/a.md");

test("alerts render as GitHub's callouts; Obsidian's folding ones as <details>", () => {
  assert.equal(
    r("> [!NOTE]\n> Useful **info**."),
    '<div class="markdown-alert markdown-alert-note"><p class="markdown-alert-title"><span class="markdown-alert-icon" aria-hidden="true"></span>Note</p><p>Useful <strong>info</strong>.</p>\n</div>\n',
  );
  assert.equal(
    r("> [!warning]- Mind the gap\n> Step carefully."),
    '<details class="markdown-alert markdown-alert-warning"><summary class="markdown-alert-title"><span class="markdown-alert-icon" aria-hidden="true"></span>Mind the gap</summary><p>Step carefully.</p>\n</details>\n',
  );
  assert.match(r("> [!tip]+\n> Open."), /^<details class="markdown-alert markdown-alert-tip" open="">/);
  assert.equal(r("> Just a quote"), "<blockquote>\n<p>Just a quote</p>\n</blockquote>\n");
});

test("an alert's first paragraph reads like any other: footnotes, emoji, math and GitHub's HTML in it render", () => {
  const html = r("> [!NOTE]\n> See this[^src] :tada: <kbd>K</kbd> and $x^2$.\n> Second line[^src].\n\n[^src]: The source.");
  const body = html.slice(html.indexOf("</p>") + 4, html.indexOf("</div>"));
  assert.match(body, /^<p>See this<sup class="footnote-ref"><a href="#user-content-fn-src" title="The source\." id="user-content-fnref-src">1<\/a><\/sup> /);
  assert.match(body, /<span class="emoji" title=":tada:">🎉<\/span>/);
  assert.match(body, /<kbd>K<\/kbd>/);
  assert.match(body, /<span class="math" data-tex="x\^2">/);
  assert.match(body, /Second line<sup class="footnote-ref"><a href="#user-content-fn-src" title="The source\." id="user-content-fnref-src-2">1<\/a><\/sup>\./);
  assert.match(html, /<section class="footnotes"/);
  // Read once more, not once per line or per token: twice the input takes about twice as long.
  const time = (md: string) => {
    let best = Infinity;
    for (let i = 0; i < 3; i++) {
      const t = performance.now();
      r(md);
      best = Math.min(best, performance.now() - t);
    }
    return best;
  };
  for (const unit of ["[^a", "$a ", ":a", "<kbd>k</kbd> ", "x[^s] \n> "]) {
    const alert = (n: number) => `> [!NOTE]\n> ${unit.repeat(n)}\n\n[^s]: S.`;
    const [once, twice] = [time(alert(8_000)), time(alert(16_000))];
    assert.ok(twice < 3 * once + 20, `${JSON.stringify(unit)} in an alert grows faster than its input: ${Math.round(once)} ms, then ${Math.round(twice)} ms`);
  }
  // The same in a folding one.
  assert.match(r("> [!tip]- Title\n> See[^a].\n\n[^a]: A."), /<summary class="markdown-alert-title">.*Title<\/summary><p>See<sup class="footnote-ref">/);
});

test("footnotes: numbered references with the note's text as a tooltip, and a list with ways back", () => {
  assert.equal(
    r("Fact[^src] and another[^src].\n\n[^src]: From *the* report."),
    '<p>Fact<sup class="footnote-ref"><a href="#user-content-fn-src" title="From *the* report." id="user-content-fnref-src">1</a></sup> and another<sup class="footnote-ref"><a href="#user-content-fn-src" title="From *the* report." id="user-content-fnref-src-2">1</a></sup>.</p>\n' +
      '<section class="footnotes" data-footnotes=""><h2 class="sr-only">Footnotes</h2><ol><li value="1" id="user-content-fn-src">From <em>the</em> report. <a href="#user-content-fnref-src" class="footnote-backref" aria-label="Back to reference 1">↩</a></li></ol></section>',
  );
  assert.equal(r("No def[^x] here."), "<p>No def[^x] here.</p>\n");
});

test("headings get GitHub's anchors, and emoji shortcodes their emoji", () => {
  assert.equal(r("## What's new? :tada:"), '<h2 id="user-content-whats-new-tada">What\'s new? <span class="emoji" title=":tada:">🎉</span></h2>\n');
  assert.equal(r("At 10:30:00, `:tada:` and :nope:"), "<p>At 10:30:00, <code>:tada:</code> and :nope:</p>\n");
});

test("GitHub's HTML goes through: kbd, sub, sup, br, a sized image, and a picture for light and dark", () => {
  assert.equal(r("Press <kbd>⌘</kbd> <kbd>K</kbd>. H<sub>2</sub>O, x<sup>2</sup><br>next"), "<p>Press <kbd>⌘</kbd> <kbd>K</kbd>. H<sub>2</sub>O, x<sup>2</sup><br>next</p>\n");
  const img = r('<img src="logo.png" width="120" height="40" alt="Logo">');
  assert.match(img, /^<img src="\/api\/file-resolve\?target=logo\.png&amp;from=Notes%2Fa\.md" width="120" height="40" alt="Logo">/);
  const pic = r('<picture>\n<source media="(prefers-color-scheme: dark)" srcset="night.svg">\n<img src="day.svg" alt="Chart">\n</picture>');
  assert.match(pic, /<source media="\(prefers-color-scheme: dark\)" srcset="\/api\/file-resolve\?target=night\.svg&amp;from=Notes%2Fa\.md">/);
});

test("footnotes and emoji keep hostile markdown linear", () => {
  const slow = [["50k [^", "[^".repeat(50_000)], ["50k :a", ":a".repeat(50_000)], ["50k [^a", "[^a".repeat(50_000)]].flatMap(([name, md]) => {
    const ms = cpuMs(() => r(md));
    return ms > 1500 ? [`${name}: ${Math.round(ms)} ms`] : [];
  });
  assert.deepEqual(slow, []);
});

test("nothing else gets through:event handlers, script URLs in srcset or src, scripts, styles", () => {
  const hostile = [
    '<img src=x onerror="alert(1)">',
    '<picture><source srcset="javascript:alert(1)"><img src="a.png"></picture>',
    '<img srcset="good.png 1x, javascript:alert(1) 2x" src="a.png">',
    '<img srcset="data:image/svg+xml,<svg onload=alert(1)>" src="a.png">',
    '<source src="javascript:alert(1)">',
    '<kbd onclick="alert(1)" style="color:red">x</kbd>',
    '<sub><script>alert(1)</script></sub>',
    '<details ontoggle="alert(1)" open><summary>s</summary></details>',
    "> [!NOTE]\n> <img src=x onerror=alert(1)>",
    "[^x]: <img src=x onerror=alert(1)>\n\nref[^x]",
    '[^a"onmouseover="alert(1)]: t\n\nref[^a"onmouseover="alert(1)]',
  ];
  const box = document.createElement("div");
  for (const md of hostile) {
    box.innerHTML = r(md);
    const bad = [...box.querySelectorAll("*")].flatMap((el) =>
      el.localName === "script" || el.localName === "style"
        ? [el.localName]
        : [...el.attributes].filter((a) => /^on|^style$/i.test(a.name) || (/src|href/i.test(a.name) && /javascript:|data:/i.test(a.value))).map((a) => `${el.localName}[${a.name}]`),
    );
    assert.deepEqual(bad, [], `${md}\n→ ${box.innerHTML}`);
  }
});
