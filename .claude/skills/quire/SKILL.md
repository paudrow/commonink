---
name: quire
description: Notes vault (Quire) — find, read, and edit the user's markdown notes with the `quire` CLI. Use when the user mentions their notes, vault, journal, or asks to save, look up, or link something in notes.
---

The vault is plain markdown the user is editing live in the Quire app. Every write you make shows up in their editor, highlighted and attributed to you, so set `QUIRE_AGENT=<your-agent-name>` (e.g. `QUIRE_AGENT=claude-code`) or pass `--agent <name>` on every write.

Run `bin/quire help` from the Quire project root for the command list, and `bin/quire help <command>` for one command's options and examples. Add `--json` for data; exit code 3 means no such note, 4 means the note changed since you read it. Vault conventions (folders, journal format, linking) live in `vault/AGENTS.md`; read it before your first write in a session.

## Changing a note

1. **Find it**: `bin/quire search <words>`. Done when you have the note's path; if nothing matches, `bin/quire ls` and look by folder.
2. **Read it**: `bin/quire read <note>`. Note the `version:` line.
3. **Edit it**: `bin/quire edit <note> --old '<exact text>' --new '<replacement>' --base <version>`. Make the smallest replacement that does the job, with enough surrounding text in `--old` to match exactly once. Done when it prints `Edited … → version …`.
   - On `not found` or a version mismatch the user has changed the note: re-read and redo step 3 against the new text.
4. For logs and inboxes use `bin/quire append <note> -` (stdin) instead of editing.

## New notes and links

- `bin/quire create <Folder/Title> -` with the body on stdin; start the body with `# Title`.
- Link with `[[Note name]]`, embed with `![[Note name]]` or `![[Note name#Heading]]`. Links resolve by name, so keep titles unique.
- Rename with `bin/quire mv`, which rewrites every link to the note.
- To catch up on what changed (and who changed it) since you last looked: `bin/quire changes --since <id or ISO time>`.
