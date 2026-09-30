---
pr: 0
title: An unreadable file no longer stops the local server
---
Running locally, the server answered a request for an image or PDF it couldn't open by crashing. The file might have no read permission, or it was deleted between the check and the read. Every open tab lost its connection, and edits stopped saving until you restarted it. Now it answers 404. Online isn't affected.

1. Run Common Ink locally against a copy of a vault. In a terminal: `touch vault/assets/locked.png && chmod 000 vault/assets/locked.png`.
2. Open **Assets**. The locked file's tile shows it can't be loaded.
3. Keep typing in any note. It still saves, and the live dot stays green.
4. `chmod 644 vault/assets/locked.png` to put it back.
