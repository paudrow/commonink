---
pr: 0
title: Accessibility follow-ups
---
Small fixes for keyboard, screen reader and motion-sensitive users. Most of them don't change how the app looks.

1. Reload the page, click the address bar, and press Tab once. A "Skip to main content" link shows at the top left. Press Enter: the focus jumps past the sidebar to the open page, or into the note's text if a note is open.
2. Hover the moon button at the bottom right. It says "Switch to the dark theme". Click it, and it says "Switch to the light theme".
3. Paste a link like `https://example.com` on its own line in a note so it becomes a link card. Click the card: it opens in a new tab, as before. With a screen reader, the card is now a link you can reach and open with Enter.
4. Open Tasks and hover a task. The three buttons on the right sit a little further apart, so they no longer overlap.
5. Small buttons (a tag's ×, the sidebar row buttons, the × that clears a tag filter, and the arrows on collapsible sections and callouts) look the same but take a click a little further out, 24px across.
6. Online only: open the account menu at the bottom of the sidebar with the keyboard. The focus moves to the first workspace, the arrow keys move between items, and Esc closes it and puts the focus back on the account button.
7. Turn on "reduce motion" in your system settings. Embed a note that has a footnote (`![[Its name]]`) and click the footnote number inside the embed. It jumps to the footnote without the smooth scroll.
