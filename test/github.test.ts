import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { githubCard, githubRef, toCard } from "../src/core/github.ts";
import { unfurl } from "../src/core/unfurl.ts";

const ref = { owner: "paudrow", repo: "commonink", number: 23 };

test("issue and pull request links are read; anything else on github.com isn't", () => {
  assert.deepEqual(githubRef("https://github.com/paudrow/commonink/issues/23"), ref);
  assert.deepEqual(githubRef("https://www.github.com/paudrow/commonink/pull/23/files?w=1#diff"), ref);
  assert.deepEqual(githubRef("https://github.com/paudrow/commonink/issues/23#issuecomment-1"), ref);
  for (const url of [
    "https://github.com/paudrow/commonink",
    "https://github.com/paudrow/commonink/issues",
    "https://github.com/paudrow/commonink/discussions/23",
    "https://gist.github.com/paudrow/commonink/issues/23",
    "https://github.com.evil.com/paudrow/commonink/issues/23",
    "https://user:pw@github.com/paudrow/commonink/issues/23",
    "https://github.com:8443/paudrow/commonink/issues/23",
    "https://github.com/paudrow/../issues/23",
    "https://github.com/pau%2Fdrow/commonink/issues/23",
    "ftp://github.com/paudrow/commonink/issues/23",
    "not a url",
  ]) {
    assert.equal(githubRef(url), null, url);
  }
});

const issue = (over: Record<string, unknown> = {}) => ({
  number: 23,
  title: "GitHub: live issue/PR embeds",
  state: "open",
  html_url: "https://github.com/paudrow/commonink/issues/23",
  labels: [{ name: "enhancement", color: "A2EEEF" }, { name: "x", color: "red;background:url(x)" }, { name: "" }],
  user: { login: "audrow" },
  comments: 4,
  updated_at: "2026-10-01T12:00:00Z",
  ...over,
});

test("a card reads state the way GitHub shows it", () => {
  const pr = { pull_request: { merged_at: null } };
  const states = [
    toCard(issue(), ref),
    toCard(issue({ state: "closed", state_reason: "completed" }), ref),
    toCard(issue({ state: "closed", state_reason: "not_planned" }), ref),
    toCard(issue({ ...pr }), ref),
    toCard(issue({ ...pr, draft: true }), ref),
    toCard(issue({ state: "closed", pull_request: { merged_at: "2026-10-01T00:00:00Z" } }), ref),
    toCard(issue({ state: "closed", ...pr }), ref),
  ].map((c) => [c!.kind, c!.state, c!.reason]);
  assert.deepEqual(states, [
    ["issue", "open", null],
    ["issue", "closed", "completed"],
    ["issue", "closed", "not_planned"],
    ["pull", "open", null],
    ["pull", "draft", null],
    ["pull", "merged", null],
    ["pull", "closed", null],
  ]);
});

test("a card trusts nothing GitHub sends: label colors must be hex, and page links github.com", () => {
  const card = toCard(issue({ html_url: "javascript:alert(1)", title: "x".repeat(1000), comments: -3 }), ref)!;
  assert.deepEqual(card.labels, [{ name: "enhancement", color: "a2eeef" }, { name: "x", color: null }]);
  assert.equal(card.url, "https://github.com/paudrow/commonink/issues/23");
  assert.equal(card.title.length, 300);
  assert.equal(card.comments, 0);
  assert.equal(toCard({ message: "Not Found" }, ref), null);
  // A transferred issue's card names the repo it lives in now.
  assert.equal(toCard(issue({ html_url: "https://github.com/someone/else/issues/23" }), ref)!.repo, "someone/else");
});

