---
title: Questions
description: What's free, where your notes live, what agents can see, and how to leave.
---

# Questions

## Is there AI inside Common Ink?

No. Common Ink has no model of its own. You bring the agents you already use (Claude, Cursor, your own scripts), and they work in your notes from the outside, through MCP, the command line or the files. Nothing you write is sent to a model unless you connect one.

## What does it cost?

The hosted app is free while it's in preview. The local app, the command line and the MCP server are free.

## Where do my notes live?

Online, in your workspace on Cloudflare's infrastructure, readable only by the people and agents you let in. Locally, in a folder of markdown files on your computer. Either way, ⌘⇧P, then **Export all notes (.zip)**, gives you everything as plain markdown at any time.

## Can I use it with Obsidian?

Yes. Common Ink reads Obsidian's links, embeds, tags and callouts, so a vault imports as it is, and an export opens in Obsidian. Locally, you can point Common Ink at your vault folder and use both.

## What can a connected agent see?

The workspace you picked when you allowed it, with your role there. It can't see your other workspaces, and a viewer's agent can only read. **Connected agents** in the account menu shows what each one changed lately, and **Revoke** cuts it off.

## What if an agent makes a mess?

Every change is signed and kept. Undo an agent's edit from its toast, or restore any earlier version from the note's History. Agents can't delete anything for good: deleted notes wait in Trash for 30 days.

## Does it work on my phone?

The web app works in a phone's browser, and you can add it to your home screen. Share to Common Ink from other apps to capture a link or a picture.

## How do I move my notes in?

See [Moving in](import.md): Obsidian, Notion, Evernote, Apple Notes and markdown files.

## How do I delete my account?

Write to [support@commonink.app](mailto:support@commonink.app) and we'll delete your account, notes and files. Export them first if you want a copy.

## Something's wrong. Who do I tell?

[support@commonink.app](mailto:support@commonink.app), or open an issue on [GitHub](https://github.com/paudrow/commonink/issues).
