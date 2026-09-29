# Threat model for the hosted app

This covers Common Ink online (commonink.app and pull request Previews): the Worker in `cloud/src`, one Durable Object per workspace, D1 and R2. The local app (`src/server`) serves one person on 127.0.0.1 and has its own, smaller model: a Host check, same-origin JSON writes and sandboxed files. Issue #11 tracks the whole list; this page says what is in place and why.

## What we protect

- **Notes and files.** Each workspace's notes, search index and change log live in its Durable Object's SQLite. Uploaded bytes live in R2 under `ws/<workspace>/`.
- **The directory in D1.** People, workspaces, memberships and roles, invite tokens, sessions, and sign-up attempts.
- **Sessions.** A random token in the `__Host-ci_session` cookie. D1 stores only its SHA-256.
- **Agent connections.** OAuth clients, grants, codes and tokens for remote MCP, in D1's `oauth_kv`. Tokens, codes and client secrets are stored only as hashes, and each grant's props are encrypted with a key that only its token unwraps.
- **Secrets.** `SESSION_SECRET` (signs the short-lived sign-in cookies), `GOOGLE_CLIENT_SECRET` and `SIGNUP_CODE`, all Worker secrets. Integration tokens (#19) will join this list.

## Who might attack

- **Other tenants.** Signed-in people who aren't members of a workspace, guessing workspace IDs, note IDs or file paths.
- **Members with less access.** A viewer trying to write, or an editor trying to invite people.
- **Invite and shared-link holders.** Whoever has a link, including someone it was forwarded to. Per-note link sharing (#12) will add link viewers.
- **Malicious note content.** Markdown, HTML notes, SVGs and uploads written by a teammate or an agent, meant to run script in the app or read someone else's session.
- **A compromised agent.** An MCP client that acts with the full role of the person who connected it.
- **Anyone on the web.** Cross-site requests riding on the session cookie, framing the app, making the link-card fetcher reach places it shouldn't, and brute-forcing sign-in or sign-up codes.

## Trust boundaries

1. **Browser to Worker.** The session cookie says who is asking. The Worker checks the role for every route before anything else runs.
2. **Worker to workspace Durable Object.** Only the Worker can reach a Durable Object. It forwards who is asking in `x-ci-user`, `x-ci-actor` and `x-ci-role`, and the workspace checks the role again against the same table.
3. **Worker and workspaces to D1 and R2.** Bindings, not network calls. R2 keys are scoped by workspace, and a workspace only reads keys it stored.
4. **App to sandboxed frames.** HTML notes and third-party embeds run in iframes with an opaque origin and talk to the app only through `postMessage`.
5. **Worker to the internet.** The link-card fetcher (`/api/unfurl`) fetches pages that note content names.

## Controls

| Control | Mitigates | Where | Proof |
| --- | --- | --- | --- |
| Every route has a least role (`WORKSPACE_ROUTES`, `ACCOUNT_ROUTES`); anything else is refused | Other tenants, members with less access, internal routes left reachable | `cloud/src/access.ts`, checked in `cloud/src/index.ts` and again in `cloud/src/workspace.ts` | `test/cloud-access.test.ts` sends every route as five kinds of person, and fails if a core API route has no role |
| Non-members get 404, not 403 | Other tenants learning which workspaces and notes exist | `cloud/src/index.ts`, `locateNote` in `cloud/src/directory.ts` | Access matrix |
| Writes need our `Origin` and a JSON body; WebSockets need our `Origin` | Cross-site request forgery with the session cookie | `cloud/src/index.ts` | Existing behaviour |
| `__Host-` session cookie: `Secure`, `HttpOnly`, `SameSite=Lax`, path `/`, no domain | Session theft by script, by a sibling subdomain or over plain HTTP | `cloud/src/auth.ts` | `test/cloud-sessions.test.ts` |
| Sessions in D1 (token hashed), a new one on every sign-in, 14 idle days, 30 days in all | A stolen or leaked session lasting forever; session fixation; a leaked D1 table | `cloud/src/auth.ts`, `cloud/migrations/0004_sessions.sql` | `test/cloud-sessions.test.ts` |
| Sign out, and "Sign out everywhere" (account menu, `POST /api/sign-out-everywhere`) | A lost laptop or a leaked cookie. It also closes that person's open live connections and disconnects their agents, since a stolen session could have connected one | `cloud/src/index.ts`, `disconnect` in `cloud/src/workspace.ts` | `test/cloud-sessions.test.ts` |
| Strict CSP with a per-response nonce, stamped only on the web app's own pages. Pages the Worker writes (sign-up, errors) allow no scripts at all | Script injected through note content running in the app | `cloud/src/headers.ts` | `test/cloud-headers.test.ts`, and the app checked in Chromium under the policy |
| HTML notes run in `/sandbox`: `sandbox allow-scripts`, its own policy | A note's script reading cookies, calling the API or reaching the app | `src/core/sandbox.ts`, `web/src/render.ts` | `test/cloud-headers.test.ts`, `test/server.test.ts` |
| Uploaded files served with `sandbox`, `nosniff`, and `frame-ancestors 'self'` | An uploaded SVG or HTML-looking file running script on our origin | `fileSecurityHeaders` in `src/core/paths.ts` | `test/cloud-headers.test.ts` |
| `frame-ancestors 'none'` on the app, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, COOP, HSTS | Clickjacking, MIME sniffing, note URLs (they contain titles) leaking in `Referer`, powerful browser features, cross-window attacks | `cloud/src/headers.ts` | `test/cloud-headers.test.ts` |
| DOMPurify on rendered markdown | Script in markdown | `web/src/render.ts` | Existing behaviour |
| Link cards fetch only public hosts on default ports, never the app itself. Every redirect is checked again, with at most 3 redirects, one 6-second deadline, HTML only, 512 KB at most, and no credentials in URLs | Note content making the Worker (or the local server) reach private networks, cloud metadata, or the app. It also stops slow or huge pages from tying the Worker up | `src/core/unfurl.ts`, the guard in `cloud/src/index.ts`, `src/server/unfurl.ts` (which also resolves DNS) | `test/unfurl.test.ts`, `test/cloud-limits.test.ts` |
| Rate limits: 60 sign-in requests per network address per 10 minutes, 20 invites, 120 uploads and 10 new workspaces per person per hour, and 120 link cards per person per minute | Sign-in abuse, invite spam, storage and Durable Object abuse, and using the link-card fetcher to flood other sites | `cloud/src/limits.ts` | `test/cloud-limits.test.ts` |
| Remote MCP uses OAuth 2.1 through `@cloudflare/workers-oauth-provider`: dynamic registration, PKCE (S256 only), tokens bound to `/mcp`, 1-hour access tokens and rotating refresh tokens | Stolen or replayed codes and tokens, and tokens meant for another resource | `cloud/src/agents.ts`, `cloud/src/oauth-store.ts` | `test/cloud-mcp.test.ts` |
| An agent works in one workspace its person picked on the consent page, which shows the client's name, where access goes (with a warning for apps on your computer) and your role. The page has no scripts, can't be framed, and only accepts answers from our own origin | Phishing a person into connecting a look-alike client, and consent forged from another site | `authorize` in `cloud/src/agents.ts` | `test/cloud-mcp.test.ts` |
| Each MCP request checks the person is still a member and uses their role at that moment. Tools are offered by the same role table as the app (`TOOL_ROUTES` in `src/core/tools.ts`) | A compromised agent doing more than its person can do, or keeping access after they're removed or demoted | `serveMcp` in `cloud/src/agents.ts`, `mcp` in `cloud/src/workspace.ts` | `test/cloud-mcp.test.ts`, `test/cloud-access.test.ts` |
| Agents' writes are attributed as "Client (via Person)". **Connected agents** lists each one with its last use and recent changes, and **Revoke** takes effect at the next request, because the records are in D1, not KV | A compromised agent's changes going unnoticed, or outliving the decision to cut it off | `cloud/src/agents.ts`, `web/src/agentsPage.ts` | `test/cloud-mcp.test.ts` |
| Client registration is limited to 20 per network address per hour | Filling D1 with junk registrations | `cloud/src/limits.ts` | `test/cloud-limits.test.ts` |
| `npm audit --audit-level=high`, gitleaks over the whole history, and weekly Dependabot updates | Known-vulnerable dependencies (dev tools run next to the deploy credentials), and committed secrets | `.github/workflows/ci.yml`, `.github/dependabot.yml`, `.gitleaks.toml` | CI |

### Why each CSP allowance is there

- `script-src 'self' 'nonce-…'`. The app's bundles, and the inline theme script in `index.html`, which the Worker stamps with the nonce. Uploaded files can't serve as scripts: their types are fixed by extension, there is no `.js`, and `nosniff` is on.
- `style-src 'unsafe-inline'`. CodeMirror, mermaid and the widgets set styles at runtime. Styles can't run script.
- `img-src https: data: blob:`, `media-src https: blob:`. Images and videos pasted as URLs, link-card images and favicons come from anywhere.
- `connect-src` adds the live-update WebSocket and `https://public.api.bsky.app` (Bluesky embeds resolve a handle first).
- `frame-src 'self' https:`. `/sandbox` for HTML notes, and embeds from YouTube, Vimeo, Loom, X, Bluesky, Instagram, TikTok, Spotify and Mastodon on any server.
- `form-action 'self'`. The sign-up code form. Google sign-in is a link, not a form.
- `/sandbox` has no fetch limits, so HTML notes can load what they did before. It has an opaque origin, so it can't use your session.

HTML pages are sent with `Cache-Control: no-store` and without validators, and the Worker drops `If-None-Match`, so a cached page never meets a newer nonce.

## Not covered yet

- **User content on its own site.** HTML notes and uploads are sandboxed but served from commonink.app. A separate registrable domain puts them in another site entirely. The steps are below.
- **Secrets at rest** for integration tokens (#19): not built yet.
- **An audit log** of sharing changes, sign-ins and integration connects.
- **Account deletion and full export**, to match the privacy policy.
- **A backup and restore drill** for D1, Durable Object storage and R2.
- **Google's CASA assessment**, before restricted scopes ship (#25).
- **The local app has no CSP.** It serves one person on 127.0.0.1.
- **DNS rebinding against the local link-card fetcher.** It resolves a name, checks the addresses, then fetches, and the name could resolve differently the second time. Online, Workers can't reach private networks either way.
- **Rate limits count per Cloudflare-reported address or per person.** Someone with many addresses or many accounts gets more tries. The sign-up code keeps its own limit of 5 wrong tries per Google account per day.

### What a user-content domain needs

This needs a domain and DNS, so the owner of the Cloudflare account does it:

1. Register a separate domain, for example `commonink-usercontent.app`. It must not be a subdomain of commonink.app: browsers treat subdomains as the same site, so cookies and site isolation wouldn't separate them.
2. Add it to the same Cloudflare account as a zone.
3. In its DNS, add a proxied `AAAA` record for `*` pointing to `100::`, so every subdomain reaches Workers. Universal SSL covers one level of wildcard.
4. Share the domain name. The code change then adds a route for `*.commonink-usercontent.app/*` to `cloud/wrangler.jsonc`, serves HTML notes and uploads there under one subdomain per workspace, and authorizes each file with a short-lived signed URL, because the session cookie doesn't reach another site.

Previews stay on the sandboxed same-origin setup, since `workers.dev` can't carry a wildcard route.
