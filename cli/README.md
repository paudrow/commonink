# commonink: the `quire` CLI

Your Common Ink notes from a shell, for you and your agents. Every command is also an MCP tool (`quire mcp`), so a script, a person and an agent can all do the same things.

```bash
npx commonink help                     # or: npm i -g commonink, then quire help
quire search launch
quire task add "Pay rent every month on the 1st #home"
quire read Roadmap --json
```

It works on a folder of markdown notes: `$QUIRE_VAULT`, or `~/Quire` if you don't set it. Needs Node 22.13 or later.

For agents:

- `--json` on every command prints the result as data (and an error as `{"error", "code", "exit"}`).
- Exit codes: 0 ok, 1 error, 2 usage, 3 not found, 4 conflict (the note changed since you read it: read it again), 5 exists, 6 forbidden, 7 auth, 8 unavailable.
- Content comes from stdin with `-` (or piped in). `--base <version>` (from `read`) refuses a write to a note that changed since.
- Set `QUIRE_AGENT=<your name>` (or `--agent`), so History shows your changes as "<agent> for you".

`quire help <command>` shows a command's options and examples, and `quire completion bash|zsh|fish` prints a completion script.
