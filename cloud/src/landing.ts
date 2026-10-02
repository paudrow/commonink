// The front page for people who aren't signed in: what Common Ink is, and the way in. One small page
// with its styles inline and no script, so it shows at once; signed in, `/` is the app instead.
import logo from "../../brand/logo.svg";

const TITLE = "Common Ink: notes any agent can work in";
const DESCRIPTION = "One place for your notes, tasks, calendar, people and code, where Claude, Cursor and your own scripts work alongside you, and every change shows who made it.";

/** The landing page. Get started is Google sign-in, or developer sign-in where that's on (Previews). */
export function landingPage(url: URL, devLogin: boolean): Response {
  // Arriving at `/?w=…` (say) comes back there after signing in.
  const next = url.search ? `?next=${encodeURIComponent(`/${url.search}`)}` : "";
  const signIn = `/auth/${devLogin ? "dev" : "google"}${next}`;
  const origin = url.origin;
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${TITLE}</title>
<meta name="description" content="${DESCRIPTION}">
<link rel="canonical" href="${origin}/">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Common Ink">
<meta property="og:url" content="${origin}/">
<meta property="og:title" content="${TITLE}">
<meta property="og:description" content="${DESCRIPTION}">
<meta property="og:image" content="${origin}/social.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Common Ink">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#fbfaf8" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#16171a" media="(prefers-color-scheme: dark)">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<style>
:root {
  color-scheme: light dark;
  --ui: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", system-ui, sans-serif;
  --mono: "JetBrains Mono", "SF Mono", ui-monospace, Menlo, Consolas, monospace;
  --bg: #fbfaf8; --bg-elev: #fff; --bg-side: #f4f2ee; --line: #e7e3db; --ink: #26241f; --heading: #16150f;
  --muted: #65615a; --accent: #5b5bd6; --accent-ink: #4545b8; --on-accent: #fff; --accent-soft: rgba(91, 91, 214, 0.11);
  --code-bg: #f2efe9; --ok: #2f7a50; --hue: 262; --tag: hsl(var(--hue) 55% 40%);
  --shadow: 0 1px 2px rgba(30, 25, 15, 0.06), 0 12px 32px rgba(30, 25, 15, 0.08);
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #16171a; --bg-elev: #1d1e22; --bg-side: #111214; --line: #2a2b30; --ink: #e6e3dc; --heading: #f4f2ec;
    --muted: #a19d95; --accent: #9090f7; --accent-ink: #a9a9ff; --on-accent: #16171a; --accent-soft: rgba(144, 144, 247, 0.14);
    --code-bg: #24252a; --ok: #6cc896; --tag: hsl(var(--hue) 90% 80%);
    --shadow: 0 1px 2px rgba(0, 0, 0, 0.3), 0 12px 32px rgba(0, 0, 0, 0.35);
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.6 var(--ui); -webkit-font-smoothing: antialiased; }
a { color: var(--accent-ink); }
a:focus-visible, summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; border-radius: 6px; }
code { font: 0.88em var(--mono); background: var(--code-bg); padding: 1px 5px; border-radius: 5px; }
.wrap { max-width: 1040px; margin: 0 auto; padding: 0 20px; }
.skip { position: absolute; left: -9999px; }
.skip:focus { left: 16px; top: 12px; background: var(--bg-elev); padding: 8px 12px; border-radius: 8px; z-index: 1; }

header { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 18px 0; }
.brand { display: flex; align-items: center; gap: 10px; color: var(--heading); text-decoration: none; font-weight: 650; font-size: 17px; }
.brand svg { width: 30px; height: 30px; }
.signin { color: var(--ink); text-decoration: none; font-weight: 550; padding: 8px 14px; border-radius: 10px; border: 1px solid var(--line); }
.signin:hover { background: var(--accent-soft); }

.btn { display: inline-flex; align-items: center; justify-content: center; min-height: 46px; padding: 0 22px; border-radius: 12px; background: var(--accent-ink); color: var(--on-accent); font-weight: 650; text-decoration: none; }
@media (prefers-color-scheme: dark) { .btn { background: var(--accent); } }
.btn:hover { filter: brightness(1.08); }
.btn.quiet { background: transparent; color: var(--ink); border: 1px solid var(--line); }
.btn.quiet:hover { background: var(--accent-soft); filter: none; }
.ctas { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 26px; }
.fine { color: var(--muted); font-size: 14px; margin: 12px 0 0; }

.hero { display: grid; grid-template-columns: 1fr 1.05fr; gap: 48px; align-items: center; padding: 48px 0 72px; }
h1 { font-size: clamp(36px, 6vw, 54px); line-height: 1.08; letter-spacing: -0.025em; color: var(--heading); margin: 0; }
.lede { font-size: 19px; color: var(--muted); margin: 18px 0 0; max-width: 32em; }

