-- The record: what the site keeps beyond the latest snapshot. Every table is
-- written with idempotent upserts keyed on a natural key, so replaying an
-- observation changes nothing.

-- NWS watches, warnings and advisories that covered Crosby, one row per event.
-- An event is identified the way NWS identifies it (its VTEC key): office,
-- phenomena, significance and event number, unique within a year.
CREATE TABLE nws_events (
  year         INTEGER NOT NULL,  -- year the event number belongs to
  wfo          TEXT    NOT NULL,  -- issuing office, three letters (HGX)
  phenomena    TEXT    NOT NULL,  -- VTEC code: TO, SV, FF, HU, FZ, ...
  significance TEXT    NOT NULL,  -- W warning, A watch, Y advisory, S statement
  etn          INTEGER NOT NULL,  -- event tracking number
  scope        TEXT    NOT NULL,  -- how it covered Crosby: 'point' (the polygon contained
                                  -- Crosby), 'zone', 'county', or 'gauge' (a river forecast point)
  name         TEXT    NOT NULL,  -- e.g. "Tornado Warning"
  issued       TEXT    NOT NULL,  -- ISO 8601 UTC
  expires      TEXT,              -- ISO 8601 UTC, latest known end
  source       TEXT    NOT NULL,  -- 'iem' (archive backfill) or 'observed' (this site received it)
  nwsli        TEXT,              -- river forecast point, for scope 'gauge'
  tags         TEXT,              -- JSON of product tags (tornado, damage, hail, wind), when published
  PRIMARY KEY (year, wfo, phenomena, significance, etn)
) WITHOUT ROWID;
CREATE INDEX nws_events_issued ON nws_events (issued);

-- Alert messages this site itself received, with the official text.
CREATE TABLE alerts (
  id           TEXT PRIMARY KEY,  -- NWS alert identifier
  event        TEXT NOT NULL,
  severity     TEXT,
  urgency      TEXT,
  certainty    TEXT,
  headline     TEXT,
  area         TEXT,
  sent         TEXT,
  onset        TEXT,
  expires      TEXT,
  ends         TEXT,
  vtec         TEXT,              -- first VTEC string as published, if any
  year         INTEGER,           -- parsed VTEC key; joins nws_events
  wfo          TEXT,
  phenomena    TEXT,
  significance TEXT,
  etn          INTEGER,
  description  TEXT,
  instruction  TEXT,
  first_seen   TEXT NOT NULL,
  last_seen    TEXT NOT NULL
);
CREATE INDEX alerts_sent ON alerts (sent);
CREATE INDEX alerts_event_key ON alerts (year, wfo, phenomena, significance, etn);

-- Historic crests as NOAA publishes them for each gauge.
CREATE TABLE gauge_crests (
  lid       TEXT    NOT NULL,
  occurred  TEXT    NOT NULL,     -- ISO 8601 UTC
  stage     REAL    NOT NULL,     -- feet
  flow      REAL,                 -- cubic feet per second, as published
  quality   TEXT,                 -- NOAA's flag as published
  old_datum INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (lid, occurred)
) WITHOUT ROWID;

-- Per-gauge reference data that changes rarely: flood-impact statements.
CREATE TABLE gauge_meta (
  lid     TEXT PRIMARY KEY,
  name    TEXT,
  usgs_id TEXT,
  impacts TEXT,                   -- JSON array of { stage, statement } as published
  updated TEXT NOT NULL
) WITHOUT ROWID;

-- This site's own daily summary of each gauge, from its 15-minute readings.
CREATE TABLE gauge_daily (
  lid        TEXT    NOT NULL,
  day        TEXT    NOT NULL,    -- Central calendar day of the reading
  max_stage  REAL,
  max_at     TEXT,
  min_stage  REAL,
  last_stage REAL,
  last_at    TEXT,
  max_flow   REAL,                -- thousand cubic feet per second, as NOAA reports it
  max_rank   INTEGER NOT NULL DEFAULT 0,  -- highest flood category: 0 none, 1 action, 2 minor, 3 moderate, 4 major
  readings   INTEGER NOT NULL DEFAULT 0,  -- distinct readings seen that day
  PRIMARY KEY (lid, day)
) WITHOUT ROWID;

-- The Houston Health Department's measured count, one row per count date.
CREATE TABLE pollen_daily (
  day         TEXT PRIMARY KEY,   -- the date the count is for
  tree_count  INTEGER, tree_cat  TEXT,
  weed_count  INTEGER, weed_cat  TEXT,
  grass_count INTEGER, grass_cat TEXT,
  mold_count  INTEGER, mold_cat  TEXT,
  species     TEXT,               -- JSON as published
  url         TEXT,
  recorded    TEXT NOT NULL
) WITHOUT ROWID;

-- The day's highest air-quality index among the readings this site saw.
CREATE TABLE aqi_daily (
  day      TEXT PRIMARY KEY,      -- Central calendar day
  max_aqi  INTEGER NOT NULL,
  max_at   TEXT,
  dominant TEXT,                  -- pollutant behind the day's highest reading
  measured INTEGER NOT NULL,      -- 1 when that reading was measured (AirNow), 0 when modeled
  readings INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;

-- Harris County burn bans, one row per ban.
CREATE TABLE burnban_periods (
  started      TEXT PRIMARY KEY,  -- day the ban took effect
  ended        TEXT,              -- day it was lifted; NULL while in effect
  start_source TEXT NOT NULL,     -- 'tfs' (the Forest Service's own start date), 'observed', or 'order'
  end_source   TEXT,              -- 'observed' or 'order'
  note         TEXT,
  url          TEXT               -- the official order or release, when recorded by hand
) WITHOUT ROWID;
