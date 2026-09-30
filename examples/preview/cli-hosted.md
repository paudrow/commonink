---
pr: 96
title: The CLI in a hosted workspace
---
The `quire` CLI can now sign in to a hosted workspace and run every command there, with your role in it. Its writes are yours, or "<agent> for you" when an agent says it's the one writing. You'll need a terminal with this branch checked out: `gh pr checkout 96 && npm install`, then `unset QUIRE_VAULT` (with it set, the CLI uses the local vault).

1. **Sign in.** Run `bin/quire login --server https://pr-96-commonink.draftox.workers.dev`. Your browser opens a page that asks "Connect quire CLI to Common Ink?", with **All your workspaces** picked. Click **Allow**. The page says you can close it, and the terminal says "Signed in to … as <your name>", with your workspaces.
2. **Pick a workspace.** Run `bin/quire workspaces`: each workspace, your role in it, and its ID. If you have more than one, run `bin/quire workspaces use "<the one this note is in>"`.
3. **An agent's task.** Run `QUIRE_AGENT=Claude bin/quire task add "Try the CLI tomorrow → [[CLI inbox]]"`. Open [[CLI inbox]] here: the task is under Tasks, due tomorrow. In **History**, the change reads "Claude for you".
4. **Your own line.** Run `bin/quire append "CLI inbox" "- written from my terminal"`. The line shows up in the note (live, if it's open), and History has it as yours, not Claude's.
5. **The same filters.** Run `bin/quire changes --path "CLI inbox" --by ai`: only Claude's change. Add `--json` to get it as data.
6. **A file up and back.** Run `bin/quire upload <any .png on your computer>`, then open **Assets**: it's there. `bin/quire download assets/<its name> --out /tmp/back.png` brings it back.
7. **Who's in it.** Run `bin/quire members`: you, with your role. In a team workspace you own (make one in the app if you like), `bin/quire invite --role viewer` prints an invite link, `bin/quire invites` lists it as active, and `bin/quire invites revoke <the start of its ID>` takes it back. In the account menu, **Workspace settings…** shows the same, and its log has both.
8. **Revoke it.** In the account menu, open **Connected agents…**. It lists "quire CLI" on "All your workspaces". Click **Revoke**. Then `bin/quire ls` in the terminal says your sign-in has ended and to run `quire login` (exit code 7).
9. **Sign out.** Run `bin/quire logout`, which forgets the sign-in on your computer.
