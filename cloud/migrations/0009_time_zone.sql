-- Each person's IANA time zone, as their browser last reported it (e.g. America/Chicago). Their
-- agents' "today" is a day there. Null until the app has loaded once since this column came.
ALTER TABLE users ADD COLUMN time_zone TEXT;
