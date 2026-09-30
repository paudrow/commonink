---
pr: 0
title: No workspace talk in a local vault's smart folders
---
The change is for local vaults (`npm run dev`). A Preview is online, so it's the check that nothing changed there.

1. On this Preview, click the **+** on the Smart folders header. **Just me** is still there, with "Otherwise everyone in the workspace sees it". Save one: the toast still says who sees it.
2. Locally (`npm run dev` on this branch), click the same **+**. There's no **Just me** row, since a local vault has no one else in it. Save one: the toast says "Saved …" and nothing about a workspace.
3. Locally, delete that smart folder from its sliders. The confirmation doesn't say "for everyone in the workspace".
