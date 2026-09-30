-- Per-note sharing (cloud/src/shares.ts): a note (by its stable ID) or a folder (by path) shared with
-- a person, an email address that has no account yet, or anyone with the link. Workspace members
-- keep their workspace role; shares only ever add access for people outside it.
CREATE TABLE shares (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  note_id TEXT,
  folder TEXT,
  principal_type TEXT NOT NULL CHECK (principal_type IN ('user', 'email', 'link')),
  -- A user's id, or a lower-cased email; null for a link.
  principal TEXT,
  role TEXT NOT NULL CHECK (role IN ('viewer', 'editor')),
  -- A link's token is never stored: this is its SHA-256 (the token itself is derived from the id).
  token_hash TEXT UNIQUE,
  expires_at INTEGER,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  CHECK ((note_id IS NULL) != (folder IS NULL)),
  CHECK ((principal_type = 'link') = (principal IS NULL)),
  CHECK ((principal_type = 'link') = (token_hash IS NOT NULL))
);
CREATE INDEX shares_by_principal ON shares(principal_type, principal);
CREATE INDEX shares_by_workspace ON shares(workspace_id, note_id);
