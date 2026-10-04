# Common Ink Capture (Chrome extension)

Saves what you're looking at to your Common Ink notes (#380):

- **Save page**: the page's title, its address, and a readable copy of its main content as markdown.
- **Save selection**: the selected text as a quote, with a link back to the page. Also in the right-click menu: **Save selection to Common Ink**.

A capture goes to **today's journal note** (under `## Captured`) unless you pick a folder in the popup, where it becomes a new note named after the page. When it's saved, the popup (or a message on the page, for the right-click menu) links to the note.

## Load it unpacked

1. Open `chrome://extensions` and turn on **Developer mode** (top right).
2. Click **Load unpacked** and choose this folder, `extensions/chrome`.
3. Pin **Common Ink Capture** from the puzzle-piece menu.
4. Sign in to [commonink.app](https://commonink.app) in the same browser profile, if you aren't already.
5. Open any web page and click the button (or press `Alt+Shift+I`), then **Save page** or **Save selection**.

There's no build step: the folder is plain JavaScript, HTML and CSS. After you change a file, click the reload arrow on the extension's card.

## Using another server (a PR preview, local dev)

Right-click the button → **Options**, and enter the server's address, like `https://pr-123-commonink.draftox.workers.dev` or `http://localhost:8787`. Chrome asks you to allow the extension to reach it. Sign in to that server in the same profile.

## How it signs in

It doesn't have its own sign-in, and no token is pasted anywhere. It calls the server's API with the session cookie your browser already has for Common Ink (`fetch` with `credentials: "include"`, allowed by the extension's host permission for that server). Signed out, the popup says so and links to the app.

What it calls:

- `GET /api/me`: who's signed in, and their workspaces.
- `GET /api/w/<workspace>/notes`: the folders to offer.
- `POST /api/w/<workspace>/capture`: the save. The body is `{ today, title, url, html | text, folder? }`; the server turns the page's HTML into markdown and answers with the note's path and its address in the app.

The API refuses writes from other origins. Capture is the one route it takes from an extension: the request's `Origin` must be a `chrome-extension://` one (a web page can't send that), with the `X-Common-Ink-Capture: 1` header and a JSON body.

## What it keeps

Only two settings, in `chrome.storage.sync`: the server's address, and which workspace you last picked. No note, page or selection is stored by the extension.

## Layout

- `manifest.json`: Manifest V3.
- `lib.js`: what's shared and tested (`test/chrome-extension.test.ts`): the request, reading a page, the server setting.
- `popup.html`, `popup.js`, `popup.css`: the popup.
- `background.js`: the right-click menu.
- `options.html`, `options.js`: the server setting.

## Not yet

Follow-ups from #380, not in this first version: images and screenshots, right-click entries for links and images, tags, a quick note or task typed into the popup, an Inbox destination, and a shortcut that saves without opening the popup.
