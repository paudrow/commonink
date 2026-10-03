-- GitHub joins Google as an account a person can connect (cloud/src/github.ts): issue and pull request
-- cards then read the private repos that person can see. SQLite can't change a CHECK, so the table is
-- made again with the same columns and its rows are copied across, still sealed as they were.
CREATE TABLE connections_next (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('google', 'github')),
  account TEXT NOT NULL,
  scopes TEXT NOT NULL,
  access_enc TEXT NOT NULL,
  refresh_enc TEXT,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, provider)
);
INSERT INTO connections_next (user_id, provider, account, scopes, access_enc, refresh_enc, expires_at, created_at)
  SELECT user_id, provider, account, scopes, access_enc, refresh_enc, expires_at, created_at FROM connections;
DROP TABLE connections;
ALTER TABLE connections_next RENAME TO connections;
