---
pr: 58
title: Security hardening
---
# Security hardening

Sessions now live on the server, every page runs under a strict Content-Security-Policy, and HTML notes run in their own sandbox page. Check that nothing you use every day broke.

1. **Sign in again.** Sessions from before this change don't carry over, so the first visit after it deploys asks you to sign in once. On this Preview that happens by itself. After that, reloading keeps you signed in.
2. **Sign out everywhere.** Open this Preview in a second tab. In the first tab, open the account menu at the bottom of the sidebar and choose **Sign out everywhere…**. The second tab reloads by itself and goes back through sign-in. On a Preview that sign-in is automatic, so you land back in the app with a new session.
3. **An HTML note still runs its script.** Open [[Script check]]. The heading changes from "Waiting for the script…" to "The script ran", and the counter button works. The script runs sandboxed, so it can't read your cookies. The page says so.
4. **Embeds and link cards still load.** Open [[Embeds check]]. The YouTube video and the X post load, and the example.com link shows a card with its title.
5. **Uploads still work.** Drag any image onto [[Embeds check]], or use **Assets → Upload**. It shows in the note and in Assets.
6. **Nothing is blocked.** For a closer look, open the browser's developer console while you do the steps above. It should show no "Content Security Policy" errors.
