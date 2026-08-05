// OpenAPI 3.1 description of the public REST API, plus the RFC 9727 linkset.
//
// Component schemas set additionalProperties: true on purpose — NWS and NHC
// payloads pass through verbatim and carry more fields than are enumerated, so
// documenting them as closed would make the spec lie the first time an upstream
// adds a field.
//
// info.version is its OWN track, separate from server.json and
// MCP_SERVER_INFO.version: this describes the REST API, those describe the MCP
// tool surface.

import { SITE } from "../config.js";

// RFC 9727 / RFC 9264 API catalog (application/linkset+json).
export function apiCatalog() {
  const entry = (anchor, doc) => ({
    anchor: `${SITE}${anchor}`,
    "service-desc": [{ href: `${SITE}/openapi.json`, type: "application/json" }],
    "service-doc": [{ href: `${SITE}${doc}`, type: "text/html" }],
    status: [{ href: `${SITE}/api/health`, type: "application/json" }],
  });
  return {
    linkset: [entry("/api/weather", "/"), entry("/api/news", "/news"), entry("/api/calendar", "/calendar"), entry("/api/water", "/water"), entry("/api/fishing", "/fishing"), entry("/api/tropics", "/tropics"), entry("/api/pollen", "/pollen"), entry("/api/air", "/air"), entry("/api/traffic", "/traffic")],
  };
}

