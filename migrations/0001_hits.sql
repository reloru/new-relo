-- Aggregate request counts for the site's own pages and endpoints.
--
-- One row per combination of day, path and three broad labels, holding a
-- count. There is never a row per request, and nothing here identifies a
-- visitor: no address, no user-agent string, no cookie, no referring URL.
-- See src/metrics.js for how each label is derived and docs/ops/analytics.md
-- for what /privacy promises about this table.
CREATE TABLE hits (
  day      TEXT    NOT NULL,  -- Central calendar day, YYYY-MM-DD
  path     TEXT    NOT NULL,  -- a registered page or endpoint path, or a bucket such as "(other)"
  agent    TEXT    NOT NULL,  -- "browser", a named crawler, "script" or "unknown"
  verified INTEGER NOT NULL,  -- crawler identity: 2 Cloudflare-verified, 1 network matches, 0 claimed only
  ref      TEXT    NOT NULL,  -- referrer category: "google", "other-site", "none", ...
  status   INTEGER NOT NULL,  -- HTTP status of the response
  n        INTEGER NOT NULL,
  PRIMARY KEY (day, path, agent, verified, ref, status)
) WITHOUT ROWID;
