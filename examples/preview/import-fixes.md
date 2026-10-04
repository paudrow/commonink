---
pr: 189
title: Import fixes
---
1. Open [[Moved over]]. **Weekly review** and **Q3 planning** are links to notes that were never brought in: they're grey with a dashed underline, and hovering one says so. Click **Weekly review** to create it, then go back: that link looks like every other link now.
2. Agents have `list_missing_links`, and the CLI has `commonink missing-link list`: each link that goes nowhere, with every note and line that has it. Run `commonink missing-link list "Try/Import fixes"` against this workspace to see **Q3 planning** listed with its line in Moved over.
3. `create_note` (CLI: `commonink create`) takes `overwrite` now. `commonink create "Try/Import fixes/Moved over" "# Moved over again" --overwrite` replaces the note instead of failing with "already exists"; the old text is in its History.
4. Open **Contacts**. Alex Rivera has a **Check in** badge: their note says `check_in: every 2 weeks`, and the last note that mentions them, [[Coffee with Alex]], is three weeks old. Pick **Due for a check-in** in the filter menu to see only who's due.
5. Open Mina Okafor. **Check in** is a menu (Every month) with the next one due four weeks after [[Mina sync]]. Change it to Every week, or Not set, and the note's `check_in:` line follows.
6. Agents can ask `list_contacts` with `check_in_due` ("who should I check in with?"), and set a rhythm with `update_contact` `check_in`. In the CLI: `commonink contact list --check-in-due` and `commonink contact get "Mina Okafor" --check-in weekly`.
