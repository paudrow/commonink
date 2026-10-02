---
pr: 284
title: While you were away
---
A one-line summary at the top of Notes and Today of what agents did since your own last change.

1. Edit any note yourself, so there's a "your last change" to count from. Close the tab.
2. Have an agent change a few things. From a terminal with the CLI: `COMMONINK_AGENT=claude commonink task add "Call the plumber tomorrow"` and `COMMONINK_AGENT=claude commonink append Tips.md "- [ ] Water the plants"`. Or ask Claude through MCP to add two tasks.
3. Open the app again. Notes starts with a line like "claude created 1 note, changed 1 other note and added 2 tasks while you were away", with **See changes** and ×.
4. Open **Today**. The same line is at its top.
5. Click **See changes**. History opens with a "While you were away" chip and the AI filter on, showing only those changes, all selected. The right side shows every note they touched.
6. Click the × on the chip to go back to the whole timeline. Go back to Notes: the line is gone, since you've seen it.
7. Have the agent change one more thing and switch back to the tab. The line comes back, counting only the new change.
8. Edit a note yourself and reload. Nothing shows: there's nothing new since your own change.
