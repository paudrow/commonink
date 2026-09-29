-- Rate limits (cloud/src/limits.ts): how many times each key has acted since its window started.
CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  started INTEGER NOT NULL,
  hits INTEGER NOT NULL
);
CREATE INDEX rate_limits_by_started ON rate_limits(started);