/** A stand-in for api.github.com that counts requests and records the last Authorization header. */
let api: string;
let hits = 0;
let auth: string | undefined;
const server = http.createServer((req, res) => {
  hits++;
  auth = req.headers.authorization;
  const json = (status: number, body: unknown) => (res.writeHead(status, { "Content-Type": "application/json" }), res.end(JSON.stringify(body)));
  if (auth === "Bearer revoked") return json(401, { message: "Bad credentials" });
  if (req.url === "/repos/a/b/issues/1") return json(200, issue({ number: 1 }));
  if (req.url === "/repos/a/b/issues/6") return json(200, issue({ number: 6 }));
  // A private repo: GitHub says it isn't there to anyone whose token can't read it.
  if (req.url === "/repos/a/private/issues/9") return auth === "Bearer mine" ? json(200, issue({ number: 9, title: "Private" })) : json(404, { message: "Not Found" });
  if (req.url === "/repos/a/b/issues/2") return (res.writeHead(301, { Location: "/repos/a/c/issues/2" }), res.end());
  if (req.url === "/repos/a/c/issues/2") return json(200, issue({ number: 2, html_url: "https://github.com/a/c/issues/2" }));
  if (req.url === "/repos/a/b/issues/3") return (res.writeHead(301, { Location: "https://example.com/steal" }), res.end());
  if (req.url === "/repos/a/b/issues/4") return json(403, { message: "API rate limit exceeded" });
  json(404, { message: "Not Found" });
});
before(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  api = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
after(() => server.close());

test("cards come from the API, with the token if there is one, and are kept a few minutes", async () => {
  const before = hits;
  const card = await githubCard("https://github.com/a/b/issues/1", { api, token: "secret" });
  assert.deepEqual([card?.title, card?.state, auth], ["GitHub: live issue/PR embeds", "open", "Bearer secret"]);
  await githubCard("https://github.com/A/B/pull/1", { api });
  assert.equal(hits - before, 1);
});

test("a redirect is followed only within the API", async () => {
  assert.equal((await githubCard("https://github.com/a/b/issues/2", { api }))?.repo, "a/c");
  assert.equal(await githubCard("https://github.com/a/b/issues/3", { api }), null);
});

test("a rate limit or a missing issue gives no card", async () => {
  assert.equal(await githubCard("https://github.com/a/b/issues/4", { api }), null);
  assert.equal(await githubCard("https://github.com/a/b/issues/5", { api }), null);
  assert.equal(await githubCard("https://example.com/a/b/issues/1", { api }), null);
});

test("a GitHub link's preview carries its card, and only api.github.com is asked", async () => {
  const real = globalThis.fetch;
  const asked: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const u = new URL(input instanceof Request ? input.url : input);
    asked.push(u.origin);
    if (u.origin === "https://api.github.com" && u.pathname === "/repos/x/y/issues/7") return new Response(JSON.stringify(issue({ number: 7 })), { status: 200 });
    return new Response("nope", { status: 404 });
  }) as typeof fetch;
  try {
    const r = await unfurl("https://github.com/x/y/issues/7", () => {});
    assert.deepEqual([r.title, r.github?.number, r.github?.repo], ["GitHub: live issue/PR embeds", 7, "paudrow/commonink"]);
    assert.deepEqual(asked, ["https://api.github.com"]);
    // GitHub won't say (a private repo): the page's own link card, as before.
    const fallback = await unfurl("https://github.com/x/y/issues/8", () => {});
    assert.equal(fallback.github, undefined);
    assert.deepEqual(asked.slice(1), ["https://api.github.com", "https://github.com"]);
  } finally {
    globalThis.fetch = real;
  }
});

/** A guard that refuses everything, so a preview that falls back to the page fetches nothing. */
const noPage = () => {
  throw new Error("no page");
};

test("someone's own token reads their private repos, and those cards are theirs alone", async () => {
  const url = "https://github.com/a/private/issues/9";
  const mine = await unfurl(url, noPage, { githubApi: api, githubToken: "shared", githubOwn: { token: "mine", as: "u1" } });
  assert.deepEqual([mine.github?.title, auth], ["Private", "Bearer mine"]);
  // Nobody else is served it: not someone without a connection, nor someone whose own token can't read it.
  const before = hits;
  assert.equal((await unfurl(url, noPage, { githubApi: api, githubToken: "shared" })).github, undefined);
  assert.equal(auth, "Bearer shared");
  assert.equal((await unfurl(url, noPage, { githubApi: api, githubToken: "shared", githubOwn: { token: "theirs", as: "u2" } })).github, undefined);
  assert.equal(hits - before, 2); // GitHub was asked as each of them: u2's own token, then nothing new for the shared one
  // Theirs is kept for them, so asking again doesn't reach GitHub.
  assert.equal((await unfurl(url, noPage, { githubApi: api, githubOwn: { token: "mine", as: "u1" } })).github?.number, 9);
  assert.equal(hits - before, 2);
});

test("where someone's own token gets nothing, the shared one answers; a refused token is reported", async () => {
  let rejected = 0;
  const r = await unfurl("https://github.com/a/b/issues/6", noPage, { githubApi: api, githubToken: "shared", githubOwn: { token: "revoked", as: "u3", rejected: () => void rejected++ } });
  assert.deepEqual([r.github?.number, auth, rejected], [6, "Bearer shared", 1]);
});
