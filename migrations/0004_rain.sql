-- Rain as the USGS weather station at the Lake Houston dam measures it: every
-- 15-minute amount as published, never a total. Totals are summed at request
-- time, so a gap in the feed stays visible as missing readings.
CREATE TABLE rain_readings (
  station  TEXT    NOT NULL,  -- USGS site number (08072000)
  at       TEXT    NOT NULL,  -- end of the 15-minute interval, ISO 8601 UTC
  day      TEXT    NOT NULL,  -- Central day the interval falls in (rainDay(): the reading
                              -- stamped midnight closes the day before)
  inches   REAL    NOT NULL,  -- rain in that interval, as published
  approval TEXT,              -- USGS approval status: Provisional / Approved
  PRIMARY KEY (station, at)
) WITHOUT ROWID;
CREATE INDEX rain_readings_day ON rain_readings (station, day);
