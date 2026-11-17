-- A past burn ban whose end no source dates. Such a row is not open: the cron
-- closes the open row (ended IS NULL) when the map shows no ban, and opens a
-- new one only when none is open, so both statements skip end_unknown rows.
-- `ended_by` is the latest day it can have ended, when a source bounds it
-- (the 2005 ban was reported lifted on 2005-07-27 without its date).
-- Additive only.
ALTER TABLE burnban_periods ADD COLUMN end_unknown INTEGER NOT NULL DEFAULT 0;
ALTER TABLE burnban_periods ADD COLUMN ended_by TEXT;
