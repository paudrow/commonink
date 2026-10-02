-- Whether the workspace unlocks things as it's used (web/src/gamify.ts): a sidebar that grows, inks to
-- earn, shortcut tips, small celebrations. On until an owner turns it off in the workspace's settings,
-- and then everything is there from the start.
ALTER TABLE workspaces ADD COLUMN gamified INTEGER NOT NULL DEFAULT 1;
