---
title: Connect an agent
description: Let Claude, Claude Code, Cursor or any MCP client read and edit your notes, and see everything it did.
---

# Connect an agent

Any agent that speaks MCP can work in your notes: search them, read them, write and edit them, manage tasks and boards. It signs in as you, so there's no key to copy, and everything it changes is shown live and kept in History.

## Add Common Ink to your agent

Your workspace's address is `https://commonink.app/mcp`.

| Agent | How |
| --- | --- |
| Claude (claude.ai and Claude Desktop) | **Settings**, then **Connectors**, then **Add custom connector**, and paste the address |
| Claude Code | `claude mcp add --transport http commonink https://commonink.app/mcp`, then `/mcp` to sign in |
| Cursor | Add `{"mcpServers": {"commonink": {"url": "https://commonink.app/mcp"}}}` to `.cursor/mcp.json`, then **Connect** |
| Anything else | Point any MCP client that supports OAuth at the address |

Your browser opens Common Ink: sign in, pick the workspace the agent may use, and choose **Allow**. In the app, **Connect an agent** in ⌘⇧P shows the same steps.

## Try it

Ask your agent something that touches your notes:

- "Summarize what I wrote this week and add the open questions to my Today list."
- "Make a note for tomorrow's standup from my calendar, with yesterday's done tasks."
- "Find every note that mentions the Acme launch and add a link to the launch plan."

Keep the note open while it works: its edits appear as it makes them.

## See what an agent did

- **Live highlights.** An agent's edit flashes in the editor where it landed, and a toast says who made it, with **Undo**. Undo takes out just that edit and keeps what you've typed since.
- **Signed changes.** Every change says who made it, such as "Claude (via Audrow)". **History** lists them all, and any one can be compared and restored.
- **Safe together.** Agents edit by replacing exact text, and an edit to a note that changed since the agent read it is refused, so it reads again instead of overwriting you. If you and an agent change the same lines, a banner offers **Keep mine**, **Use theirs** or **Compare**.

## Control what agents can do

- An agent acts with your role in the workspace: a viewer's agent can only read.
- **Connected agents** in the account menu lists your agents, when each was last used and what it changed. **Revoke** cuts one off at its next request.
- Agents can't delete anything for good: what they delete waits in Trash for 30 days.
- The note `AGENTS.md` is sent to every agent as its instructions. Edit it to set your conventions ("put meeting notes in Meetings/", "tag tasks with a project").

## Agents on your own computer

With the local app, agents connect over stdio: `claude mcp add commonink -- commonink mcp`, or command `commonink` with args `["mcp"]` in other clients. Shell agents can use [the command line](cli.md) directly, with `COMMONINK_AGENT=<name>` so their writes are signed.

## What agents can use

The tools cover notes (`search_notes`, `read_note`, `create_note`, `edit_note`, `import_notes`, `move_note`, `archive_note`), tasks (`list_tasks`, `add_task`, `update_task`, `get_today`), boards, tags, smart folders, favorites, history and restore, calendar events and meeting notes, contacts, and sharing. Every tool is also a command: `commonink help` lists them.
