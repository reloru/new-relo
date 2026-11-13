# `/methods` — how the numbers are made

A static explainer: where each number on the site comes from, how it is
computed, and its limits, by topic (rules every number follows; weather and
alerts; river levels and flood history; warning history; air quality and UV;
pollen; burn bans; water samples; tropics, traffic, fishing waters; school
calendar and news).
Each topic links the page(s) it describes.

| | |
|---|---|
| **Handlers** | `methodsHtml(lang)` / `methodsMarkdown(lang)` — `src/pages/methods.js` |
| **Route** | `PAGE_HANDLERS["/methods"]` (`src/router.js`) |
| **Spanish** | `/es/methods` (hand-written, same `SECTIONS` table) |
| **Registry** | section `about`, footer link "Methods" / "Métodos"; no header nav |
| **Cache** | `public, max-age=3600` |
| **Dates** | none: a static page sends no `Last-Modified` and has no sitemap `<lastmod>` |

## Rule for editing it

It explains methods and points at pages; it **restates no count, list or
cadence another module owns** (number of gauges, MCP tools, feed refresh
intervals, warning totals). Those live on their pages (`/history` and the gauge
pages print computed method notes) and in `docs/`. When a source or method
changes, edit the matching section here in both languages; nothing tests the
prose against the code, so `grep` this file when changing a data source.

Its wording must also pass the site-wide checks: no relative time (it once
quoted the phrase it forbids and failed `test-freshness`), description 50–160
characters.

## Meta, CSP

Title "How the Numbers Are Made"; JSON-LD `JSONLD_SITE` only; no inline script.
