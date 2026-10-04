// The demo video's workspace (scripts/demo-video.ts): beside the notes every new workspace starts
// with, a few notes of someone planning a launch, with tasks due this week, tags, links and a
// diagram, so each page the tour visits has something to show. Written through the app's own API as
// the developer the tour signs in as; notes that are already there are left alone.
import { localDate } from "../src/core/tasks.ts";

const DAY = 86400_000;
const day = (offset: number) => localDate(Date.now() + offset * DAY);

const NOTES: Record<string, string> = {
  "Projects/Website relaunch.md": `---
tags: [launch, work]
status: in progress
owner: Dev
---

# Website relaunch

The new site goes live at the end of the month. This note is the plan; [[Launch announcement]] is the copy, and questions go to [[Open questions]].

## This week

- [x] Pick the launch date
- [ ] Review the pricing page due:${day(0)} #launch
- [ ] Send the press kit to @Priya due:${day(1)} #launch
- [ ] Book the launch review due:${day(2)}
- [ ] Record the demo video due:${day(4)}

## How it ships

\`\`\`mermaid
flowchart LR
  Draft --> Review --> Staging --> Launch
  Review -->|changes| Draft
\`\`\`

| Page | Owner | State |
| --- | --- | --- |
| Home | Dev | Ready |
| Pricing | Priya | In review |
| Docs | Jane | Drafting |
`,
  "Projects/Launch announcement.md": `---
tags: [launch, writing]
---

# Launch announcement

**Common Ink is a notebook you and your agents share.** Your notes are markdown, yours to keep, and any agent that speaks MCP can read and write them beside you.

- Notes link to each other with \`[[double brackets]]\`
- Tasks live in the notes they belong to
- Every change is in History, with who made it

Plan: [[Website relaunch]]
`,
  "Projects/Open questions.md": `---
tags: [launch]
---

# Open questions

- Do we announce on a Tuesday or a Thursday?
- Who writes the changelog entry? See [[Website relaunch]].
- [ ] Ask Jane about the docs migration due:${day(0)}
`,
  "Ideas/Reading list.md": `---
tags: [reading]
---

# Reading list

- *How Buildings Learn*, Stewart Brand
- *The Design of Everyday Things*, Don Norman
- [ ] Finish chapter 4 due:${day(5)}
`,
  [`Journal/${day(-1)}.md`]: `# ${day(-1)}

Walked through the pricing page with the team. The annual plan needs a clearer line. Follow up in [[Website relaunch]].

#journal
`,
};

/** Sign in as the tour's person and fill their workspace. */
export async function seed(origin: string, as: string): Promise<void> {
  const res = await fetch(`${origin}/auth/dev?next=/${as ? `&as=${as}` : ""}`, { redirect: "manual" });
  const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).find((c) => !c.endsWith("="));
  if (!cookie) throw new Error(`Developer sign-in failed at ${origin} (${res.status}). The demo video needs DEV_LOGIN (local, or a Preview).`);
  const call = async (method: string, route: string, body?: unknown) => {
    const r = await fetch(origin + route, { method, headers: { cookie, origin, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = await r.json().catch(() => null);
    if (r.status >= 400) throw new Error(`${method} ${route} → ${r.status} ${JSON.stringify(data)}`);
    return data;
  };
  const me = (await call("GET", "/api/me")) as { workspaces: Array<{ id: string; kind: string }> };
  const api = `/api/w/${(me.workspaces.find((w) => w.kind === "personal") ?? me.workspaces[0]).id}`;
  const has = new Set(((await call("GET", `${api}/notes`)) as Array<{ path: string }>).map((n) => n.path));

  for (const [rel, content] of Object.entries(NOTES)) if (!has.has(rel)) await call("POST", `${api}/note`, { path: rel, content });
  await call("POST", `${api}/favorites/star`, { path: "Projects/Website relaunch.md" });
}
