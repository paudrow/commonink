// How a note looks on paper and in an exported file (static.ts): print uses it inside the app, and an
// exported HTML file carries it, so it can't lean on the app's stylesheet. Always the light theme.
// Its colors are the app's light tokens (test/export.test.ts keeps them in step with styles.css).

/** The app's light color tokens that a static document uses. */
export const LIGHT_TOKENS: Record<string, string> = {
  bg: "#fbfaf8",
  "bg-side": "#f4f2ee",
  "bg-elev": "#ffffff",
  line: "#e7e3db",
  "line-strong": "#d9d4ca",
  ink: "#26241f",
  "ink-strong": "#14130f",
  "ink-2": "#57534b",
  heading: "#16150f",
  muted: "#65615a",
  accent: "#5b5bd6",
  "accent-ink": "#4545b8",
  "accent-soft": "rgba(91, 91, 214, 0.11)",
  "accent-line": "rgba(91, 91, 214, 0.35)",
  "code-bg": "#f2efe9",
  hover: "rgba(40, 32, 20, 0.05)",
  ok: "#2f9e62",
  warn: "#c7811b",
  bad: "#d4513d",
  "ok-ink": "#217046",
  "warn-ink": "#895913",
  "bad-ink": "#b13927",
  "c-keyword": "#8a3fd1",
  "c-string": "#2d794d",
  "c-comment": "#706b60",
  "c-number": "#aa531d",
  "c-fn": "#2a61c6",
  "c-type": "#9b5a14",
  "c-prop": "#1b7686",
  "c-punct": "#716b61",
  "alert-note": "#0969da",
  "alert-tip": "#1a7f37",
  "alert-important": "#8250df",
  "alert-warning": "#9a6700",
  "alert-caution": "#d1242f",
};

/** GitHub's alert icons, as styles.css draws them (a mask filled with the alert's color). */
export const ALERT_ICONS: Record<string, string> = {
  note: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='black' stroke-width='1.5' stroke-linecap='round'%3E%3Ccircle cx='8' cy='8' r='6.4'/%3E%3Cpath d='M8 7.3v3.9M8 4.9v.1'/%3E%3C/svg%3E")`,
  tip: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='black' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M5.6 10.4a4.4 4.4 0 1 1 4.8 0c-.4.3-.6.8-.6 1.3v.3H6.2v-.3c0-.5-.2-1-.6-1.3ZM6.4 14.3h3.2'/%3E%3C/svg%3E")`,
  important: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='black' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M2.5 3.3a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v7.1a1 1 0 0 1-1 1H7.2l-3 2.4v-2.4h-.7a1 1 0 0 1-1-1Z'/%3E%3Cpath d='M8 4.9v2.8M8 9.5v.1'/%3E%3C/svg%3E")`,
  warning: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='black' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M7.1 2.5a1 1 0 0 1 1.8 0l5.4 9.9a1 1 0 0 1-.9 1.5H2.6a1 1 0 0 1-.9-1.5Z'/%3E%3Cpath d='M8 6v3.1M8 11.2v.1'/%3E%3C/svg%3E")`,
  caution: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='black' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M5.3 1.8h5.4l3.5 3.5v5.4l-3.5 3.5H5.3l-3.5-3.5V5.3Z'/%3E%3Cpath d='M8 4.8v3.6M8 10.8v.1'/%3E%3C/svg%3E")`,
};

const tokens = Object.entries(LIGHT_TOKENS)
  .map(([k, v]) => `--${k}: ${v};`)
  .join(" ");