/* The hero's picture: a note in the editor while an agent adds a line to it. */
.note { margin: 0; background: var(--bg-elev); border: 1px solid var(--line); border-radius: 16px; box-shadow: var(--shadow); overflow: hidden; }
.note-bar { display: flex; align-items: center; gap: 6px; padding: 11px 14px; background: var(--bg-side); border-bottom: 1px solid var(--line); font-size: 13px; color: var(--muted); }
.note-bar i { width: 10px; height: 10px; border-radius: 50%; background: var(--line); }
.note-bar span { margin-left: 8px; }
.note-bar .live { margin-left: auto; display: inline-flex; align-items: center; gap: 6px; }
.note-bar .live::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: var(--ok); }
.note-body { padding: 18px 22px 22px; font-size: 15px; }
.note-body h2 { font-size: 21px; margin: 0 0 10px; color: var(--heading); }
.note-body p { margin: 0 0 10px; }
.task { display: flex; align-items: baseline; gap: 9px; padding: 3px 8px; margin: 0 -8px; border-radius: 6px; }
.box { flex: none; width: 15px; height: 15px; border: 1.5px solid var(--muted); border-radius: 4px; transform: translateY(2px); }
.done .box { background: var(--accent); border-color: var(--accent); }
.done .words { color: var(--muted); text-decoration: line-through; }
.chip { font-size: 12px; padding: 1px 8px; border-radius: 999px; background: var(--accent-soft); color: var(--accent-ink); white-space: nowrap; }
.agent { background-color: hsl(var(--hue) 80% 62% / 0.16); box-shadow: inset 3px 0 0 hsl(var(--hue) 70% 58%); flex-wrap: wrap; }
.agent .words { display: inline-block; overflow: hidden; white-space: nowrap; vertical-align: bottom; max-width: 100%; }
.who { font-size: 11px; font-weight: 650; padding: 2px 8px; border-radius: 999px; color: var(--tag); background: hsl(var(--hue) 80% 62% / 0.16); white-space: nowrap; }
@media (prefers-reduced-motion: no-preference) {
  .agent { animation: line 9s ease-out infinite; }
  .agent .words { animation: type 9s steps(34, end) infinite; }
  .who { animation: tag 9s ease-out infinite; }
  @keyframes line {
    0%, 12% { opacity: 0; background-color: hsl(var(--hue) 80% 62% / 0); box-shadow: inset 3px 0 0 hsl(var(--hue) 70% 58% / 0); }
    14%, 60% { opacity: 1; background-color: hsl(var(--hue) 80% 62% / 0.16); box-shadow: inset 3px 0 0 hsl(var(--hue) 70% 58%); }
    90% { background-color: hsl(var(--hue) 80% 62% / 0); box-shadow: inset 3px 0 0 hsl(var(--hue) 70% 58% / 0); }
    100% { opacity: 1; background-color: hsl(var(--hue) 80% 62% / 0); box-shadow: inset 3px 0 0 hsl(var(--hue) 70% 58% / 0); }
  }
  @keyframes type { 0%, 14% { max-width: 0; } 40%, 100% { max-width: 100%; } }
  @keyframes tag { 0%, 14% { opacity: 0; } 18%, 60% { opacity: 1; } 90%, 100% { opacity: 0; } }
}

section { padding: 64px 0; border-top: 1px solid var(--line); }
h2.title { font-size: clamp(26px, 4vw, 34px); line-height: 1.2; letter-spacing: -0.015em; color: var(--heading); margin: 0 0 10px; }
.intro { color: var(--muted); font-size: 18px; margin: 0 0 30px; max-width: 36em; }
.grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
.grid.five { grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); }
.card { background: var(--bg-elev); border: 1px solid var(--line); border-radius: 14px; padding: 18px 20px; }
.card h3 { font-size: 17px; margin: 0 0 6px; color: var(--heading); }
.card p { margin: 0; color: var(--muted); font-size: 15px; }
.split { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }

details { border-bottom: 1px solid var(--line); padding: 4px 0; max-width: 46em; }
summary { cursor: pointer; font-weight: 600; color: var(--heading); padding: 12px 0; list-style-position: outside; }
details p { margin: 0 0 14px; color: var(--muted); }

.end { text-align: center; }
.end .intro { margin-left: auto; margin-right: auto; }
.end .ctas { justify-content: center; }
footer { border-top: 1px solid var(--line); padding: 26px 0 40px; color: var(--muted); font-size: 14px; display: flex; flex-wrap: wrap; gap: 8px 22px; }
footer a { color: var(--muted); }

@media (max-width: 860px) {
  .hero { grid-template-columns: 1fr; gap: 36px; padding: 24px 0 56px; }
  .grid, .grid.five, .split { grid-template-columns: 1fr; }
  section { padding: 48px 0; }
}
</style>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<div class="wrap">
<header>
  <a class="brand" href="/" aria-label="Common Ink home">${logo.replace("<svg ", '<svg aria-hidden="true" ')}Common Ink</a>
  <a class="signin" href="${signIn}">Sign in</a>
