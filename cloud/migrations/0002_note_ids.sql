-- Which workspace each note ID belongs to, so a note's URL (/notes/<title>-<id>) works for anyone
-- with access, whatever workspace they have open. IDs are never reused: a deleted note keeps its row.
CREATE TABLE note_ids (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  created_at INTEGER NOT NULL
);
CREATE INDEX note_ids_by_workspace ON note_ids(workspace_id);
