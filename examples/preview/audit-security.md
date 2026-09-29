---
pr: 64
title: Security audit
---
# Security audit

This audit fixed crashes, slowdowns and a few ways a note could act on the people reading it. These are the fixes you can see.

1. **A stray % doesn't break a note any more.** Open [[Percent link]]. It contains `[done](100%)`, which used to crash the local app and make the note fail online. Now it opens, and you can edit and save it. Add another `[x](50%)` and save to check.
2. **An image can't sign you out.** Open [[Image trap]]. It has an image whose address is the sign-out page. Before, just viewing the note signed you out. Now the image is broken and you stay signed in.
3. **Sign out asks first.** Visit `/auth/logout` in the address bar. Instead of signing you out, it shows a "Sign out of Common Ink?" page with a button. **Sign out** in the account menu still works, since it sends the sign-out as a POST (on a Preview you're signed back in at once).
4. **Invite links ask, then work once.**
   1. In the account menu, choose **New team workspace…** and name it. Then choose **Copy invite link**.
   2. Open a private window, go to `/auth/dev?as=sam` on this Preview to be someone else, then paste the invite link. A page asks "Join <workspace>?". Nothing happens until you click **Join**. Then you're in.
   3. In another private window, go to `/auth/dev?as=kim` and paste the same link. It says the link has been used.
5. **Links in cards open a new tab.** Open [[Card links]]. Click the link in the card's details. It opens in a new tab and the app stays where it was. Before, it replaced the app.
6. **A task can't carry a form.** In [[Card links]], the second card's text has a form in it. It shows as plain text, with no password box or button.
