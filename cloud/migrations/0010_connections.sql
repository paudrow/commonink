-- Accounts a person connects to other services (Google Calendar now). One per person and service.
-- Tokens are sealed with AES-GCM under the Worker secret INTEGRATIONS_KEY (cloud/src/secrets.ts),
-- each bound to its person and purpose, and never sent to a browser.
CREATE TABLE connections (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('google')),
  account TEXT NOT NULL,
  scopes TEXT NOT NULL,
  access_enc TEXT NOT NULL,
  refresh_enc TEXT,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, provider)
);
