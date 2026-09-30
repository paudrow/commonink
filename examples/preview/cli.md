---
pr: 92
title: One command table for the CLI and agents
---
The CLI and the MCP tools are now made from one list of commands, and agents can do what the app does: see Trash and restore from it, rename tags, read what a change did, list folders, and more. The CLI itself runs on your computer (steps 6 and 7); the rest you can try here with Claude.

1. **Connect Claude to this Preview.** In claude.ai, open **Settings → Connectors → Add custom connector**. Name it "Common Ink (PR 92)", paste `https://pr-92-commonink.draftox.workers.dev/mcp`, then **Add** and **Connect**. On the Common Ink page, pick your notes and click **Allow**.
2. **Trash and back.** In a new chat with the connector on, ask: "Delete the note Scratch pad, then tell me what's in Trash, and put it back." Claude uses `delete_note`, `list_trash` and `restore_from_trash`. [[Scratch pad]] is back where it was, and **History** shows three changes, each "Claude for you".
3. **Rename a tag.** Ask: "Rename the tag #draft to #wip." Claude uses `rename_tag`. [[Release notes]] now says `#wip`, and the Tags section in the sidebar has `wip`, not `draft`.
4. **Read a change.** Ask: "What did the last change to Release notes do?" Claude finds it with `recent_changes` and shows it with `show_change`: a diff with `-#draft` and `+#wip`.
5. **Undo it.** Ask: "Restore Release notes to how it was before that change." Claude uses `restore_change`, and the note says `#draft` again.
6. **The CLI, on your computer.** With this branch checked out (`gh pr checkout 92 && npm install`), run `bin/quire help`. The commands are grouped by area. `bin/quire help task update` shows every option with examples, and ends with "The MCP tool update_task does the same."
7. **Made for scripts.** Run `export QUIRE_VAULT=$PWD/examples/vault` and `alias quire=$PWD/bin/quire`. Then `quire tasks --json` prints tasks as JSON, and `quire read Nowhere; echo $?` ends with `3` (not found). Run `source <(quire completion zsh)` (or `bash`), type `quire ta` and press Tab: it offers tag, tags, task and tasks.
