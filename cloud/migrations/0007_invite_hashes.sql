-- Invites are now stored by the SHA-256 of their token and work once (cloud/src/directory.ts). Links
-- made before this can't be matched any more, so they go; owners copy a new one.
DELETE FROM invites;
