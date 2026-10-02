---
title: The command line
description: The commonink CLI for scripts, shell agents and you, on your own computer or a hosted workspace.
---

# The command line

`commonink` does everything the app and the MCP tools do, from a terminal: for scripts, shell agents and you.

## Install

```bash
git clone https://github.com/paudrow/commonink && cd commonink
npm install
bin/commonink help           # the commands, by area
bin/commonink help import    # one command's options and examples
```

It needs Node 22.13 or newer. Put `bin` on your `PATH` to type just `commonink`. Once it's published to npm, `npm install -g commonink` (or `npx commonink …`) will do instead. `source <(commonink completion zsh)` adds tab completion (`bash` and `fish` too).

## Your hosted workspace

```bash
commonink login              # signs in through your browser
commonink workspaces         # yours, with your role in each
commonink workspaces use "Acme team"
```

`--workspace <name>` picks one for a single command. `--no-browser` on `login` prints the address to open elsewhere, for a machine you reach over SSH. `commonink logout` signs out; the CLI shows in **Connected agents** as "commonink CLI", where you can also revoke it.

## Local

Without signing in, `commonink` works on a folder of markdown on your computer: `$COMMONINK_VAULT`, or `~/Common Ink`. `--workspace local` uses it even when you're signed in. The local app, with the same editor, runs from the same checkout: `npm run dev`, then open `http://localhost:4777`.

## Everyday commands

```bash
commonink search "launch plan"
commonink read "Projects/Launch"
commonink create "Ideas/Pricing" - < draft.md
echo "- [ ] Call Sam due:friday" | commonink append "Journal/2026-10-02" -
commonink tasks --due "<=today"
commonink today
commonink import ~/Obsidian/Vault --folder Imported
commonink export / --format zip --out notes.zip
commonink changes --path "Projects/Launch.md"
commonink restore 24
```

## For scripts and agents

- `--json` prints any result, or an error, as JSON.
- Exit codes are stable: 0 ok, 1 error, 2 usage, 3 not found, 4 conflict (the note changed since you read it), 5 exists, 6 forbidden, 7 auth, 8 unavailable.
- `--base <version>` (from `commonink read`) makes `edit`, `append`, `write` and `restore` refuse a note that changed since.
- Content comes from stdin with `-`, or piped in.
- `COMMONINK_AGENT=<name>` (or `--agent`) signs writes as that agent, shown as "<agent> for you" in History.
- `commonink upload` and `commonink download` move files in and out.
