-- Water-quality lab samples from the Texas Commission on Environmental
-- Quality's monitoring stations near Crosby, as the Water Quality Portal
-- publishes them: one row per sample and measure. Additive only.
CREATE TABLE water_samples (
  station        TEXT NOT NULL,  -- WQP id, e.g. TCEQMAIN-11212
  activity       TEXT NOT NULL,  -- WQP ActivityIdentifier (one sampling visit)
  day            TEXT NOT NULL,  -- sample date as published (YYYY-MM-DD)
  measure        TEXT NOT NULL,  -- 'ecoli' | 'oxygen' | 'clarity'
  value          REAL NOT NULL,  -- as published
  unit           TEXT NOT NULL,  -- as published, or TCEQ's own unit from its result comment
  project        TEXT,           -- the sampling project, as published
  recorded       TEXT NOT NULL,
  PRIMARY KEY (station, activity, measure)
) WITHOUT ROWID;
CREATE INDEX water_samples_day ON water_samples (station, day);
