# crosbynews.com

Live weather and local news for **Crosby, Texas** — fast, ad-free, no trackers.
The whole site is a single [Cloudflare Worker](https://workers.cloudflare.com/)
with no framework and no runtime dependencies.

### → **[crosbynews.com](https://crosbynews.com)**

## What it does

- **[Weather](https://crosbynews.com/weather)** — current conditions, a 12-hour
  strip, a 7-day forecast, and any active alerts for Crosby, TX (northeast
  Harris County), refreshed every 15 minutes from the U.S. National Weather
  Service (`api.weather.gov`). The [homepage](https://crosbynews.com) is a hub
  with the highlights of everything below.
- **[Hourly](https://crosbynews.com/hourly)** — the full 48-hour forecast table.
- **[Radar](https://crosbynews.com/radar)** — the NWS KHGX (Houston-Galveston)
  radar loop, which covers Crosby.
- **[Alerts](https://crosbynews.com/alerts)** — active NWS alerts plus a
  plain-language severe-weather guide, with opt-in push notifications for
  life-threatening warnings.
- **[Water Levels](https://crosbynews.com/water)** — live river/bayou flood
  gauges for the waters around Crosby (NOAA/NWS NWPS).
- **[Fishing](https://crosbynews.com/fishing)** — live USGS water conditions
  (temperature, dissolved oxygen, pH, clarity) for the waters people fish near
  Crosby: Lake Houston, the San Jacinto forks, the Trinity River, and nearby bayous.
- **[Tropics](https://crosbynews.com/tropics)** — the Atlantic tropical outlook:
  named storms plus the areas NHC is watching for development
  from the National Hurricane Center.
- **[Air Quality](https://crosbynews.com/air)** — the measured U.S. Air Quality
  Index for the Houston-Galveston-Brazoria area (which includes Crosby) from
  EPA/AirNow monitors, with a per-pollutant breakdown and health guidance.
- **[Pollen & Mold](https://crosbynews.com/pollen)** — the Houston Health
  Department's measured daily tree, weed, grass, and mold count for the Crosby
  area, published weekday mornings.
- **[Traffic](https://crosbynews.com/traffic)** — road incidents and lane
  closures on the Crosby-area corridors, from Houston TranStar.
- **[News](https://crosbynews.com/news)** — local headlines for Crosby and
  nearby communities.
- **[School Calendar](https://crosbynews.com/calendar)** — Crosby ISD calendar
  (holidays, early-release, testing, athletics) with one-tap subscribe links.
- **[Burn Ban Status](https://crosbynews.com/burn-ban)** — the current outdoor-
  burning ban status for Harris County, TX (which includes Crosby) from the
  Texas A&M Forest Service, countywide only.
- **[Emergency](https://crosbynews.com/emergency)** — emergency numbers, alert
  channels, flood tools, and hurricane-prep resources for NE Harris County.
- **[About](https://crosbynews.com/about)** — what the site is and where the
  data comes from; **[Developers](https://crosbynews.com/developers)** — the
  API/agent surface on one page.
- **[Privacy](https://crosbynews.com/privacy)** — no cookies, no trackers, no
  personal data; **[Contact](https://crosbynews.com/contact)** — general and
  security addresses; **[Sitemap](https://crosbynews.com/sitemap)** — every page
  and endpoint.

Every page is also available in **Mexican Spanish (es-MX)** under an `/es`
prefix — e.g. [`/es`](https://crosbynews.com/es), `/es/hourly`, `/es/alerts`.

## Built for agents, too

Every page is content-negotiated — send `Accept: text/markdown` (or add
`?format=md` to any URL) for a clean Markdown rendering. The site also exposes:

- **REST API** — [`/api/weather`](https://crosbynews.com/api/weather): JSON with
  current conditions, hourly, 7-day forecast, and alerts. Plus
  [`/api/news`](https://crosbynews.com/api/news),
  [`/api/calendar`](https://crosbynews.com/api/calendar),
  [`/api/water`](https://crosbynews.com/api/water),
  [`/api/tropics`](https://crosbynews.com/api/tropics),
  [`/api/air`](https://crosbynews.com/api/air),
  [`/api/pollen`](https://crosbynews.com/api/pollen),
  [`/api/burn-ban`](https://crosbynews.com/api/burn-ban),
  [`/api/traffic`](https://crosbynews.com/api/traffic),
  [`/api/fishing`](https://crosbynews.com/api/fishing), and
  [`/api/health`](https://crosbynews.com/api/health) (site liveness, when each
  feed last tried to refresh and whether it worked, and when its data last
  actually changed).
  Public, no auth.
- **OpenAPI 3.1** — [`/openapi.json`](https://crosbynews.com/openapi.json)
- **MCP server** (Streamable HTTP) — `https://crosbynews.com/mcp`, with tools
  `get_current_conditions`, `get_forecast`, `get_alerts`, `get_tropical_outlook`,
  `get_air_quality`, `get_pollen`, `get_burn_ban`, `get_river_levels`, `get_fishing`,
  `get_traffic`, `get_crosby_news`, `get_school_events`, `get_emergency_contacts`, and
  `get_radar` (a live radar image, inline).
  Discovery card at
  [`/.well-known/mcp/server-card.json`](https://crosbynews.com/.well-known/mcp/server-card.json).
- **[llms.txt](https://crosbynews.com/llms.txt)** — plain-language site summary
  for LLMs.

Connect the MCP server from Claude Code:

```bash
claude mcp add --transport http crosbynews https://crosbynews.com/mcp
```

## Stack

- **Cloudflare Workers** (ES modules) + **Workers KV** for the cached forecast.
- No framework and no runtime dependencies — the Worker imports nothing. The
  source under `src/` is bundled by Wrangler (esbuild) at deploy time, which CI
  exercises on every pull request via `wrangler deploy --dry-run`.
  `wrangler.jsonc` is the config.
- A 15-minute cron refreshes the cached NWS forecast and alerts, plus river
  gauges, fishing-water conditions and road incidents on every tick — and, on a
  slower cadence, the tropical outlook (~1h June–November hurricane season,
  ~24h the rest of the year), the pollen count (weekday mornings only, once
  that day's count posts), the burn-ban status (~4h) and the school calendar
  (~24h). Local news is the exception: it is written out-of-band, because
  Google News blocks Worker IPs.
- Data: U.S. National Weather Service (public domain), NOAA NWPS and NHC,
  EPA (UV), EPA/AirNow (measured air quality, Open-Meteo modeled fallback),
  the Houston Health Department (pollen & mold), the Texas A&M Forest Service
  (burn-ban status), the U.S. Geological Survey (fishing-water conditions),
  Houston TranStar (traffic), Crosby ISD, and Google News.

## Develop

```bash
npm install
npx wrangler dev      # run locally
npx wrangler deploy   # deploy (CI also deploys on push to main)
```

## License

[MIT](LICENSE) — the code is free to reuse. The live site's DATA is not: it's
sourced from NWS, NOAA, EPA/AirNow, HHD, USGS, Houston TranStar, Crosby ISD, and
Google News under each provider's own terms, and `com.crosbynews/weather`
(the published MCP listing) is this project's own namespace, not something a
fork inherits.

---

Independent project — not affiliated with the National Weather Service, NOAA, or
any government agency. Weather data courtesy of the U.S. National Weather Service.
