---
pr: null
title: Small UI and accessibility fixes
---
1. Open [[Tea timer]] with the window about 375px wide (or on a phone). The tasks list's Open / Done / All toggle sits whole on its own row, at the right, under Group and Sort. Before, it ran off the card. The Tasks page does the same. At full width, it's back on one line.
2. On [[Tea timer]], press **Start** on the 10-second timer, then open any other note. When "Tea is done" appears, it has an **Open** button. Press Tab until Open has the focus ring (the toast stays while it has the focus), then press Enter to go back to Tea timer. Clicking elsewhere on the toast only closes it.
3. Turn on VoiceOver (⌘F5), press ⌘K and type `>`. Each command's shortcut is read as words, like "Archive note, Command Shift E", not as symbols. The footer and the shortcut sheet (`?`) read the same way.
4. On a phone or a tablet, star [[Tea timer]] and open the sidebar. Each favorite shows its split and star buttons, and each folder shows + and the trash can, without a hover. Each one is 44px to tap. Tap the star to unstar it.
5. Locally only, since the Preview is online: run `npm run dev`, open the browser's console and reload. There's no failed `GET /api/me` any more.
