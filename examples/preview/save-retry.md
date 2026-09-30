---
pr: 0
title: Saves that fail are tried again
---
A save that couldn't reach the server used to stay "Not saved" until you typed again, even after the connection came back. Closing the tab then lost the text without a word.

1. Open [[Offline draft]]. In the browser's developer tools, set Network to **Offline**.
2. Type a sentence at the end of the note. The status in the top bar says "Not saved", and the live dot says it's reconnecting.
3. Set Network back to **No throttling** and don't type. Within a few seconds the status says "Saved". Reload the page: the sentence is there.
4. Go offline again, type a word, and wait for "Not saved". Now close the tab or reload. The browser asks before leaving. Stay, go back online, and it saves.
