---
pr: 62
title: Connect an agent
---
Agents like Claude can now connect to a hosted workspace over MCP, sign in with OAuth, and work in your notes as you. You'll need claude.ai (or Claude Desktop) signed in to your own account.

1. **Add the connector.** In claude.ai, open **Settings → Connectors → Add custom connector**. Name it "Common Ink (PR 62)" and paste `https://pr-62-commonink.draftox.workers.dev/mcp`, then **Add**.
2. **Approve it.** Click **Connect**. A Common Ink page opens (on this Preview you're signed in already) and asks "Connect Claude to Common Ink?". It names where access goes and lists your workspaces with your role in each. Pick your notes and click **Allow**. The page sends you back to Claude.
3. **Have Claude write something.** In a new chat with the connector turned on, ask: "Append a line saying hello to the note Agent inbox, then create a note called Hello from Claude." Claude uses `append_to_note` and `create_note`.
4. **See who did it.** Back here, open [[Agent inbox]]: the new line is there. Open **History**. Both changes are attributed to "Claude (via …)", with your first name.
5. **Open Connected agents.** In the account menu at the bottom of the sidebar, choose **Connected agents…**. Claude is listed with the workspace, your role, when it connected and last did something, and its recent changes.
6. **Revoke it.** Click **Revoke** and confirm. The list is empty.
7. **The next call is refused.** Ask Claude to read [[Agent inbox]] again. The call fails with an authorization error, and Claude offers to connect again. Revoking takes effect at once, with no waiting for a token to expire.
