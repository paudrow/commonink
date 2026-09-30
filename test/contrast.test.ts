// WCAG 2.2 AA contrast for the color tokens in web/src/styles.css, in both themes. Text tokens must
// reach 4.5:1 on every surface text sits on; --faint is decoration only and isn't checked.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../web/src/styles.css", import.meta.url), "utf8");

function tokens(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `styles.css has a ${selector} block`);
  const body = css.slice(start, css.indexOf("}", start));
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

const light = tokens(":root");
const dark = tokens(':root[data-theme="dark"]');
const system = tokens(':root:not([data-theme="light"])');
const themes = { light, dark: { ...light, ...dark } };

type RGBA = [number, number, number, number];
function parse(value: string | undefined): RGBA {
  assert.ok(value, "the token is defined");
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)).concat(1) as RGBA;
  const rgba = value.match(/^rgba?\(([^)]+)\)$/);
  assert.ok(rgba, `can read the color ${value}`);
  const [r, g, b, a = 1] = rgba[1].split(",").map(Number);
  return [r, g, b, a];
}
const over = (top: RGBA, bottom: RGBA): RGBA => [0, 1, 2].map((i) => top[i] * top[3] + bottom[i] * (1 - top[3])).concat(1) as RGBA;
const luminance = (c: RGBA) => {
  const lin = (v: number) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
};
export function contrast(fg: RGBA, bg: RGBA): number {
  const [a, b] = [luminance(over(fg, bg)), luminance(bg)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

type Theme = Record<string, string>;
const surfaces: Record<string, (t: Theme) => RGBA> = {
  bg: (t) => parse(t.bg),
  "bg-side": (t) => parse(t["bg-side"]),
  "bg-elev": (t) => parse(t["bg-elev"]),
  "code-bg": (t) => parse(t["code-bg"]),
  "hover on bg": (t) => over(parse(t.hover), parse(t.bg)),
  "active on bg-side": (t) => over(parse(t.active), parse(t["bg-side"])),
};
// Interface text can land on any surface, selected sidebar rows included. Note content (links and
// code) sits on the page, cards and code blocks.
const pairs: { text: string[]; on: string[] }[] = [
  { text: ["ink", "ink-2", "ink-strong", "heading", "muted", "accent-ink", "ok-ink", "warn-ink", "bad-ink"], on: Object.keys(surfaces) },
  { text: ["accent", "c-keyword", "c-string", "c-comment", "c-number", "c-fn", "c-type", "c-prop", "c-punct"], on: ["bg", "bg-elev", "code-bg"] },
];

test("contrast math matches known WCAG ratios", () => {
  assert.equal(contrast(parse("#000000"), parse("#ffffff")).toFixed(2), "21.00");
  assert.equal(contrast(parse("#777777"), parse("#ffffff")).toFixed(2), "4.48");
  assert.equal(contrast(parse("rgba(0, 0, 0, 0.5)"), parse("#ffffff")).toFixed(2), "3.98");
});

test("the system dark theme repeats the explicit dark theme", () => {
  assert.deepEqual(system, dark);
});

for (const [name, t] of Object.entries(themes)) {
  test(`${name} text tokens reach 4.5:1 on every surface`, () => {
    const failures = pairs.flatMap(({ text, on }) =>
      text.flatMap((token) =>
        on.flatMap((surface) => {
          const ratio = contrast(parse(t[token]), surfaces[surface](t));
          return ratio < 4.5 ? [`--${token} on ${surface}: ${ratio.toFixed(2)}`] : [];
        }),
      ),
    );
    assert.deepEqual(failures, []);
  });

  test(`${name} --on-accent reaches 4.5:1 on --accent`, () => {
    const ratio = contrast(parse(t["on-accent"]), parse(t.accent));
    assert.ok(ratio >= 4.5, `--on-accent on --accent is ${ratio.toFixed(2)}`);
  });
}

// Code blocks' diff lines (web/src/code.ts) tint --code-bg and write their text in --ok-ink and
// --bad-ink, which must stay at 4.5:1 over the tint. Marked lines get a bar instead of a tint.
for (const [name, t] of Object.entries(themes)) {
  test(`${name} diff lines in code blocks keep their text at 4.5:1`, () => {
    const tint = css.match(/\.cb-line\.is-add \{ background: color-mix\(in srgb, var\(--ok\) (\d+)%/);
    assert.ok(tint, "styles.css tints added lines with color-mix");
    const alpha = Number(tint[1]) / 100;
    for (const [line, ink] of [["ok", "ok-ink"], ["bad", "bad-ink"]]) {
      const [r, g, b] = parse(t[line]);
      const bg = over([r, g, b, alpha], parse(t["code-bg"]));
      const ratio = contrast(parse(t[ink]), bg);
      assert.ok(ratio >= 4.5, `--${ink} over a ${line} line is ${ratio.toFixed(2)}`);
    }
    assert.match(css, new RegExp(`\\.cb-line\\.is-del \\{ background: color-mix\\(in srgb, var\\(--bad\\) ${tint[1]}%`), "removed lines use the same tint");
    assert.doesNotMatch(css, /\.cb-line\.is-marked \{[^}]*background/, "marked lines have no tint");
  });
}
