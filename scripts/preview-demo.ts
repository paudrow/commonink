// Fill a pull request Preview with things to try, through its own API, as the developer the Preview
// signs you in as: the sample vault, a note renamed after a few edits (for History), favorites where
// the branch has them, each PR's demo notes (examples/preview/, see preview-sections.ts), and a
// "Try this PR" note at the top of Notes that says what to look at: this PR's steps first, then the
// steps of the PRs it's stacked on.
//
//   node --import tsx scripts/preview-demo.ts <preview-url>
//
// PR_NUMBER, PR_TITLE, PR_URL, PR_BODY and PR_SHA describe the pull request (CI sets them). Safe to
// run on every deploy: it adds only what's missing, and rewrites the "Try this PR" note.
import fs from "node:fs";
import path from "node:path";
import { fillDates, readSections, sectionsMarkdown, type Section } from "./preview-sections.ts";
import { localDate } from "../src/core/tasks.ts";

const origin = new URL(process.argv[2] ?? "").origin;
const VAULT = path.resolve(import.meta.dirname, "../examples/vault");
const TRY = "Try this PR.md";
const SECTIONS = readSections(path.resolve(import.meta.dirname, "../examples/preview"));
const TODAY = localDate(Date.now());

const cookie = await signIn();
const me = (await whenReady("/api/me")) as { workspaces: Array<{ id: string; kind: string; name: string }> };
const ws = me.workspaces.find((w) => w.kind === "personal") ?? me.workspaces[0];
const api = `/api/w/${ws.id}`;
const has = new Set(((await whenReady(`${api}/notes`)) as Array<{ path: string }>).map((n) => n.path));

await sampleVault();
await demoFiles(SECTIONS);
await renamedNote();
const favorites = await starSome();
await tryThisPr(favorites);
await sharedTeam();
await calendars();
console.log(`Filled ${origin} (workspace ${ws.id})`);

/**
 * Sign in the way a browser does on a Preview: /auth/dev sets the session cookie. A brand-new
 * Preview's first requests can fail while its Durable Objects come up, so server errors are retried.
 */
async function signIn(as = ""): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${origin}/auth/dev?next=/${as ? `&as=${as}` : ""}`, { redirect: "manual" });
    const session = res.headers.getSetCookie().map((c) => c.split(";")[0]).find((c) => !c.endsWith("="));
    if (session) return session;
    if (res.status < 500 || attempt === 6) throw new Error(`Developer sign-in failed at ${origin} (${res.status}). Is DEV_LOGIN on for Previews?`);
    await new Promise((r) => setTimeout(r, attempt * 3000));
  }
}

/**
 * A GET's JSON once the new Preview serves it. Just after a deploy, the workspace's Durable Object
 * can still be starting, or running the code from before it, and answer with an error, a 404 or no
 * JSON at all. Those, and failed connections, are retried for about a minute and a half.
 */
async function whenReady(route: string): Promise<unknown> {
  let last = "";
  for (let attempt = 1; attempt <= 8; attempt++) {
    try {
      const res = await fetch(origin + route, { headers: { cookie } });
      const text = await res.text();
      last = `${res.status} ${text.slice(0, 200) || "(empty)"}`;
      if (res.ok) return JSON.parse(text);
      if (res.status !== 404 && res.status < 500) break;
    } catch (e) {
      if (!(e instanceof SyntaxError)) last = String(e);
    }
    if (attempt < 8) await new Promise((r) => setTimeout(r, attempt * 3000));
  }
  throw new Error(`GET ${route} at ${origin} didn't answer with JSON, last with ${last}`);
}

