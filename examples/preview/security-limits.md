---
pr: 59
title: Link previews and rate limits
---
# Link previews and rate limits

The link-card fetcher now reads only public web pages, and sign-in, invites, uploads and link cards have rate limits. You mostly can't see this working: that's the point. Here's what you can check.

1. **A normal link still gets a card.** Open [[Link cards]]. The example.com link shows a card with its title, "Example Domain".
2. **A private address stays empty.** In the same note, the `169.254.169.254` link is the cloud metadata address an attacker would point a note at. Its card shows only the address, with no title and no description, because the fetcher refused to request it.
3. **Normal use doesn't hit a limit.** Paste a few more links on their own lines, upload a couple of files, and copy an invite link from a team workspace. None of these should say "Too many". The limits are 120 link cards a minute and 120 uploads, 20 invites and 10 new workspaces an hour.