</header>
<main id="main">
  <div class="hero">
    <div>
      <h1>Notes any agent can work in.</h1>
      <p class="lede">One place for your notes, tasks, calendar, people and code. Claude, Cursor or your own scripts work right alongside you, and you see every change they make, live.</p>
      <div class="ctas">
        <a class="btn" href="${signIn}">Get started</a>
        <a class="btn quiet" href="#how">How it works</a>
      </div>
      <p class="fine">Sign in with Google. Free while in preview.</p>
    </div>
    <figure class="note" role="img" aria-label="A note in Common Ink while Claude adds a task to it, highlighted and labelled with Claude's name">
      <div class="note-bar" aria-hidden="true"><i></i><i></i><i></i><span>Weekend in Lisbon</span><span class="live">Live</span></div>
      <div class="note-body" aria-hidden="true">
        <h2>Weekend in Lisbon</h2>
        <p>Friday to Sunday. Trams, tiles, too many pastéis.</p>
        <div class="task done"><span class="box"></span><span class="words">Book flights</span></div>
        <div class="task"><span class="box"></span><span class="words">Pick a hotel near Alfama</span> <span class="chip">due Fri</span></div>
        <div class="task agent"><span class="box"></span><span class="words">Reserve dinner, Saturday 8pm</span> <span class="who">Claude for you</span></div>
        <div class="task"><span class="box"></span><span class="words">Pack the good shoes</span> <span class="chip">@sam</span></div>
      </div>
    </figure>
  </div>

  <section id="how" aria-labelledby="how-title">
    <h2 class="title" id="how-title">Outside-in: no AI inside, bring your own</h2>
    <p class="intro">Common Ink has no model of its own. The agents you already use come to your notes, and every edit they make lights up with their name. History keeps it all, and Undo takes back just theirs.</p>
    <div class="grid">
      <div class="card"><h3>MCP</h3><p>Point Claude, Cursor or any MCP client at <code>commonink.app/mcp</code>. It signs in like you do, so there's no key to copy.</p></div>
      <div class="card"><h3>CLI</h3><p><code>commonink</code> does everything the app does, for your scripts and shell agents.</p></div>
      <div class="card"><h3>Plain files</h3><p>Every note is markdown. Read it, grep it, keep it in git, open it in any editor.</p></div>
    </div>
  </section>

  <section aria-labelledby="one-title">
    <h2 class="title" id="one-title">One place for the rest, too</h2>
    <p class="intro">Your notes already hold your plans. Common Ink makes them work.</p>
    <div class="grid five">
      <div class="card"><h3>Tasks</h3><p>Type “Pay rent every month on the 1st” and it's a task with a due date that repeats.</p></div>
      <div class="card"><h3>Calendar</h3><p>Google Calendar or any calendar feed, next to what's due today.</p></div>
      <div class="card"><h3>People</h3><p>Contacts you can link from any note, each with every note that mentions them.</p></div>
      <div class="card"><h3>Code</h3><p>Code blocks and diagrams that read well and copy cleanly.</p></div>
      <div class="card"><h3>Boards</h3><p>Kanban boards that are just a list in a note.</p></div>
    </div>
  </section>

  <section aria-labelledby="share-title">
    <div class="split">
      <div>
        <h2 class="title" id="share-title">Share with people</h2>
        <p class="intro">Make a workspace for your team, or share one note with a link. Viewers read, editors write, and an agent only ever gets the access its person has.</p>
      </div>
      <div>
        <h2 class="title" id="own-title">Yours to keep</h2>
        <p class="intro">Your notes are plain markdown, so they're never stuck here. Export one note or all of them any time, as a zip that opens in Obsidian. We don't sell your data, show ads, or train AI on your notes.</p>
      </div>
    </div>
  </section>

  <section aria-labelledby="price-title">
    <h2 class="title" id="price-title">Pricing</h2>
    <p class="intro">Common Ink is free while it's in preview.</p>
  </section>

  <section aria-labelledby="faq-title">
    <h2 class="title" id="faq-title">Questions</h2>
    <details><summary>Is there AI built in?</summary><p>No. You bring the agent you already use, and it works through MCP or the CLI. Common Ink just makes sure you can see what it did.</p></details>
    <details><summary>Which agents work with it?</summary><p>Anything that speaks MCP: Claude, Claude Code, Cursor and more. Shell agents and scripts can use the <code>commonink</code> CLI.</p></details>
    <details><summary>Can I see and undo what an agent changed?</summary><p>Yes. Its edits are highlighted as they happen, with its name. History shows every change, and Undo takes back one edit without losing what you've typed since.</p></details>
    <details><summary>Can I take my notes with me?</summary><p>Any time. Export a note as Markdown, a web page, Word or PDF, or everything as a zip of markdown files.</p></details>
    <details><summary>What does it cost?</summary><p>Nothing while it's in preview.</p></details>
  </section>

  <section class="end" aria-labelledby="go-title">
    <h2 class="title" id="go-title">Start writing</h2>
    <p class="intro">Your first notebook comes with a short guide.</p>
    <div class="ctas"><a class="btn" href="${signIn}">Get started</a></div>
  </section>
</main>
<footer>
  <span>© Audrow Nash LLC</span>
  <a href="/privacy.html">Privacy</a>
  <a href="/terms.html">Terms</a>
</footer>
</div>
</body>
</html>`;
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // The same address is the app once you're signed in, so no cache may keep this for it.
      "Cache-Control": "no-store",
      Vary: "Cookie",
    },
  });
}
