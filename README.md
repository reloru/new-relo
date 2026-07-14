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
- **[Tropics](https://crosbynews.com/tropics)** — the Atlantic tropical outlook
  from the National Hurricane Center.
- **[News](https://crosbynews.com/news)** — local headlines for Crosby and
  nearby communities.
- **[School Calendar](https://crosbynews.com/calendar)** — Crosby ISD calendar
  (holidays, early-release, testing, athletics) with one-tap subscribe links.
- **[Emergency](https://crosbynews.com/emergency)** — emergency numbers, alert
  channels, flood tools, and hurricane-prep resources for NE Harris County.
- **[About](https://crosbynews.com/about)** — what the site is and where the
  data comes from; **[Developers](https://crosbynews.com/developers)** — the
  API/agent surface on one page.

Every page is also available in **Mexican Spanish (es-MX)** under an `/es`
prefix — e.g. [`/es`](https://crosbynews.com/es), `/es/hourly`, `/es/alerts`.

## Built for agents, too

Every page is content-negotiated — send `Accept: text/markdown` (or add
`?format=md` to any URL) for a clean Markdown rendering. The site also exposes:

- **REST API** — [`/api/weather`](https://crosbynews.com/api/weather): JSON with
  current conditions, hourly, 7-day forecast, and alerts. Plus
  [`/api/news`](https://crosbynews.com/api/news),
  [`/api/calendar`](https://crosbynews.com/api/calendar),
  [`/api/water`](https://crosbynews.com/api/water), and
  [`/api/tropics`](https://crosbynews.com/api/tropics). Public, no auth.
- **OpenAPI 3.1** — [`/openapi.json`](https://crosbynews.com/openapi.json)
- **MCP server** (Streamable HTTP) — `https://crosbynews.com/mcp`, with tools
  `get_current_conditions`, `get_forecast`, `get_alerts`, `get_tropical_outlook`,
  `get_crosby_news`, `get_school_events`, `get_river_levels`,
  `get_emergency_contacts`, and `get_radar` (a live radar image, inline).
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
- No build step and no dependencies — `src/index.js` is the entire app and
  `wrangler.jsonc` is the config.
- A 15-minute cron refreshes the cached NWS forecast and alerts (and, on a
  slower cadence, the school calendar, river gauges, and tropical outlook).
- Data: U.S. National Weather Service (public domain), NOAA NWPS and NHC,
  EPA (UV), Open-Meteo (modeled air quality), Crosby ISD, and Google News.

## Develop

```bash
npm install
npx wrangler dev      # run locally
npx wrangler deploy   # deploy (CI also deploys on push to main)
```

---

Independent project — not affiliated with the National Weather Service, NOAA, or
any government agency. Weather data courtesy of the U.S. National Weather Service.
