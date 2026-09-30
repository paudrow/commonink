---
pr: 115
title: A new note's first title doesn't split it in two
---
A new note is renamed after its first title, and the rename used to race the next save. On a slow connection, the typing that landed during the rename went to a second note under the old "Untitled" name. The renamed note missed it, and the next save showed a false "edits overlap" banner.

1. Open the browser's developer tools, and in Network set throttling to **Slow 4G** (or 3G).
2. Press **New note** in the sidebar. Type a title over "Untitled", such as `Slow day`, then press Enter twice and type a sentence.
3. Keep typing a few words while it says "Saving…", then stop and wait for "Saved". Type one more line and wait again.
4. The note is now "Slow day" and holds everything you typed. There's no banner, and Notes has no leftover "Untitled" note. See [[Slow network]] for the same steps.
5. Turn throttling back off.
