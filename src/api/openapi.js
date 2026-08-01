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
      probabilityOfPrecipitation: { type: "object", properties: { value: { type: ["number", "null"] } } },
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
      probabilityOfPrecipitation: { type: "object", properties: { value: { type: ["number", "null"] } } },
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
    paths: {
      "/api/weather": {
        get: {
          operationId: "getWeather",
          summary: "Current conditions, forecast, and alerts for Crosby, TX",
          responses: {
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
          responses: {
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
          responses: {
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
          responses: {
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
          responses: {
            "200": {
              description:
                "Per-station conditions from USGS real-time monitoring for the fished waters (Lake Houston, the San Jacinto forks, the Trinity River, and nearby bayous): temperature, dissolved oxygen, pH, and turbidity where measured, or water level for level-only stations. Nearby readings, not the exact spot.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      location: { type: "string" },
                      source: { type: "string" },
                      note: { type: "string" },
                      updated: { type: ["string", "null"] },
                      stations: { type: "array", items: { type: "object" } },
                    },
                    required: ["stations"],
                  },
                },
              },
            },
            "502": { description: "Fishing data unavailable" },
          },
        },
      },
      "/api/tropics": {
        get: {
          operationId: "getTropics",
          summary: "Active Atlantic tropical cyclones from the NOAA National Hurricane Center",
          responses: {
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
          responses: {
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
          responses: {
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
          responses: {
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
          summary: "Service health and cache freshness",
          responses: {
            "200": {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { status: { type: "string" }, updated: { type: ["string", "null"], format: "date-time" } },
                    required: ["status"],
                  },
                },
              },
            },
          },
        },
      },
    },
    components: {
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
            airQuality: {
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
              },
            },
            current: { anyOf: [HourlyPeriod, { type: "null" }] },
            hourly: { type: "array", items: HourlyPeriod },
            forecast: { type: "array", items: Period },
            alerts: { type: "array", items: Alert },
          },
        },
        HourlyPeriod,
        Period,
        Alert,
        News: {
          type: "object",
          properties: {
            location: { type: "string" },
            source: { type: "string" },
            updated: { type: ["string", "null"], format: "date-time" },
            items: { type: "array", items: NewsItem },
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
            events: { type: "array", items: SchoolEvent },
          },
        },
        SchoolEvent,
        Water: {
          type: "object",
          properties: {
            location: { type: "string" },
            source: { type: "string" },
            updated: { type: ["string", "null"], format: "date-time" },
            gauges: { type: "array", items: Gauge },
          },
        },
        Gauge,
        Tropics: {
          type: "object",
          properties: {
            basin: { type: "string" },
            source: { type: "string" },
            updated: { type: ["string", "null"], format: "date-time" },
            storms: { type: "array", items: Storm },
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
            airQuality: {
              type: ["object", "null"],
              description: "measured:true = EPA/AirNow monitors (Houston metro reporting area incl. Crosby); measured:false = Open-Meteo modeled fallback. Null when both failed.",
              properties: {
                usAqi: { type: "integer" },
                category: { type: "string" },
                dominantPollutant: { type: ["string", "null"] },
                dominantMonitor: { type: ["string", "null"] },
                monitors: { type: ["object", "null"] },
                reportingAgency: { type: ["string", "null"] },
                subIndices: { type: ["object", "null"], description: "Per-pollutant AQI (ozone/pm25/pm10/…)." },
                pm2_5: { type: ["number", "null"] },
                pm10: { type: ["number", "null"] },
                ozone: { type: ["number", "null"] },
                concentrationUnit: { type: "string" },
                measured: { type: "boolean" },
                modeled: { type: "boolean" },
                reportingArea: { type: ["string", "null"] },
                observed: { type: ["string", "null"] },
                source: { type: "string" },
              },
            },
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

