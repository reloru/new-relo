-- A past burn ban can be sourced at both ends by a Commissioners Court
-- record: `url` holds the record that started it, `end_url` the one that
-- ended it. NULL when the end came from news reporting or was observed.
-- Additive only.
ALTER TABLE burnban_periods ADD COLUMN end_url TEXT;
