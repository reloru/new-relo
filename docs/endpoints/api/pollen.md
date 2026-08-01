# `GET /api/pollen`

The Houston Health Department's measured daily pollen and mold count, as public
JSON.

Shared contract: `docs/endpoints/api/README.md`.

| | |
|---|---|
| **Builder** | `apiPollen(data)` (`src/features/pollen.js`) |
| **Loader** | `loadPollen(env)` → `pollen` KV |
| **Cache** | `public, max-age=1800` |
| **ETag seed** | `` `${data.countDate}|${data.updated}` `` |

## Why the seed carries `countDate`

`updated` is when *we* last scraped; `countDate` is the CT calendar day the count
is **for**. They move independently — a scrape at 2pm that finds the same
morning's count changes `updated` but not the body's meaning. Seeding on both
keeps the ETag honest in either direction.

## Response

`countDate`, the source `url`, and `groups` — tree, weed, grass pollen and mold
spores, each with its National Allergy Bureau category and grains/m³ — plus the
per-genus `species` lists.

**Categories are republished verbatim from the lab.** They are never
recalculated or rebanded on our side.

## Publication cadence

Counts publish **weekday mornings only**. On weekends `countDate` is Friday's,
and it is labeled with its own date everywhere it appears — never presented as
today's. A consumer should read `countDate`, not assume "today".

## Page

`docs/pages/pollen.md` — scraping strategy, the throw-on-unparseable-layout
guard, and the canary verification.
