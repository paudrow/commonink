---
pr: 65
title: Performance
---
This Preview holds only the small sample vault, so most of the gains (built for 10k notes) show up as "nothing to wait for". Open DevTools (⌥⌘I) → Network for steps 1 and 2.

1. Reload the page. In Network, the scripts and styles under `/assets/` now say "(disk cache)" or "(memory cache)" instead of going back to the server, and Notes appears at once.
2. Tick or untick a task in any note. The Tasks count in the sidebar updates, and Network shows a tiny `tasks/count` request (a few bytes) instead of every task in the workspace.
3. Open Tasks, Today and a note's backlinks: they come straight from the index now, with no pause while notes are read.
4. Click History, Assets and Tags in the sidebar. Each loads the first time it's opened (a small script in Network) and opens right away after that.
5. Type `/kanban` in a note and pick "Kanban board". The board's code loads with that first board; drag a card to check it works as before.
6. In Notes, scroll to the bottom. Past 40 notes, more cards load as you go, and now only the new ones are drawn, so scrolling stays smooth. The sample vault has fewer than 40, so this one shows best with `npm run bench:web` locally.
7. Press ⌘K and search for a couple of words. Results come back as you type.
8. For the numbers, see the before/after table in the PR, or run `npm run bench` (the core, at 1k and 10k notes), `npm run bench:cloud`, `npm run bench:bundle` and `npm run bench:web` locally.
