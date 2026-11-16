---
paths:
  - "src/features/**/*.js"
  - "src/pages/**/*.js"
  - "src/lib/**/*.js"
  - "src/chrome.js"
  - "src/seo.js"
  - "src/i18n.js"
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
- The site sends no IndexNow submissions (removed 2026-11-13; the owner links
  it to search engines another way). Don't re-add them without asking.
  `docs/ops/search.md`.

## Look

Coloured panels and cards on a grey page: a navy header, a gradient panel for
current conditions and each page's status, white cards with a soft shadow for
sections, and pill badges for a status word. The flat "bulletin" layout of
PR #291 was withdrawn because sections became hard to tell apart; don't
flatten the site again without asking.

- Each page has an inline `<style>` built on `BASE_CSS`.
- The three blues are not interchangeable: `--accent` is decoration only (it
  fails AA as text), `--link` is coloured text, `--btn` is a surface under
  white text and does not flip between themes. White text on any fill must
  clear 4.5:1 at every gradient stop; badge bases use `#5b6470`.
  `test-contrast` measures the real rules.
- Flood-category colours are `WATER_STATE_CSS` in `src/features/water.js`,
  shared by `/water` and the gauge pages.
- A symbol or emoji is decoration only and sits in a
  `<span aria-hidden="true">` (the status panels' `.status-icon`, the menu
  button, the banner titles). The words beside it carry the meaning.
  `test-wording` refuses a symbol anywhere else in a page's text.
- Desktop nav depends on
  `.nav-menu::details-content { content-visibility: visible }`; removing it
  hides the desktop links.

## Wording

Text a visitor reads, in both languages. `test-wording` renders every page and
enforces the link-arrow rule; the rest is by hand.

- No arrows on links. A link's own words say where it goes ("Past floods at
  this gauge", not "Details →").
- Say the thing, then stop. No sentence that announces what the next one will
  say, and no closing line that repeats the paragraph.
- No dash asides. Two short sentences, a comma or a colon do the job. A dash
  is fine as an empty table cell and in a `<title>`.
- Name the specific thing: "None of the gauges near Crosby is at flood
  stage", not "All clear". "Not available right now", not "temporarily
  unavailable".
- No sales words ("fast", "clean", "all in one place", "at a glance") and no
  stock safety slogans; give the instruction and the reason.
- Headings in sentence case. Lists of links are joined with commas or put in
  a list, not strung on middots.
- A note that only matters to Spanish readers ("shown in English, as the
  agency publishes it") is gated on `lang === "es"`.
- The site is run by one person: write "this site", not "we".
