---
title: Moving in
description: Bring your notes from Obsidian, Notion, Evernote, Apple Notes or markdown files into Common Ink.
---

# Moving in

Bring everything you have in one go. In the app, press ⌘⇧P and pick **Import notes…**, then choose your files, a `.zip` or an export. From a terminal, `commonink import <files or folder>` does the same. Folders are kept, pictures come along, and a note that's already there is left as it is.

| Coming from | What to pick | What happens |
| --- | --- | --- |
| Obsidian | Your vault, zipped, or the folder with the CLI | Nothing to convert: links, embeds, tags and callouts already work |
| Notion | The Markdown & CSV export (.zip) | Page names and links lose Notion's ids; databases come as .csv files |
| Evernote | One .enex file per notebook | Each note becomes markdown with its tags, dates and pictures |
| Apple Notes | A folder saved by our script, zipped | Each note becomes markdown, a folder per Notes folder |
| Markdown files | The files, a folder or a .zip | Each file is a note at its path |

## Obsidian

Obsidian vaults are folders of markdown, which is what Common Ink keeps, so your `[[links]]`, `![[embeds]]`, `#tags`, frontmatter and `> [!note]` callouts work as they are.

- **In the app:** zip the vault folder (on a Mac, right-click it and choose Compress), then **Import notes…** and pick the .zip.
- **From a terminal:** `commonink import ~/Obsidian/MyVault`

The `.obsidian` settings folder and other hidden folders are left out.

## Notion

1. In Notion, open **Settings**, then **Export all workspace content** (or a page's **⋯** menu, then **Export**, for one page and its subpages).
2. Choose **Markdown & CSV**, and include subpages and files.
3. In Common Ink, **Import notes…** and pick the .zip Notion gave you. Don't unzip it first.

Notion ends every name with an id (`Plan 1a2b3c….md`). Those come off, from files, folders and the links between pages, so `Plan 1a2b3c….md` arrives as `Plan.md` and links to it keep working. Two pages with the same title become `Untitled.md` and `Untitled 2.md`. Databases arrive as `.csv` files beside their pages.

From a terminal: `commonink import Notion-Export.zip --folder Notion`

## Evernote

1. In Evernote, right-click a notebook and choose **Export notebook…**, then **ENEX**. Do this for each notebook you want.
2. In Common Ink, **Import notes…** and pick the `.enex` files (several at once is fine).

Each notebook becomes a folder. Each note becomes a markdown note with its created and updated dates, tags and source address in its frontmatter. Checklists become tasks, and pictures and attachments go in the notebook's `attachments` folder, shown where they were in the note.

From a terminal: `commonink import Evernote/*.enex`

## Apple Notes

Apple Notes has no export of its own, so a small script asks Notes for each note and saves it. On a Mac:

1. Download [export-apple-notes.js](https://github.com/paudrow/commonink/blob/main/scripts/export-apple-notes.js).
2. In Terminal, run `osascript -l JavaScript export-apple-notes.js`. Notes asks once to let it be controlled. Your notes are saved to `AppleNotesExport` on your Desktop, a folder per Notes folder.
3. Zip that folder, then in Common Ink press ⌘⇧P and pick **Import from Apple Notes…**.

From a terminal: `commonink import ~/Desktop/AppleNotesExport --from apple-notes`

Locked notes are skipped. Pictures inside notes don't come along yet, since Notes keeps them outside a note's text.

## Markdown files and other apps

Any app that exports markdown (Bear, Logseq, Joplin, Craft, Typora, Google Docs as .md) works with **Import notes…**: pick the files, or a .zip of a folder of them. HTML files come in as HTML notes, which Common Ink shows as pages.

## Good to know

- **Nothing is half done.** Every path is checked before anything is written, so a problem (a name used twice, say) stops the import and says why.
- **Run it again safely.** A note that's already there is skipped. To overwrite instead, use `commonink import … --existing replace`; History keeps what each note was.
- **Size.** Up to 2,000 notes and 100 MB at once. For a bigger vault, import a folder at a time.
- **Agents can import too.** Over MCP, `import_notes` takes up to 2,000 notes as path and markdown in one call.
- **Leaving is as easy.** ⌘⇧P, then **Export all notes (.zip)**, gives you every note and file as markdown, ready to open in Obsidian.
