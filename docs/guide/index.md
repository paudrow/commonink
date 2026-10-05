---
title: Getting started
description: What Common Ink is, and your first ten minutes with it.
---

# Getting started

Common Ink is a notes app that your AI agents can work in. Your notes are plain markdown. Claude, Cursor or any script reads and edits them through MCP, a command line or the files themselves, and every change an agent makes shows up live in the editor, highlighted and signed with its name.

## Sign in

Open [v1.commonink.app](https://v1.commonink.app) and sign in with Google. You get a personal workspace with a **Welcome** note and **Getting started**, a short guide that walks you through the app (it's on the Notes page, marked Start here).

Prefer your own computer? The same app runs locally on a folder of markdown files, free. See [the command line](cli.md#local).

## Your first ten minutes

1. **Write a note.** ⌘⇧P (Ctrl+Shift+P off a Mac), then **New note**, makes one. Its first `# heading` is its name: change the heading and the note is renamed, with links to it updated.
2. **Link notes.** Type `[[` and pick a note, or `@` to link a note or a person. `![[Note]]` shows another note inline.
3. **Add a task.** A line like `- [ ] Send invoice due:friday #work` is a task. ⌘⇧. adds one from anywhere, the way you'd say it: "Pay rent every month on the 1st #home". **Tasks** shows them all, with **Today** on top.
4. **Bring your notes in.** ⌘⇧P, then **Import notes…** takes markdown, an Obsidian vault, a Notion export, Evernote files or Apple Notes. See [Moving in](import.md).
5. **Connect an agent.** Add `https://v1.commonink.app/mcp` as a connector in Claude, Claude Code or Cursor, and ask it to do something in your notes. Watch the edit land. See [Connect an agent](agents.md).

## Find your way around

| Keys | What it does |
| --- | --- |
| ⌘K or ⌘P | Find a note by name or by what's in it |
| ⌘⇧P | Every command, by name |
| ⌘⇧. | Add a task |
| ⌘⇧F | Notes, the home page |
| ⌘, | Settings |
| ? | Every keyboard shortcut (outside the editor) |

Off a Mac, ⌘ is Ctrl. Shortcuts follow the character you type, so they work on any keyboard layout. Vim keys are in Settings.

## What else is in here

- [Writing notes](notes.md): links, tags, tasks, boards, templates, widgets.
- [Moving in](import.md): from Obsidian, Notion, Evernote, Apple Notes or markdown files.
- [Connect an agent](agents.md): Claude, Claude Code, Cursor and others, and seeing what they did.
- [Sharing and teams](sharing.md): workspaces, roles, share links, export and history.
- [The command line](cli.md): `commonink` for scripts, agents and you.
- [Questions](faq.md): what's free, where your notes live, and more.
