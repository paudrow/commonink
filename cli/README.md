# commonink: the `commonink` CLI

Your Common Ink notes from a shell, for you and your agents. Every command is also an MCP tool (`commonink mcp`), so a script, a person and an agent can all do the same things.

```bash
npx commonink help                     # or: npm i -g commonink, then commonink help
commonink search launch
commonink task add "Pay rent every month on the 1st #home"
commonink get Roadmap --json
```

It works on a folder of markdown notes: `$COMMONINK_VAULT`, or `~/Common Ink` if you don't set it. Needs Node 22.13 or later.

For agents:

- `--json` on every command prints the result as data (and an error as `{"error", "code", "exit"}`).
- Exit codes: 0 ok, 1 error, 2 usage, 3 not found, 4 conflict (the note changed since you read it: read it again), 5 exists, 6 forbidden, 7 auth, 8 unavailable.
- Content comes from stdin with `-` (or piped in). `--base <version>` (from `get`) refuses a write to a note that changed since.
- Set `COMMONINK_AGENT=<your name>` (or `--agent`), so History shows your changes as "<agent> for you".

Hosted workspaces: `commonink login` signs in in the browser (`--server` for another address than https://commonink.app), `commonink workspaces` lists yours and `commonink workspaces use <name>` picks one, `--workspace <name>` picks one for a single command, and `commonink logout` signs out. There, `commonink member list`, `commonink invite create`, `commonink invite list`, `commonink member-role set|remove`, `commonink workspace leave` and `commonink workspace rename|log` manage the workspace itself, as its Settings do. Tokens stay in `~/.config/commonink/credentials.json`, readable only by you.

`commonink help <command>` shows a command's options and examples, and `commonink completion bash|zsh|fish` prints a completion script.
