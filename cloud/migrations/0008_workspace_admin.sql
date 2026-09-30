-- Invite links are kept once used, with who used them, so owners can see that (cloud/src/admin.ts).
ALTER TABLE invites ADD COLUMN used_by TEXT REFERENCES users(id);
ALTER TABLE invites ADD COLUMN used_at INTEGER;

-- Who changed what about a workspace: renamed it, changed a role, removed someone, someone left,
-- an invite was revoked. Notes have their own change log, in the workspace.
CREATE TABLE workspace_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_id TEXT,
  detail TEXT
);
CREATE INDEX workspace_log_by_workspace ON workspace_log(workspace_id, id);
