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

The site is laid out like a printed bulletin. `test-look` renders every page
and enforces the first four rules; `test-contrast` measures the colours.

- Content sits on the page. No cards, drop shadows, gradients, rounded
  corners, pill badges or letter-spaced capitals. Sections are divided by a
  rule above an `<h2>`; rows by a hairline.
- Headings and large numerals use `--serif`, everything else the system sans.
  No web fonts, no icon fonts, no images for decoration.
- No emoji or symbols as icons, and no arrows on links. A link's own words
  say where it goes ("Past floods at this gauge", not "Details →").
- A status is a word in the text colour with a square (`.mark`,
  `.gauge-badge`) or a 4px left rule in a status colour. A page sets `--mark`
  or `--pg` to one of the tokens `--ok --warn --hot --bad --severe --maroon
  --info --quiet`, never a raw hex: each has a dark-theme value and clears
  3:1 on `--bg`. The colour never carries text.
- White text on a fill is for an active alert (`.status-alert`,
  `.alert-banner`) and buttons only, flat, at 4.5:1.
- Each page has an inline `<style>` built on `BASE_CSS`, which holds the
  shared pieces (`.status`, `.cur`, `.peek`, `.tbl`, `.lede`, `.intro`).
  A page adds only what is its own.
- `--link` is coloured text, `--btn` is a fill under white text and does not
  flip between themes, `--accent` is decoration only.
- Desktop nav depends on
  `.nav-menu::details-content { content-visibility: visible }`; removing it
  hides the desktop links.

## Wording

Text a visitor reads, in both languages:

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
