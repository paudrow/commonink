-- Remote MCP (cloud/src/agents.ts). The OAuth library's records (clients, grants, hashed tokens and
-- codes) live here instead of in KV, so a revoked token stops working at once, everywhere.
CREATE TABLE oauth_kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  metadata TEXT,
  expires_at INTEGER -- seconds since the epoch, as KV counts
);
CREATE INDEX oauth_kv_by_expiry ON oauth_kv(expires_at);

-- When each connected agent last made a request.
CREATE TABLE agent_use (
  grant_id TEXT PRIMARY KEY,
  used_at INTEGER NOT NULL
);