// OpenAPI 3.1 description of the weather API.
export function openApiSpec() {
  const HourlyPeriod = {
    type: "object",
    // The NWS payload is passed through verbatim and carries more fields than
    // are called out here (number, name, dewpoint, relativeHumidity, ...).
    additionalProperties: true,
    properties: {
      number: { type: "integer" },
      name: { type: "string" },
      startTime: { type: "string", format: "date-time" },
      endTime: { type: "string", format: "date-time" },
      isDaytime: { type: "boolean" },
      temperature: { type: "number" },
      temperatureUnit: { type: "string" },
      temperatureTrend: { type: ["string", "null"] },
      shortForecast: { type: "string" },
      windSpeed: { type: "string" },
      windDirection: { type: "string" },
      windGust: { type: "string" },
      probabilityOfPrecipitation: { type: "object", additionalProperties: true, properties: { value: { type: ["number", "null"] }, unitCode: { type: "string" } } },
      icon: { type: "string", format: "uri" },
      feelsLike: {
        type: ["number", "null"],
        description: "Heat index or wind chill in °F, computed from temperature/humidity/wind using NWS's own formulas. Not an NWS field — null when neither applies.",
      },
    },
  };
  const Period = {
    type: "object",
    additionalProperties: true,
    properties: {
      number: { type: "integer" },
      startTime: { type: "string", format: "date-time" },
      endTime: { type: "string", format: "date-time" },
      name: { type: "string" },
      isDaytime: { type: "boolean" },
      temperature: { type: "number" },
      temperatureUnit: { type: "string" },
      shortForecast: { type: "string" },
      detailedForecast: { type: "string" },
      windSpeed: { type: "string" },
      windDirection: { type: "string" },
      probabilityOfPrecipitation: { type: "object", additionalProperties: true, properties: { value: { type: ["number", "null"] }, unitCode: { type: "string" } } },
      icon: { type: "string", format: "uri" },
    },
  };
  const Alert = {
    type: "object",
    properties: {
      event: { type: "string" },
      headline: { type: "string" },
      severity: { type: "string" },
      description: { type: "string" },
      instruction: { type: "string" },
      expires: { type: "string", format: "date-time" },
    },
  };
  const NewsItem = {
    type: "object",
    properties: {
      title: { type: "string" },
      link: { type: "string", format: "uri" },
      source: { type: ["string", "null"] },
      published: { type: ["string", "null"], format: "date-time" },
      category: { type: "string", enum: ["community", "incident"] },
    },
  };
  const SchoolEvent = {
    type: "object",
    properties: {
      summary: { type: "string" },
      location: { type: ["string", "null"] },
      start: {
        type: "string",
        description: "All-day events: a date (YYYY-MM-DD). Timed events: zone-less ISO 8601 local time (America/Chicago wall-clock, as authored by the district).",
      },
      end: { type: ["string", "null"] },
      allDay: { type: "boolean" },
    },
  };
  const Storm = {
    type: "object",
    properties: {
      id: { type: "string", description: "NHC storm id (e.g. al052026). Atlantic basin only." },
      name: { type: "string" },
      classification: { type: "string", description: "NHC classification code: TD/TS/HU/MH/STD/STS/PTC/PC/RL." },
      classificationLabel: { type: "string", description: "Human-readable classification (e.g. Hurricane, Tropical Storm)." },
      windMph: { type: ["integer", "null"], description: "Max sustained winds in mph, rounded to 5 like NHC advisories (converted from NHC's knots)." },
      intensityKt: { type: ["number", "null"], description: "Max sustained winds in knots, as NHC reports them." },
      pressureMb: { type: ["number", "null"] },
      lat: { type: ["number", "null"] },
      lon: { type: ["number", "null"] },
      movementDirection: { type: ["string", "null"], description: "Compass direction of movement (speed omitted — NHC's unit for it is not clearly documented)." },
      lastUpdate: { type: ["string", "null"], format: "date-time" },
      advisoryUrl: { type: "string", format: "uri", description: "The official NHC public advisory." },
    },
  };
  // ONE definition, spliced into both /api/weather and /api/air. They used to be
  // two hand-copied blocks, which is how `nearbyMonitor` came to be missing from
  // both at once — it shipped on the endpoints and neither copy was updated.
  // Anything added to the AQI object goes here and lands on both.
  const AirQuality = {
    type: ["object", "null"],
    description:
      "US Air Quality Index. `measured: true` = EPA/AirNow official monitors for the Houston-Galveston-Brazoria reporting area (the nearest official area, which includes Crosby — there's no monitor in Crosby itself). `measured: false` = Open-Meteo modeled forecast for Crosby's coordinates, the fallback when AirNow isn't reporting. `modeled` is the inverse of `measured` (kept for back-compat). null when both failed.",
    properties: {
      usAqi: { type: "integer", description: "US AQI, 0–500 scale (the max of the pollutant sub-indices)." },
      category: { type: "string", description: "Good / Moderate / Unhealthy for Sensitive Groups / Unhealthy / Very Unhealthy / Hazardous." },
      dominantPollutant: { type: ["string", "null"], description: "The pollutant driving the overall AQI." },
      dominantMonitor: { type: ["string", "null"], description: "Monitor site reporting the dominant pollutant (measured path)." },
      monitors: { type: ["object", "null"], description: "Per-pollutant reporting monitor site names (measured path)." },
      reportingAgency: { type: ["string", "null"], description: "Agency operating the monitors (e.g. TCEQ)." },
      subIndices: { type: ["object", "null"], description: "Per-pollutant AQI (ozone/pm25/pm10/…). Present for both sources." },
      pm2_5: { type: ["number", "null"], description: "PM2.5 concentration in concentrationUnit (modeled source only; null when measured)." },
      pm10: { type: ["number", "null"] },
      ozone: { type: ["number", "null"] },
      concentrationUnit: { type: "string" },
      measured: { type: "boolean" },
      modeled: { type: "boolean", description: "Inverse of measured; retained for back-compat." },
      reportingArea: { type: ["string", "null"], description: "AirNow reporting area (measured source only)." },
      observed: { type: ["string", "null"], description: "Local observation time (measured source only)." },
      source: { type: "string" },
      nearbyMonitor: {
        type: ["object", "null"],
        description:
          "Cross-reference reading from the nearest DEDICATED ozone monitor (Channelview C15, ~8.5 mi), so a locally elevated ozone value can't hide behind the closest-per-pollutant headline above. Hourly, EPA/AirNow. null when that monitor didn't report in the last refresh window, or when the headline AQI is itself unavailable.",
        properties: {
          site: { type: "string" },
          pollutant: { type: "string", description: "Always \"ozone\" — PM is already covered by the headline monitors." },
          usAqi: { type: "integer" },
          category: { type: "string" },
          distanceMiles: { type: "number", description: "Straight-line distance from Crosby." },
          observed: { type: ["string", "null"], format: "date-time" },
          reportingAgency: { type: ["string", "null"] },
          note: { type: "string" },
        },
      },
    },
  };
  const FishingStation = {
    type: "object",
    properties: {
      id: { type: "string", description: "USGS site number (e.g. 08072000)." },
      water: { type: ["string", "null"], description: 'The water body this station stands in, e.g. "Lake Houston".' },
      spot: { type: ["string", "null"], description: 'Where on that water, e.g. "FM 1960 bridge".' },
      knownFor: { type: ["string", "null"], description: 'Species the water is fished for, e.g. "bass, crappie, white bass, catfish". Editorial, not USGS.' },
      temperatureF: { type: ["number", "null"], description: "Water temperature in °F, converted from the USGS Celsius reading. null when this station does not measure it." },
      dissolvedOxygenMgL: { type: ["number", "null"], description: "Dissolved oxygen, mg/L. The main fish-activity signal." },
      ph: { type: ["number", "null"] },
      turbidityFNU: { type: ["number", "null"], description: "Turbidity in Formazin Nephelometric Units — water clarity." },
      waterLevelFt: { type: ["number", "null"], description: "Gauge height in feet. Level-only stations report this and nothing else." },
      conditions: { type: "string", description: 'One-line plain-language read of the station, e.g. "Healthy oxygen". Derived in-Worker from the readings above, not a USGS field. English only, even on /es.' },
      observed: { type: ["string", "null"], format: "date-time", description: "When USGS observed the reading (station-local offset, as USGS reports it) — distinct from the top-level `updated`, which is when we fetched." },
      officialUrl: { type: "string", format: "uri", description: "The station's USGS monitoring-location page." },
    },
  };
  const Gauge = {
    type: "object",
    properties: {
      id: { type: "string", description: "NWPS location ID (e.g. HCDT2)." },
      name: { type: "string" },
      usgsId: { type: ["string", "null"] },
      stage: { type: ["number", "null"], description: "Observed gauge height, in stageUnit; null when the gauge is offline." },
      stageUnit: { type: "string" },
      flow: { type: ["number", "null"], description: "Observed discharge in cubic feet per second." },
      flowUnit: { type: "string" },
      category: { type: "string", description: "NWS flood category. no_flooding/action/minor/moderate/major where NWS defines flood stages; not_defined for gauges without them (e.g. reservoir levels).", enum: ["no_flooding", "action", "minor", "moderate", "major", "not_defined", "unknown"] },
      validTime: { type: ["string", "null"], format: "date-time" },
      thresholds: { type: "object", description: "NWS flood-stage thresholds in thresholdUnit; only the categories NWS defines for this gauge are present.", additionalProperties: { type: "number" } },
      thresholdUnit: { type: "string" },
      officialUrl: { type: "string", format: "uri" },
    },
  };
  return {
    openapi: "3.1.0",
    info: {
      title: "crosbynews.com API",
      version: "1.5.0",
      description:
        "Crosby, Texas community data: current conditions, hourly and 7-day forecast, active alerts, the EPA UV index, and a measured air-quality index (EPA/AirNow monitors, with an Open-Meteo modeled fallback) from the U.S. National Weather Service, EPA/AirNow, and Open-Meteo; river/bayou flood levels; the Atlantic tropical outlook; the Houston Health Department's measured daily pollen and mold count; road incidents and lane closures from Houston TranStar; recent local news headlines; and the Crosby ISD school calendar. Public, no authentication.",
      contact: { url: `${SITE}/` },
      license: { name: "Public domain (NWS source data)", url: "https://www.weather.gov/disclaimer" },
    },
    servers: [{ url: SITE }],
    // Deliberately unauthenticated. An empty root `security` says so in a way a
    // client generator or linter can read, instead of leaving "no auth" to prose.
    security: [],
    paths: {
      "/api/weather": {
        get: {
          operationId: "getWeather",
          summary: "Current conditions, forecast, and alerts for Crosby, TX",
          parameters: [{ $ref: "#/components/parameters/IfNoneMatch" }],
          responses: {
            "304": { $ref: "#/components/responses/NotModified" },
            "200": {
              description: "Weather snapshot",
              content: { "application/json": { schema: { $ref: "#/components/schemas/Weather" } } },
            },
            "502": { description: "Upstream (NWS) unavailable" },
          },
        },
      },
      "/api/news": {
        get: {
          operationId: "getNews",
          summary: "Recent local news headlines for Crosby, TX",
          parameters: [{ $ref: "#/components/parameters/IfNoneMatch" }],
          responses: {
            "304": { $ref: "#/components/responses/NotModified" },
            "200": {
              description: "Curated headline list (community items first on the site; incidents flagged by category)",
              content: { "application/json": { schema: { $ref: "#/components/schemas/News" } } },
            },
            "502": { description: "News cache unavailable" },
          },
        },
      },
      "/api/calendar": {
        get: {
          operationId: "getCalendar",
          summary: "Upcoming Crosby ISD school calendar events",
          parameters: [{ $ref: "#/components/parameters/IfNoneMatch" }],
          responses: {
            "304": { $ref: "#/components/responses/NotModified" },
            "200": {
              description: "Upcoming events (soonest first, capped at 60)",
              content: { "application/json": { schema: { $ref: "#/components/schemas/SchoolCalendar" } } },
            },
            "502": { description: "Calendar unavailable" },
          },
        },
      },
      "/api/water": {
        get: {
          operationId: "getWater",
          summary: "River and bayou levels with NWS flood stages for the Crosby, TX area",
          parameters: [{ $ref: "#/components/parameters/IfNoneMatch" }],
          responses: {
            "304": { $ref: "#/components/responses/NotModified" },
            "200": {
              description: "Current stage, flow, flood category, and thresholds per gauge",
              content: { "application/json": { schema: { $ref: "#/components/schemas/Water" } } },
            },
            "502": { description: "Water data unavailable" },
          },
        },
      },
      "/api/fishing": {
        get: {
          operationId: "getFishing",
          summary: "Live fishing-water conditions (USGS) for the waters people fish near Crosby, TX",
          parameters: [{ $ref: "#/components/parameters/IfNoneMatch" }],
          responses: {
            "304": { $ref: "#/components/responses/NotModified" },
            "200": {
              description:
                "Per-station conditions from USGS real-time monitoring for the fished waters (Lake Houston, the San Jacinto forks, the Trinity River, and nearby bayous): temperature, dissolved oxygen, pH, and turbidity where measured, or water level for level-only stations. Nearby readings, not the exact spot.",
              content: { "application/json": { schema: { $ref: "#/components/schemas/Fishing" } } },
            },
            "502": { description: "Fishing data unavailable" },
          },
        },
      },
      "/api/tropics": {
        get: {
          operationId: "getTropics",
          summary: "Active Atlantic tropical cyclones from the NOAA National Hurricane Center",
          parameters: [{ $ref: "#/components/parameters/IfNoneMatch" }],
          responses: {
            "304": { $ref: "#/components/responses/NotModified" },
            "200": {
              description: "Active Atlantic systems; an empty storms array means a quiet basin (the normal state most of the year)",
              content: { "application/json": { schema: { $ref: "#/components/schemas/Tropics" } } },
            },
            "502": { description: "Tropics data unavailable" },
          },
        },
      },
      "/api/pollen": {
        get: {
          operationId: "getPollen",
          summary: "Measured daily pollen and mold count for the Houston / Crosby, TX area",
          parameters: [{ $ref: "#/components/parameters/IfNoneMatch" }],
          responses: {
            "304": { $ref: "#/components/responses/NotModified" },
            "200": {
              description:
                "The Houston Health Department's daily count (National Allergy Bureau scale): tree/weed/grass pollen and mold spores with category + grains-per-m³, plus the species counted above zero. Publishes weekday mornings; weekends carry Friday's count.",
              content: { "application/json": { schema: { $ref: "#/components/schemas/Pollen" } } },
            },
            "502": { description: "Pollen data unavailable" },
          },
        },
      },
      "/api/air": {
        get: {
          operationId: "getAir",
          summary: "Measured US Air Quality Index for the Houston / Crosby, TX area",
          parameters: [{ $ref: "#/components/parameters/IfNoneMatch" }],
          responses: {
            "304": { $ref: "#/components/responses/NotModified" },
            "200": {
              description:
                "Current US AQI for the Houston-Galveston-Brazoria reporting area (which includes Crosby). Measured by EPA/AirNow monitors when available (measured:true), with an Open-Meteo modeled fallback (measured:false).",
              content: { "application/json": { schema: { $ref: "#/components/schemas/Air" } } },
            },
            "502": { description: "Air quality data unavailable" },
          },
        },
      },
      "/api/traffic": {
        get: {
          operationId: "getTraffic",
          summary: "Traffic incidents and lane closures on Crosby, TX area roads",
          parameters: [{ $ref: "#/components/parameters/IfNoneMatch" }],
          responses: {
            "304": { $ref: "#/components/responses/NotModified" },
            "200": {
              description:
                "Incidents and scheduled lane closures on US-90, FM-2100, FM-1942, and the Crosby stretch of IH-10 East, from Houston TranStar. Empty arrays mean quiet roads; null means that feed was unreachable at the last refresh.",
              content: { "application/json": { schema: { $ref: "#/components/schemas/Traffic" } } },
            },
            "502": { description: "Traffic data unavailable" },
          },
        },
      },
      "/api/health": {
        get: {
          operationId: "getHealth",
          summary: "Service health: per-feed readability, shape and freshness",
          description:
            "A monitoring contract, not a liveness ping. Evaluates the same cached state the endpoints above serve — it never fetches an upstream, so polling this does not generate upstream load. **`200` means ok OR degraded; `503` means a CRITICAL feed is broken.** Read `status` for the distinction: `degraded` still serves useful data (a section feed is stale or its last refresh failed), while `unhealthy` means the weather cache — which the front page, forecast, alerts, air quality, badge and most MCP tools all read — is unreadable, malformed, or expired.",
          responses: {
            "200": {
              description: "Service is ok or degraded. See `status`.",
              content: { "application/json": { schema: { $ref: "#/components/schemas/Health" } } },
            },
            "503": {
              description: "A critical feed is unreadable, malformed or expired. Body is the same shape, with `status: \"unhealthy\"` and the reasons in `summary.problems`.",
              content: { "application/json": { schema: { $ref: "#/components/schemas/Health" } } },
            },
          },
        },
      },
    },
    components: {
      parameters: {
        IfNoneMatch: {
          name: "If-None-Match",
          in: "header",
          required: false,
          description: "A previously returned weak ETag. When it still matches the cached snapshot, the endpoint answers 304 with no body — the cheap way to poll.",
          schema: { type: "string" },
        },
      },
      responses: {
        NotModified: {
          description: "Not Modified — the caller's If-None-Match matches the current snapshot, so no body is sent. The ETag is derived from the cache's refresh stamp, so it changes exactly when the payload would.",
        },
      },
      schemas: {
        Weather: {
          type: "object",
          properties: {
            location: { type: "string" },
            coordinates: { type: "object", properties: { lat: { type: "number" }, lon: { type: "number" } } },
            source: { type: "string" },
            updated: { type: "string", format: "date-time" },
            sun: {
              type: ["object", "null"],
              description: "Today's sunrise/sunset for Crosby, computed astronomically in-Worker (standard sunrise equation) — not an NWS field.",
              properties: {
                sunrise: { type: "string", format: "date-time" },
                sunset: { type: "string", format: "date-time" },
              },
            },
            uv: {
              type: ["object", "null"],
              description: "UV index from the U.S. EPA's UV forecast for Crosby's ZIP (77532) — not an NWS field. null when the EPA fetch failed or the current hour is outside the product's daytime window.",
              properties: {
                current: { type: ["integer", "null"], description: "UV index for the current hour (Central time)." },
                currentCategory: { type: ["string", "null"], description: "Low / Moderate / High / Very High / Extreme." },
                peakToday: { type: ["integer", "null"], description: "Highest forecast UV index for today." },
                peakCategory: { type: ["string", "null"] },
                source: { type: "string" },
              },
            },
            airQuality: { $ref: "#/components/schemas/AirQuality" },
            current: { anyOf: [{ $ref: "#/components/schemas/HourlyPeriod" }, { type: "null" }] },
            hourly: { type: "array", items: { $ref: "#/components/schemas/HourlyPeriod" } },
            forecast: { type: "array", items: { $ref: "#/components/schemas/Period" } },
            alerts: { type: "array", items: { $ref: "#/components/schemas/Alert" } },
          },
        },
        HourlyPeriod,
        Period,
        Alert,
        AirQuality,
        News: {
          type: "object",
          properties: {
            location: { type: "string" },
            source: { type: "string" },
            updated: { type: ["string", "null"], format: "date-time" },
            items: { type: "array", items: { $ref: "#/components/schemas/NewsItem" } },
          },
        },
        NewsItem,
        SchoolCalendar: {
          type: "object",
          properties: {
            district: { type: "string" },
            source: { type: "string" },
            timezone: { type: "string" },
            updated: { type: ["string", "null"], format: "date-time" },
            events: { type: "array", items: { $ref: "#/components/schemas/SchoolEvent" } },
          },
        },
        SchoolEvent,
        Fishing: {
          type: "object",
          properties: {
            location: { type: "string" },
            source: { type: "string" },
            note: { type: "string", description: "Standing caveat: nearest station per water body, a nearby reading rather than the exact fishing spot." },
            updated: { type: ["string", "null"], format: "date-time", description: "When we last refreshed the cache (cron, every tick). Per-reading times are each station's `observed`." },
            stations: { type: "array", items: { $ref: "#/components/schemas/FishingStation" } },
          },
          required: ["stations"],
        },
        FishingStation,
        Water: {
          type: "object",
          properties: {
            location: { type: "string" },
            source: { type: "string" },
            updated: { type: ["string", "null"], format: "date-time" },
            gauges: { type: "array", items: { $ref: "#/components/schemas/Gauge" } },
          },
        },
        Gauge,
        Tropics: {
          type: "object",
          properties: {
            basin: { type: "string" },
            source: { type: "string" },
            updated: { type: ["string", "null"], format: "date-time" },
            storms: { type: "array", items: { $ref: "#/components/schemas/Storm" } },
          },
        },
        Storm,
        Pollen: {
          type: "object",
          properties: {
            location: { type: "string" },
            source: { type: "string" },
            measured: { type: "boolean", description: "Always true — a lab-counted air sample, not a model." },
            stationNote: { type: "string" },
            updated: { type: ["string", "null"], format: "date-time" },
            countDate: { type: ["string", "null"], description: "Calendar date (Central) the count is for; weekends carry Friday's." },
            officialUrl: { type: "string", format: "uri" },
            groups: {
              type: "object",
              description: "tree / weed / grass / mold; each null when missing from the day's report.",
              additionalProperties: {
                type: ["object", "null"],
                properties: {
                  category: { type: "string", description: "NAB category: None, Low, Medium, Heavy, or Extremely Heavy." },
                  count: { type: "integer", description: "Grains (spores) per cubic meter of air." },
                },
              },
            },
            species: {
              type: "object",
              description: "Per-group list of types counted above zero, as the lab names them.",
              additionalProperties: {
                type: "array",
                items: { type: "object", properties: { name: { type: "string" }, count: { type: "integer" } } },
              },
            },
          },
        },
        Air: {
          type: "object",
          properties: {
            location: { type: "string" },
            updated: { type: ["string", "null"], format: "date-time" },
            airQuality: { $ref: "#/components/schemas/AirQuality" },
          },
        },
        Health: {
          type: "object",
          description: "Service health. `status` is derived from the per-feed checks, not from the fact that the Worker answered.",
          properties: {
            status: { type: "string", enum: ["ok", "degraded", "unhealthy"], description: "ok = every feed readable, well-shaped and fresh. degraded = something is stale, its last refresh failed, or a NON-critical feed is broken; the service still serves useful data. unhealthy = a CRITICAL feed is broken (503)." },
            updated: { type: ["string", "null"], format: "date-time", description: "The weather cache's refresh stamp. Kept at the top level for backward compatibility with the previous {status, updated} shape." },
            checkedAt: { type: "string", format: "date-time", description: "When this report was generated. Never cached (`no-store`)." },
            cronLastRun: { type: ["string", "null"], format: "date-time", description: "When the cron last completed a tick and recorded its outcomes. null until the first tick after deploy." },
            worker: {
              type: "object",
              description: "Runtime and configuration. Reaching this response IS the runtime check — dispatch, routing and rendering all already happened.",
              properties: {
                status: { type: "string", enum: ["ok", "unhealthy"] },
                runtime: { type: "string", description: 'Always "responding" when a body is returned.' },
                version: {
                  type: ["object", "null"],
                  description: "Deployment identity, so a symptom can be tied to a release. null when the version_metadata binding is absent (local dev, or a deploy predating it).",
                  properties: {
                    id: { type: ["string", "null"], description: "Cloudflare Worker version id." },
                    tag: { type: ["string", "null"] },
                    timestamp: { type: ["string", "null"], format: "date-time", description: "When this version was deployed — the closest thing to a build timestamp." },
                  },
                },
                bindings: {
                  type: "object",
                  description: 'Configuration presence ONLY, never values. WEATHER is "bound" or "MISSING"; each optional secret is "set" or "unset". An unset secret is not an error — the feature degrades on its own — but it explains behavior (no AirNow key means a modeled AQI rather than a measured one).',
                  additionalProperties: { type: "string" },
                },
              },
            },
            feeds: {
              type: "object",
              description: "One entry per cached feed, keyed by name.",
              additionalProperties: { $ref: "#/components/schemas/HealthFeed" },
            },
            summary: {
              type: "object",
              properties: {
                total: { type: "integer" },
                ok: { type: "integer" },
                degraded: { type: "integer" },
                unhealthy: { type: "integer" },
                problems: { type: "array", items: { type: "string" }, description: "Every problem found, prefixed with its feed name — enough for a human or a pager to see what failed without walking the tree." },
              },
            },
          },
          required: ["status"],
        },
        HealthFeed: {
          type: "object",
          properties: {
            status: { type: "string", enum: ["ok", "degraded", "unhealthy"] },
            critical: { type: "boolean", description: "Whether a failure here makes the whole service unhealthy (503). Only the weather cache is critical; every other feed backs a single section page." },
            cadence: { type: "string", description: "Human-readable refresh schedule, e.g. \"~6h (cron, throttled)\"." },
            serves: { type: "array", items: { type: "string" }, description: "The routes that break when this feed does." },
            kv: { type: "string", enum: ["ok", "missing", "unreadable"], description: "Storage-level outcome, kept separate from data-level ones: `unreadable` is a KV or JSON-parse failure, `missing` is a cold cache, and neither is the same as stale data." },
            updated: { type: ["string", "null"], format: "date-time" },
            ageSeconds: { type: ["integer", "null"] },
            freshness: { type: "string", enum: ["fresh", "stale", "expired", "unknown"], description: "Judged against this feed's own thresholds, not a global one." },
            thresholds: {
              type: "object",
              properties: { freshSeconds: { type: "integer" }, staleSeconds: { type: "integer" } },
            },
            shape: { type: "string", enum: ["ok", "invalid"], description: "Whether the cached entry is actually usable — catches a successful fetch that returned unusable data, e.g. an empty gauges array or a forecast window that has fully elapsed." },
            lastRefresh: {
              type: ["object", "null"],
              description: "Result of the last refresh ATTEMPT, which staleness alone cannot answer: an upstream that started failing five minutes ago still has fresh data. `tracked:false` for the news key, which a routine writes out-of-band rather than the cron. `skipped:true` means a throttled feed was not due — deliberately not reported as a success.",
              additionalProperties: true,
              properties: {
                tracked: { type: "boolean" },
                ok: { type: "boolean" },
                at: { type: "string", format: "date-time" },
                skipped: { type: "boolean" },
                reason: { type: "string" },
                error: { type: "string" },
              },
            },
            data: { type: "object", description: "Per-feed counts and sub-signals — gauge count, active storms, whether AQI is measured or modeled, and so on.", additionalProperties: true },
            problems: { type: "array", items: { type: "string" } },
          },
        },
        Traffic: {
          type: "object",
          properties: {
            area: { type: "string" },
            source: { type: "string" },
            updated: { type: ["string", "null"], format: "date-time" },
            incidents: {
              type: ["array", "null"],
              description: "Live incidents on the Crosby corridors; empty = quiet, null = feed unreachable at the last refresh.",
              items: {
                type: "object",
                properties: {
                  location: { type: "string", description: 'TranStar location text, e.g. "US-90 Eastbound At RUNNEBURG RD".' },
                  type: { type: "string", description: 'Incident type(s), e.g. "Accident", "Stall", "High Water".' },
                  status: { type: "string", description: 'TranStar status, e.g. "Verified at 4:24 PM" (Central time).' },
                  lanesAffected: { type: ["string", "null"] },
                },
              },
            },
            laneClosures: {
              type: ["array", "null"],
              description: "Scheduled lane closures on the Crosby corridors; empty = none, null = feed unreachable at the last refresh.",
              items: {
                type: "object",
                properties: {
                  location: { type: "string" },
                  schedule: { type: "string", description: 'TranStar schedule text, e.g. "Closed nightly 9:00 PM to 5:00 AM through Friday, July 17".' },
                  lanesAffected: { type: ["string", "null"] },
                  status: { type: ["string", "null"] },
                },
              },
            },
            cameras: {
              type: "array",
              description:
                "TranStar traffic cameras on the Crosby corridors. pageUrl links TranStar's own camera page — snapshot images are not embedded or proxied here.",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  roadway: { type: "string" },
                  lat: { type: "number" },
                  lon: { type: "number" },
                  pageUrl: { type: "string", format: "uri" },
                },
              },
            },
            liveMapUrl: { type: "string", format: "uri" },
            note: { type: "string" },
          },
        },
      },
    },
  };
}

