---
pr: 129
title: An agent's edit next to yours merges instead of conflicting
---
When an agent changed a note while you were typing in it, the two versions merged only if the changes were at least a line apart. Otherwise you got "the edits overlap" with Keep mine and Use theirs. That included an agent adding a line at the end while you typed at the end, and an agent ticking the task right under the one you were editing. Now those merge. Only both sides changing the same line still asks.

1. Open [[Shared journal]] and click at the end of its last line. Connect an agent, or run the CLI locally.
2. Start typing a sentence, and while you type, have the agent add a line to the Log: "append '- 10:00 — checked the build' to Shared journal". Your sentence and its line are both there, with no banner.
3. Put the cursor on "Draft the agenda" and type a few words at its end. Meanwhile, have the agent tick "Book the room" right below it. Both changes stay.
4. For a real overlap, type on "Draft the agenda" while the agent edits that same line. The banner still asks which to keep.
