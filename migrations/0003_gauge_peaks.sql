-- USGS annual peaks: the highest flow and gauge height USGS publishes for each
-- water year at a gauge, one row per peak date. Shown beside NOAA's crests on
-- the gauge pages. Additive only, like every migration.
CREATE TABLE gauge_peaks (
  lid             TEXT    NOT NULL,  -- NWS location id the gauge page uses
  usgs_id         TEXT    NOT NULL,  -- USGS site number
  day             TEXT    NOT NULL,  -- peak date as USGS publishes it (YYYY-MM-DD)
  water_year      INTEGER NOT NULL,
  flow            REAL,              -- peak flow, cubic feet per second (parameter 00060)
  stage           REAL,              -- peak gauge height, feet (parameter 00065)
  flow_qualifier  TEXT,              -- USGS qualifiers as published, JSON array
  stage_qualifier TEXT,
  recorded        TEXT    NOT NULL,
  PRIMARY KEY (lid, day)
) WITHOUT ROWID;
