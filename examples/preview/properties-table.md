---
pr: 304
title: Properties as a table
---
1. Open [[Weekly sync]]. Its properties are a table: `date` has a date picker, `draft` a checkbox, `tags` and `people` are chips, and `status` and `priority` are text fields. Each row shows its type beside its name: `tags`, `date` and `people` are Common Ink's own, so theirs is fixed; `draft`, `status` and `priority` have a dashed chip, since their type is only guessed from their value (hover one to read why).
2. In `people`, type `an`: **Ana Ruiz** is suggested from Contacts (workspace members without a contact are listed too; picking one makes their contact). Pick her and she's added as a link. Click her chip to open her contact, which now lists Weekly sync.
3. Click **Add property**. The properties a note can have are offered with their type (`title`, `published`, …). Type `owner` and press Enter to add a property of your own.
4. Hover a row and click × to remove it. Only that line of the YAML changes.
5. Click `priority`'s type chip (**text**) and pick **number**. The chip turns solid, `priority` gets a number field, and `Config/Settings.md` now has `properties:` with `priority: number` (open it with ⌘K "Settings.md"). Every note's `priority` is a number now: type `high` in it and the row turns red with "priority is a number". Click the chip again and pick **Guess from its value** to take the declaration back out.
6. Ask an agent "What properties do my notes have?" It uses `list_properties` (or `commonink property list`), which lists `priority: number (declared)` and the rest with their types. "Make `due` a date for every note" uses `set_property_type`, and the line appears in `Config/Settings.md`.
7. Click **YAML** (or a property's name) to edit the raw text. Agents writing front matter work as before.
8. Open [[Properties with problems]]: each row with a problem is red, with the message under it. `Sam` in `people` isn't linked to a contact, so it says so.
9. Open Settings → User → **Open settings file**: every setting is a row with the right control (`theme` is a dropdown, `vim` a checkbox), and the ones you haven't set are listed under them with **Add**.
