---
pr: 62
title: Connect an agent
---
Agents like Claude can now connect to a hosted workspace over MCP, sign in with OAuth, and work in your notes. Every change records the person and the agent separately, so History can show what AI did.

1. **See what AI changed, without connecting anything.** Setting up this Preview connected two agents, "Claude" and "Cursor", and had them make a few edits. Open **History**. Their changes have a bot icon and read "Claude for you". Click **AI** to see only theirs, **People** to hide them, or pick one agent from **One agent…**. Reload: History remembers your choice. Open [[Agent handoff]] and its History from the top bar; the same filters are there.
2. **Connect your own.** You'll need claude.ai (or Claude Desktop) signed in to your own account. In claude.ai, open **Settings → Connectors → Add custom connector**. Name it "Common Ink (PR 62)" and paste `https://pr-62-commonink.draftox.workers.dev/mcp`, then **Add**.
3. **Approve it.** Click **Connect**. A Common Ink page opens (on this Preview you're signed in already) and asks "Connect Claude to Common Ink?". It names where access goes, says its changes will show as "Claude for <your first name>", and lists your workspaces with your role in each. Pick your notes and click **Allow**. The page sends you back to Claude.
4. **Have Claude write something.** In a new chat with the connector turned on, ask: "Append a line saying hello to the note Agent inbox, then create a note called Hello from Claude." Claude uses `append_to_note` and `create_note`.
5. **See who did it.** Back here, open [[Agent inbox]]: the new line is there, tagged with a bot and "Claude for you" if you had it open. In **History**, with **AI** on, both changes are there.
6. **Open Connected agents.** In the account menu at the bottom of the sidebar, choose **Connected agents…**. Your Claude is listed with the workspace, your role, when it connected and last did something, and its recent changes (next to the two this Preview set up).
7. **Revoke it.** Click **Revoke** on yours and confirm. It's gone from the list.
8. **The next call is refused.** Ask Claude to read [[Agent inbox]] again. The call fails with an authorization error, and Claude offers to connect again. Revoking takes effect at once, with no waiting for a token to expire.