/** The stylesheet for `.st-doc`, a note rendered for paper or a file. */
export const STATIC_CSS = `
.st-doc { ${tokens}
  --ui: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", system-ui, sans-serif;
  --mono: "JetBrains Mono", "SF Mono", ui-monospace, Menlo, Consolas, monospace;
  color-scheme: light; background: #fff; color: var(--ink); font: 15px/1.65 var(--ui); max-width: 760px; margin: 0 auto; overflow-wrap: anywhere; }
.st-doc :where(h1, h2, h3, h4, h5, h6) { color: var(--heading); line-height: 1.25; letter-spacing: -0.01em; margin: 1.3em 0 0.45em; break-after: avoid; }
.st-doc h1 { font-size: 1.85em; }
.st-doc h2 { font-size: 1.4em; }
.st-doc h3 { font-size: 1.15em; }
.st-doc > :first-child, .st-doc .st-body > :first-child { margin-top: 0; }
.st-doc p { margin: 0.55em 0; }
.st-doc a { color: var(--accent-ink); text-decoration: underline; text-decoration-color: var(--accent-line); text-underline-offset: 2px; }
.st-doc :where(ul, ol) { padding-left: 1.4em; margin: 0.5em 0; }
.st-doc li { margin: 0.15em 0; }
.st-doc li:has(> input[type="checkbox"]) { list-style: none; margin-left: -1.4em; }
.st-doc li > input[type="checkbox"] { margin: 0 0.45em 0 0; vertical-align: -0.1em; accent-color: var(--accent); }
.st-doc blockquote { margin: 0.8em 0; padding: 0.1em 1em; border-left: 3px solid var(--line-strong); color: var(--ink-2); }
.st-doc hr { border: 0; border-top: 1px solid var(--line); margin: 1.6em 0; }
.st-doc img, .st-doc svg { max-width: 100%; height: auto; }
.st-doc img { border-radius: 6px; }
.st-doc table { border-collapse: collapse; margin: 0.9em 0; font-size: 0.92em; break-inside: avoid; }
.st-doc :where(th, td) { border: 1px solid var(--line); padding: 5px 10px; text-align: left; vertical-align: top; }
.st-doc th { background: var(--bg-side); color: var(--ink-strong); font-weight: 600; }
.st-doc :not(pre) > code { font: 0.86em var(--mono); background: var(--code-bg); padding: 0.1em 0.35em; border-radius: 4px; }
.st-doc mark { background: rgba(255, 200, 60, 0.38); color: inherit; }
.st-doc details { margin: 0.6em 0; }
.st-doc summary { font-weight: 600; color: var(--ink-strong); }

/* Task chips (taskChips.ts), as in the app */
.st-doc .tk { display: inline-flex; align-items: center; gap: 4px; margin: 0 2px; padding: 0 7px; border-radius: 999px; background: var(--hover); color: var(--ink-2); font: 500 11.5px/1.6 var(--ui); white-space: nowrap; vertical-align: 0.05em; }
.st-doc .tk svg { flex: none; opacity: 0.75; width: 11px; height: 11px; }
.st-doc .tk-due.is-today { background: color-mix(in srgb, var(--warn) 16%, transparent); color: var(--warn-ink); }
.st-doc .tk-due.is-overdue { background: color-mix(in srgb, var(--bad) 14%, transparent); color: var(--bad-ink); }
.st-doc .tk-priority.is-high { color: var(--bad-ink); }
.st-doc .tk-muted, .st-doc .tk-next { color: var(--muted); }
.st-doc .tk-tag { background: var(--accent-soft); color: var(--accent-ink); }
.st-doc .tk .avatar, :root[data-theme] .st-doc .tk .avatar { width: 13px; height: 13px; border-radius: 50%; display: inline-grid; place-items: center; font: 700 7px/1 var(--ui); background: hsl(var(--hue) 75% 91%) !important; color: hsl(var(--hue) 50% 36%) !important; box-shadow: none; }
.st-doc .is-done-text { color: var(--muted); text-decoration: line-through; }

/* Code blocks (code.ts staticCodeBlock) */
.st-doc .cb { margin: 0.8em 0; border-radius: 8px; background: var(--code-bg); font-size: 0.82em; break-inside: avoid; }
.st-doc .cb-head { display: flex; gap: 8px; padding: 6px 12px 0; font: 650 9.5px/1.4 var(--ui); letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
.st-doc .cb-head .spacer { flex: 1; }
.st-doc .cb-title { font: 600 11px/1.4 var(--mono); letter-spacing: 0; text-transform: none; }
.st-doc .cb-pre { margin: 0; padding: 2px 14px 10px; font: 1em/1.6 var(--mono); white-space: pre-wrap; overflow-wrap: anywhere; color: var(--ink); background: none; }
.st-doc .cb-pre code { display: block; font: inherit; background: none; padding: 0; counter-reset: cb-line; }
.st-doc .cb-line { display: block; min-height: 1.6em; margin: 0 -14px; padding: 0 14px; }
.st-doc .cb-line.is-marked { box-shadow: inset 3px 0 var(--accent-line); }
.st-doc .cb-line.is-add { background: color-mix(in srgb, var(--ok) 8%, transparent); box-shadow: inset 3px 0 var(--ok); }
.st-doc .cb-line.is-add, .st-doc .cb-line.is-add * { color: var(--ok-ink) !important; }
.st-doc .cb-line.is-del { background: color-mix(in srgb, var(--bad) 8%, transparent); box-shadow: inset 3px 0 var(--bad); }
.st-doc .cb-line.is-del, .st-doc .cb-line.is-del * { color: var(--bad-ink) !important; }
.st-doc .cb.has-numbers .cb-line::before { counter-increment: cb-line; content: counter(cb-line); display: inline-block; width: 2.4em; margin-left: -0.4em; padding-right: 1em; text-align: right; color: var(--muted); }
.st-doc .c-keyword { color: var(--c-keyword); }
.st-doc .c-string { color: var(--c-string); }
.st-doc .c-comment { color: var(--c-comment); font-style: italic; }
.st-doc .c-number { color: var(--c-number); }
.st-doc .c-fn { color: var(--c-fn); }
.st-doc .c-type { color: var(--c-type); }
.st-doc .c-prop { color: var(--c-prop); }
.st-doc .c-punct { color: var(--c-punct); }
.st-doc .c-strong { font-weight: 650; }
.st-doc .c-em { font-style: italic; }

/* Math (a file shows the browser's own MathML; print, KaTeX's HTML with the app's stylesheet) */
.st-doc .math-display { display: block; margin: 0.8em 0; text-align: center; overflow-wrap: normal; break-inside: avoid; }
.st-doc .math-error { color: var(--bad-ink); font-family: var(--mono); font-size: 0.85em; white-space: pre-wrap; }
.st-doc .math-display.math-error { text-align: left; }
.st-doc math[display="block"] { margin: 0.2em 0; }

/* GitHub markdown (gfm.ts): alerts, footnotes, keys, emoji */
${Object.entries(ALERT_ICONS)
  .map(([k, url]) => `.st-doc .markdown-alert-${k} { --alert: var(--alert-${k}); --alert-icon: ${url}; }`)
  .join("\n")}
.st-doc .markdown-alert { margin: 0.8em 0; padding: 0.45em 1em; border-left: 0.25em solid var(--alert); color: var(--ink); break-inside: avoid; }
.st-doc .markdown-alert > :last-child { margin-bottom: 0; }
.st-doc .markdown-alert-title { display: flex; align-items: center; gap: 8px; margin: 0 0 0.3em; font-weight: 600; color: var(--alert); }
.st-doc details.markdown-alert > summary.markdown-alert-title { display: list-item; margin: 0; }
.st-doc details.markdown-alert[open] > summary { margin-bottom: 0.3em; }
.st-doc .markdown-alert-icon { display: inline-block; flex: none; width: 16px; height: 16px; background: var(--alert); -webkit-mask: var(--alert-icon) center / contain no-repeat; mask: var(--alert-icon) center / contain no-repeat; vertical-align: -3px; }
.st-doc .footnote-ref a { font-weight: 600; text-decoration: none; }
.st-doc .footnotes { margin-top: 1.6em; padding-top: 0.5em; border-top: 1px solid var(--line); font-size: 0.88em; color: var(--ink-2); }
.st-doc .footnotes ol { padding-left: 1.4em; margin: 0; }
.st-doc .footnote-backref { text-decoration: none; }
.st-doc .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
.st-doc kbd { font: 500 0.8em/1 var(--mono); padding: 0.12em 0.4em; border: 1px solid var(--line-strong); border-bottom-width: 2px; border-radius: 5px; background: var(--bg-elev); }
.st-doc .emoji { font-family: "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif; font-style: normal; }

/* Diagrams, embedded notes, link cards, widgets and boards */
.st-doc .st-diagram { margin: 1em 0; text-align: center; break-inside: avoid; }
.st-doc .st-diagram svg { max-width: 100%; height: auto; }
.st-doc .st-embed { margin: 1em 0; padding: 0.2em 0 0.2em 1em; border-left: 3px solid var(--accent-line); }
.st-doc .st-embed-title, .st-doc .st-widget-title { font: 650 10px/1.4 var(--ui); letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); margin: 0.2em 0 0.3em; }
.st-doc .st-card { display: block; margin: 0.8em 0; padding: 9px 13px; border: 1px solid var(--line); border-radius: 8px; break-inside: avoid; }
.st-doc .st-card-kind { display: block; font: 650 10px/1.4 var(--ui); letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
.st-doc .st-card-title { display: block; color: var(--ink-strong); font-weight: 600; }
.st-doc .st-card a { word-break: break-all; font-size: 0.9em; }
.st-doc .st-widget { margin: 1em 0; padding: 10px 14px; border: 1px solid var(--line); border-radius: 8px; break-inside: avoid-page; }
.st-doc .st-widget ul { margin: 0.2em 0; }
.st-doc .st-widget .st-group { font-weight: 600; color: var(--ink-strong); margin: 0.6em 0 0.1em; }
.st-doc .st-widget .st-empty, .st-doc .st-widget .st-note { color: var(--muted); font-size: 0.92em; }
.st-doc .st-board { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); gap: 10px; margin: 1em 0; break-inside: avoid; }
.st-doc .st-column { padding: 8px 10px; border-radius: 8px; background: var(--bg-side); }
.st-doc .st-column-title { font-weight: 650; color: var(--ink-strong); font-size: 0.92em; margin-bottom: 6px; }
.st-doc .st-column-title .n { color: var(--muted); font-weight: 400; }
.st-doc .st-cardline { margin: 0 0 6px; padding: 6px 8px; border-radius: 6px; background: #fff; border: 1px solid var(--line); font-size: 0.88em; }
.st-doc .st-cardline.is-done { color: var(--muted); text-decoration: line-through; }
.st-doc .st-props { margin: 0 0 1.2em; font-size: 0.88em; }
.st-doc .st-props th { width: 1%; white-space: nowrap; }
.st-doc .st-meta { color: var(--muted); font-size: 0.85em; margin: 0 0 1.4em; }
`;
