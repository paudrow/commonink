-- A share someone kept by joining a link (cloud/src/shares.ts joinLink) remembers the link, so removing
-- the link removes it too and changing the link caps it. Null for a share made out to someone directly.
ALTER TABLE shares ADD COLUMN via_share TEXT;
CREATE INDEX shares_by_via ON shares(via_share);
