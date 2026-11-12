---
paths:
  - "src/features/**/*.js"
  - "src/pages/**/*.js"
  - "src/lib/**/*.js"
  - "src/chrome.js"
  - "src/seo.js"
  - "src/i18n.js"
  - "src/indexnow.js"
  - "src/assets/base-css.js"
---

# What a page says and how it looks

## Third-party text

- Never machine-translate third-party text. Short NWS phrases, period names,
  directions, pollen categories, NHC classes, school titles and NWS product
  names go through hand-written dictionaries with English fallback. NWS
  forecast prose, alert text and NOAA impact statements stay in English.
- Never render `hourly[0]` as "now": `currentHourly(data)` picks the period
  covering the clock.
- JSON-LD stays honest: no forecast schema, no fake ratings or FAQ.

## Time and search signals

- No relative times anywhere. Stamps go through `dateStamp()`, `clockStamp()`
  or `timeTag()` and carry `<time datetime>`: an ISO instant for a stamp, a
  bare date for something that is a date.
- `data-nosnippet` goes on what is stale within hours (temperatures,
  readings, active alerts, live status), never on a guide or the record.
  Descriptions are 50–160 characters with no live value. `test-freshness`
  enforces both.
- ETags are a digest of the bytes. `Last-Modified` and sitemap `<lastmod>`
  exist only where a real instant does (registry `feeds`, or a handler's
  `lastmod(env)`).
- IndexNow fires on state changes only (a category, a ban, an alert, a new
  crest or record row), plus once for a page never submitted. A new stateful
  page needs a signal in `src/indexnow.js`. Failures retry hourly, bounded;
  each endpoint's answer is in `attempts` on `/api/health`. Current status:
  `docs/ops/search.md`.

## Look

- Each page has an inline `<style>` built on `BASE_CSS`.
- The three blues are not interchangeable: `--accent` is decoration only (it
  fails AA as text), `--link` is coloured text, `--btn` is a surface under
  white text and does not flip between themes. White text on any fill must
  clear 4.5:1 at every gradient stop; badge bases use `#5b6470`.
  `test-contrast` measures the real rules.
- Flood-category colours are `WATER_STATE_CSS` in `src/features/water.js`,
  shared by `/water` and the gauge pages.
- Desktop nav depends on
  `.nav-menu::details-content { content-visibility: visible }`; removing it
  hides the desktop links.
