-- Wrong sign-up codes, per Google identity, so the code can't be guessed by trying again and again.
CREATE TABLE signup_attempts (
  sub TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX signup_attempts_by_sub ON signup_attempts(sub, at);
