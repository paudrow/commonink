---
pr: 304
title: Properties as a table
---
1. Open [[Weekly sync]]. Its properties are a table: `date` has a date picker, `draft` a checkbox, `tags` and `people` are chips, and `status` is a text field.
2. In `people`, type `an`: **Ana Ruiz** is suggested from Contacts (workspace members without a contact are listed too; picking one makes their contact). Pick her and she's added as a link. Click her chip to open her contact, which now lists Weekly sync.
3. Click **Add property**. The properties a note can have are offered with their type (`title`, `published`, …). Type `owner` and press Enter to add a property of your own.
4. Hover a row and click × to remove it. Only that line of the YAML changes.
5. Click **YAML** (or a property's name) to edit the raw text. Agents writing front matter work as before.
6. Open [[Properties with problems]]: each row with a problem is red, with the message under it. `Sam` in `people` isn't linked to a contact, so it says so.
7. Open Settings → User → **Open settings file**: every setting is a row with the right control (`theme` is a dropdown, `vim` a checkbox), and the ones you haven't set are listed under them with **Add**.
