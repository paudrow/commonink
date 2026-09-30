---
pr: 91
title: Sharing notes
---
This PR is the model and its enforcement: who a note is shared with, and what they can reach. The share dialog, the link page and Shared with me come in the next PR, so for now you try it through the API and an agent. This Preview has shared [[Plan for Sam]] (editor), [[Read only for Sam]] (viewer) and the folder **Shared folder** (viewer) with a second person, Sam Dev, and [[Public page]] with anyone who has the link. [[Secret numbers]] isn't shared.

1. **As Sam.** In a private window, open `/auth/dev?as=sam` on this Preview, then `/api/shared`. It lists the three notes shared with Sam, and nothing else.
2. **Nothing else of your workspace.** Still as Sam, open `/api/w/<your workspace id>/search?q=Q4` (the id is in `/api/shared`): it's a 404, like every other part of your workspace.
3. **The public link.** Open the link listed under **Set up for you** below, signed out. It reads [[Public page]]. Its `resolve` for "Secret numbers" answers `{"noAccess":true}`, without the title.
4. **With an agent.** Connect Claude to this Preview (see the remote MCP section in the README) and ask: "Who is Plan for Sam shared with?" It uses `list_shares`. Then: "Share Read only for Sam with anyone who has the link, for 7 days." It uses `share_note` and gives you the link.
