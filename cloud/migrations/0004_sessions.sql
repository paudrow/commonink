-- Signed-in browsers. The cookie holds a random token; only its SHA-256 is stored, so a leaked
-- copy of this table can't be used to sign in. A session ends when it's idle too long, reaches its
-- absolute expiry, or is signed out (here or everywhere).
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_by_user ON sessions(user_id);