async function call(method: string, route: string, body?: unknown, raw?: { data: Blob; type: string }) {
  const res = await fetch(origin + route, {
    method,
    headers: { cookie, origin, "content-type": raw?.type ?? "application/json" },
    body: raw ? raw.data : body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

async function must(method: string, route: string, body?: unknown) {
  const r = await call(method, route, body);
  if (r.status >= 400) throw new Error(`${method} ${route} → ${r.status} ${JSON.stringify(r.data)}`);
  return r.data;
}

/** Every note and file in examples/vault the workspace doesn't have yet, plus a nested folder. */
async function sampleVault() {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const ent of fs.readdirSync(path.join(VAULT, dir), { withFileTypes: true })) {
      const rel = dir ? `${dir}/${ent.name}` : ent.name;
      if (ent.isDirectory()) walk(rel);
      else files.push(rel);
    }
  };
  walk("");
  for (const rel of files) {
    if (has.has(rel)) continue;
    const bytes = fs.readFileSync(path.join(VAULT, rel));
    if (/\.(md|html)$/.test(rel)) await must("POST", `${api}/note`, { path: rel, content: bytes.toString("utf8") });
    else {
      const [folder, name] = [path.posix.dirname(rel), path.posix.basename(rel)];
      const type = rel.endsWith(".svg") ? "image/svg+xml" : "application/octet-stream";
      const r = await call("POST", `${api}/upload?name=${encodeURIComponent(name)}&folder=${encodeURIComponent(folder)}`, undefined, { data: new Blob([bytes]), type });
      if (r.status >= 400) throw new Error(`Upload ${rel} → ${r.status} ${JSON.stringify(r.data)}`);
    }
  }
  const nested = "Projects/Launch/Checklist.md";
  if (!has.has(nested)) {
    await must("POST", `${api}/note`, {
      path: nested,
      content: "# Launch checklist\n\nA note one folder deeper, so the sidebar has nested folders to open.\n\n- [x] Write the announcement\n- [ ] Record a demo\n- [ ] Tell the beta list\n",
    });
  }
}

/** Each section's demo notes and files the workspace doesn't have yet, with their dates filled in as of today. */
async function demoFiles(sections: Section[]) {
  for (const { to, from, versions } of sections.flatMap((s) => s.files)) {
    if (has.has(to)) continue;
    if (versions?.length) {
      // Its earlier versions first, each saved and labeled with its name; then the note as it is now.
      for (const [i, v] of versions.entries()) {
        await must(i ? "PUT" : "POST", `${api}/note`, { path: to, content: fillDates(fs.readFileSync(v.from, "utf8"), TODAY) });
        await must("POST", `${api}/labels`, { path: to, name: v.name });
      }
      await must("PUT", `${api}/note`, { path: to, content: fillDates(fs.readFileSync(from, "utf8"), TODAY) });
    } else if (/\.(md|html)$/.test(to)) await must("POST", `${api}/note`, { path: to, content: fillDates(fs.readFileSync(from, "utf8"), TODAY) });
    else {
      const [folder, name] = [path.posix.dirname(to), path.posix.basename(to)];
      const type = to.endsWith(".svg") ? "image/svg+xml" : "application/octet-stream";
      const r = await call("POST", `${api}/upload?name=${encodeURIComponent(name)}&folder=${encodeURIComponent(folder)}`, undefined, { data: new Blob([fs.readFileSync(from)]), type });
      if (r.status >= 400) throw new Error(`Upload ${to} → ${r.status} ${JSON.stringify(r.data)}`);
    }
  }
}

/** "Draft plan" edited twice, renamed to "Q4 plan", edited again: its History should show all of it. */
async function renamedNote() {
  if (has.has("Projects/Q4 plan.md")) return;
  const draft = "Projects/Draft plan.md";
  await must("POST", `${api}/note`, { path: draft, content: "# Q4 plan\n\n- Ship favorites\n" });
  await must("PUT", `${api}/note`, { path: draft, content: "# Q4 plan\n\n- Ship favorites\n- Rename the feed to Notes\n" });
  await must("PUT", `${api}/note`, { path: draft, content: "# Q4 plan\n\n- Ship favorites\n- Rename the feed to Notes\n- Folders that filter Notes\n" });
  await must("POST", `${api}/move`, { from: draft, to: "Projects/Q4 plan.md" });
  await must("PUT", `${api}/note`, {
    path: "Projects/Q4 plan.md",
    content: "# Q4 plan\n\nRenamed from *Draft plan* after three edits.\n\n- Ship favorites\n- Rename the feed to Notes\n- Folders that filter Notes\n",
  });
}

/** Star a few notes if this branch has favorites. Returns whether it does. */
async function starSome(): Promise<boolean> {
  const r = await call("GET", `${api}/favorites`);
  if (r.status === 404) return false;
  const starred = new Set((r.data as Array<{ path: string }>).map((n) => n.path));
  for (const p of ["Projects/Q4 plan.md", "Projects/Common Ink roadmap.md", "Tips.md"]) {
    if (!starred.has(p)) await must("POST", `${api}/favorites/star`, { path: p });
  }
  return true;
}

/** The note at the top of Notes: what this PR is, what's here to try, and the PR's own description. */
async function tryThisPr(favorites: boolean) {
  const n = process.env.PR_NUMBER;
  const title = process.env.PR_TITLE || "this branch";
  const body = (process.env.PR_BODY ?? "").replace(/^🤖 Generated with.*$/m, "").trim();
  const sha = process.env.PR_SHA?.slice(0, 7);
  const lines = [
    "---",
    "tags: [start]", // leads Notes, ahead of the Welcome note (the newest start note goes first)
    "---",
    `# Try this PR${n ? ` (#${n})` : ""}`,
    "",
    `**${title}**${process.env.PR_URL ? ` · [open the pull request](${process.env.PR_URL})` : ""}${sha ? ` · deployed from \`${sha}\`` : ""}`,
    "",
    "This Preview has its own notes. Change anything: nothing here is real, and the next deploy tops it back up.",
    "",
    ...sectionsMarkdown(SECTIONS, Number(n) || null),
    "## Set up for you",
    "",
    "- The sample notes: [[Getting started]] (its checklist ticks itself as you try things), [[Tips]], [[Common Ink roadmap]], [[Outside-in agents]], the [[Overview]] dashboard, and [[Checklist]] in a nested folder (`Projects/Launch`).",
    "- [[Q4 plan]] started as *Draft plan*, was edited three times, renamed, then edited again. Open it and press the History button in the top bar to see its changes.",
    favorites
      ? "- Favorites: [[Q4 plan]], [[Common Ink roadmap]], [[Tips]] and this note are starred. Star from a note's top bar, press `s` on a card in Notes, or drag in the sidebar to reorder."
      : "- This branch doesn't have favorites.",
    "",
    ...(body ? ["## About this PR", "", body, ""] : []),
  ];
  await must("PUT", `${api}/note`, { path: TRY, content: lines.join("\n") });
  if (favorites) {
    await must("POST", `${api}/favorites/star`, { path: TRY });
    const order = ((await must("GET", `${api}/favorites`)) as Array<{ path: string }>).map((f) => f.path);
    await must("PUT", `${api}/favorites`, { paths: [TRY, ...order.filter((p) => p !== TRY)] });
  }
}

/**
 * A team workspace the developer owns with a second person in it, Sam (a developer sign-in, which
 * only Previews have), plus an invite link Sam used and one that's still open: something to try
 * members, roles, invites, leaving and deleting on. Made again if it's been left or deleted.
 */
async function sharedTeam() {
  const TEAM = "Launch team";
  if (me.workspaces.some((w) => w.kind === "team" && w.name === TEAM)) return;
  const made = await call("POST", "/api/workspaces", { name: TEAM });
  if (made.status >= 400) throw new Error(`Couldn't make ${TEAM}: ${made.status}`);
  const base = `/api/w/${(made.data as { id: string }).id}`;
  const invite = (await must("POST", `${base}/invites`, { role: "editor" })) as { url: string };
  const sam = await signIn("sam");
  const join = await fetch(origin + new URL(invite.url).pathname, { method: "POST", redirect: "manual", headers: { cookie: sam, origin } });
  if (join.status !== 302) throw new Error(`Sam couldn't join ${TEAM}: ${join.status}`);
  await must("POST", `${base}/invites`, { role: "viewer" });
}

/**
 * Two calendars, if this branch has calendars: the Preview's own demo team calendar (served inside
 * the Preview, cloud/src/demo-calendar.ts) and a real public feed of US holidays, read from Google.
 * A holiday feed that can't be read is left out with a warning; the demo one always works.
 */
async function calendars() {
  const r = await call("GET", `${api}/calendar/sources`);
  if (r.status === 404) return;
  const have = new Set((r.data as Array<{ url: string | null }>).map((s) => s.url));
  const feeds = [
    { url: "https://demo.commonink.invalid/team.ics", name: "Launch team (demo)", color: "blue" },
    { url: "https://calendar.google.com/calendar/ical/en.usa%23holiday%40group.v.calendar.google.com/public/basic.ics", name: "US holidays", color: "green" },
  ];
  for (const f of feeds) {
    if (have.has(f.url)) continue;
    const added = await call("POST", `${api}/calendar/sources`, f);
    if (added.status >= 400) console.warn(`Couldn't subscribe to ${f.name}: ${added.status} ${JSON.stringify(added.data)}`);
  }
}
