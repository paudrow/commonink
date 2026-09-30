---
pr: 114
title: Quire is now Common Ink
---
Nothing says Quire any more: the app, the docs, the CLI (`commonink`), its env vars (`COMMONINK_*`), the MCP server's name and the code all say Common Ink. What people set up under the old name keeps working and moves over by itself.

1. **The app.** Look around: the sidebar, the tab's title, **Getting started**, **AGENTS.md** and the account menu all say Common Ink.
2. **Links.** Open [[Links after the rename]]. Click each link, then a link inside the embedded roadmap (**Outside-in agents**): each opens its note. (Links to notes changed their hidden address from `quire:` to `commonink:`.)
3. **Your settings move over.** Open the browser's console and run `localStorage.setItem("quire.theme", "dark")`, then reload. The app is dark, and `localStorage.getItem("commonink.theme")` says `"dark"` while `localStorage.getItem("quire.theme")` says `null`: it moved, once. Switch the theme back from the account menu if you like.
4. **The CLI, from a checkout of this branch** (`gh pr checkout 114 && npm install`):
   - `cp -r examples/vault /tmp/new`, then `COMMONINK_VAULT=/tmp/new bin/commonink ls` lists the sample notes.
   - `QUIRE_VAULT=/tmp/new bin/quire ls` still works. It says first that quire is now commonink, and that `QUIRE_VAULT` is now `COMMONINK_VAULT`.
5. **A vault from before the rename keeps its history.** Make one: `cp -r examples/vault /tmp/old && COMMONINK_VAULT=/tmp/old bin/commonink star Tips && mv /tmp/old/.commonink /tmp/old/.quire`. Then `COMMONINK_VAULT=/tmp/old bin/commonink starred` still lists Tips, and `ls -a /tmp/old` shows `.commonink` and no `.quire`.
6. **Agents.** In Claude's connector settings, the server for this Preview (`/mcp`) calls itself **commonink**. The tools have the same names as before.
