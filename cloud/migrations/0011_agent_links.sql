-- Whether agents may share this workspace's notes by link, or with someone as an editor (cloud/src/shares.ts).
-- Off until an owner turns it on in the workspace's settings; people sharing in the app aren't affected.
ALTER TABLE workspaces ADD COLUMN agent_links INTEGER NOT NULL DEFAULT 0;
