---
pr: 96
title: The CLI in a hosted workspace
---
The `commonink` CLI can now sign in to a hosted workspace and run every command there, with your role in it. Its writes are yours, or "<agent> for you" when an agent says it's the one writing. You'll need a terminal with this branch checked out: `gh pr checkout 96 && npm install`, then `unset COMMONINK_VAULT` (with it set, the CLI uses the local vault).

1. **Sign in.** Run `bin/commonink login --server https://pr-96-commonink.draftox.workers.dev`. Your browser opens a page that asks "Connect commonink CLI to Common Ink?", with **All your workspaces** picked. Click **Allow**. The page says you can close it, and the terminal says "Signed in to … as <your name>", with your workspaces.
2. **Pick a workspace.** Run `bin/commonink workspaces`: each workspace, your role in it, and its ID. If you have more than one, run `bin/commonink workspaces use "<the one this note is in>"`.
3. **An agent's task.** Run `COMMONINK_AGENT=Claude bin/commonink task add "Try the CLI tomorrow → [[CLI inbox]]"`. Open [[CLI inbox]] here: the task is under Tasks, due tomorrow. In **History**, the change reads "Claude for you".
4. **Your own line.** Run `bin/commonink append "CLI inbox" "- written from my terminal"`. The line shows up in the note (live, if it's open), and History has it as yours, not Claude's.
5. **The same filters.** Run `bin/commonink change list --path "CLI inbox" --by ai`: only Claude's change. Add `--json` to get it as data.
6. **A file up and back.** Run `bin/commonink asset upload <any .png on your computer>`, then open **Assets**: it's there. `bin/commonink asset download assets/<its name> --out /tmp/back.png` brings it back.
7. **Who's in it.** The Preview has a team you own, Launch team, with Sam in it. Run `bin/commonink member list --workspace "Launch team"`: you and Sam Dev, an editor. `bin/commonink member-role set "Sam Dev" viewer --workspace "Launch team"` makes Sam a viewer. `bin/commonink invite list --workspace "Launch team"` lists the invite links: one Sam used, one still open. `bin/commonink invite revoke <the open one's ID> --workspace "Launch team"` takes it back. In the app, switch to Launch team and open **Workspace settings…** in the account menu: Sam's role, the invites and the log match.
8. **Revoke it.** In the account menu, open **Connected agents…**. It lists "commonink CLI" on "All your workspaces". Click **Revoke**. Then `bin/commonink list` in the terminal says your sign-in has ended and to run `commonink login` (exit code 7).
9. **Sign out.** Run `bin/commonink logout`, which forgets the sign-in on your computer.
