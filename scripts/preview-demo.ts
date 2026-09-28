// Fill a pull request Preview with things to try, through its own API, as the developer the Preview
// signs you in as: the sample vault, a note renamed after a few edits (for History), favorites where
// the branch has them, and a "Try this PR" note at the top of Notes that says what to look at.
//
//   node --import tsx scripts/preview-demo.ts <preview-url>
//
// PR_NUMBER, PR_TITLE, PR_URL, PR_BODY and PR_SHA describe the pull request (CI sets them). Safe to
// run on every deploy: it adds only what's missing, and rewrites the "Try this PR" note.
import fs from "node:fs";
import path from "node:path";

const origin = new URL(process.argv[2] ?? "").origin;
const VAULT = path.resolve(import.meta.dirname, "../examples/vault");
const TRY = "Try this PR.md";

const cookie = await signIn();
const me = (await call("GET", "/api/me")).data as { workspaces: Array<{ id: string; kind: string }> };
const ws = me.workspaces.find((w) => w.kind === "personal") ?? me.workspaces[0];
const api = `/api/w/${ws.id}`;
const has = new Set(((await call("GET", `${api}/notes`)).data as Array<{ path: string }>).map((n) => n.path));

await sampleVault();
await renamedNote();
const favorites = await starSome();
await tryThisPr(favorites);
console.log(`Filled ${origin} (workspace ${ws.id})`);

/**
 * Sign in the way a browser does on a Preview: /auth/dev sets the session cookie. A brand-new
 * Preview's first requests can fail while its Durable Objects come up, so server errors are retried.
 */
async function signIn(): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${origin}/auth/dev?next=/`, { redirect: "manual" });
    const session = res.headers.getSetCookie().map((c) => c.split(";")[0]).find((c) => !c.endsWith("="));
    if (session) return session;
    if (res.status < 500 || attempt === 6) throw new Error(`Developer sign-in failed at ${origin} (${res.status}). Is DEV_LOGIN on for Previews?`);
    await new Promise((r) => setTimeout(r, attempt * 3000));
  }
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
  for (const p of ["Projects/Q4 plan.md", "Projects/Quire roadmap.md", "Welcome.md"]) {
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
    `# Try this PR${n ? ` (#${n})` : ""}`,
    "",
    `**${title}**${process.env.PR_URL ? ` · [open the pull request](${process.env.PR_URL})` : ""}${sha ? ` · deployed from \`${sha}\`` : ""}`,
    "",
    "This Preview has its own notes. Change anything: nothing here is real, and the next deploy tops it back up.",
    "",
    "## Set up for you",
    "",
    "- The sample notes: [[Welcome]], [[Quire roadmap]], [[Outside-in agents]], the [[Overview]] dashboard, and [[Checklist]] in a nested folder (`Projects/Launch`).",
    "- [[Q4 plan]] started as *Draft plan*, was edited three times, renamed, then edited again. Open it and press the History button in the top bar to see its changes.",
    favorites
      ? "- Favorites: [[Q4 plan]], [[Quire roadmap]], [[Welcome]] and this note are starred. Star from a note's top bar, press `s` on a card in Notes, or drag in the sidebar to reorder."
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
