// The Model Context Protocol server. Stateless, Streamable HTTP, JSON-RPC 2.0,
// single endpoint at POST /mcp. Published to the official registry as
// com.crosbynews/weather.
//
// initialize echoes a requested protocolVersion ONLY if it is in
// MCP_SUPPORTED_VERSIONS; otherwise it answers with our latest, per spec.
// Never parrot an unsupported version back — that would falsely promise that
// revision's semantics.
//
// Bump MCP_SERVER_INFO.version together with server.json whenever the tool set
// changes. Five hand-maintained prose surfaces also name the tools and go
// stale silently: CROSBY_WEATHER_SKILL, llmsTxt(), DEVELOPERS, DEVELOPERS_ES,
// README.md. mcpTools() is the only generated list.

import { SITE } from "../config.js";
import { T, canonicalFor, hreflangTags } from "../i18n.js";
import { esc, fullTime, clockTime, hourLabel } from "../lib/format.js";
import { BASE_CSS } from "../assets/base-css.js";
import { topbar, footer } from "../chrome.js";
import { openApiSpec } from "../api/openapi.js";
import { JSONLD_SITE, sharedHead } from "../seo.js";
import { llmsTxt, CROSBY_WEATHER_SKILL } from "../discovery.js";
import { HISTORY_TOOLS, runHistoryTool } from "./history-tools.js";
import { loadWeather } from "../features/weather.js";
import { loadWater, waterState, waterCatLabel, WATER_FLOOD_CATS, apiWater } from "../features/water.js";
import { loadFishing, apiFishing } from "../features/fishing.js";
import { loadTropics, tropicsStormLine, tropicsDisturbanceLine, tropicsWatchAreas, apiTropics } from "../features/tropics.js";
import { loadTraffic, apiTraffic } from "../features/traffic.js";
import { loadPollen, pollenCatRank, pollenGroupLabel, pollenDateLabel,
         POLLEN_GROUPS, apiPollen } from "../features/pollen.js";
import { loadBurnBan, apiBurnBan, burnbanSince } from "../features/burnban.js";
import { loadNews, newsDate, apiNews } from "../features/news.js";
import { loadCalendar, upcomingEvents, calTime, apiCalendar } from "../features/calendar.js";
import { EMERGENCY } from "../pages/emergency.js";
import { pop, currentHourly, feelsLikeF, feelsLikeRawF, sunTimesForCtDate } from "../lib/derived.js";
import { uvCurrent, uvPeakToday, uvCategory,
         aqiCategory, aqiDominantLabel, aqiHealth, apiAir } from "../features/air.js";

// A stateless Model Context Protocol server exposing the weather as callable
// tools. Single endpoint at /mcp: POST a JSON-RPC message, get one back.
export const MCP_PROTOCOL_VERSION = "2025-06-18";
// Versions this server can honestly claim when a client requests them. Per
// spec, an UNSUPPORTED requested version gets answered with our latest —
// never echoed back (echoing e.g. "2026-07-28" would falsely promise the
// stateless-core semantics of that revision).
export const MCP_SUPPORTED_VERSIONS = ["2025-03-26", "2025-06-18"];
// Version moves in lockstep with `server.json`'s registry version on any
// tool-set change — they drifted apart (1.2.0 vs 1.4.0) when `get_air_quality`
// and `get_fishing` shipped without a bump, so both now carry the same number.
export const MCP_SERVER_INFO = { name: "crosbynews-weather", version: "1.8.0", title: "Crosby, TX Weather" };
export const MCP_CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type, mcp-protocol-version, mcp-session-id, authorization",
  "access-control-max-age": "86400",
};

export const rpcResult = (id, result) => ({ jsonrpc: "2.0", id, result });
export const rpcError = (id, code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });

export function mcpJson(payload, status) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json", "mcp-protocol-version": MCP_PROTOCOL_VERSION, ...MCP_CORS },
  });
}

// Every tool is a pure read of cached public data: read-only, idempotent, and
// closed-world (a fixed set of government upstreams, no arbitrary reach).
// Clients use these hints to skip per-call confirmation prompts.
export const MCP_READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

// JSON Schema allows `type: ["string", "null"]`, but some non-Claude dialects
// (the MCP Inspector cites Gemini's) cannot express a type array. Rewrite each
// one as `anyOf` branches: annotations (description, title, default, examples)
// stay on the parent, every type-specific keyword moves into the first branch.
const SCHEMA_ANNOTATIONS = ["description", "title", "default", "examples", "$comment"];
export function portableSchema(node) {
  if (Array.isArray(node)) return node.map(portableSchema);
  if (!node || typeof node !== "object") return node;
  const out = {};
  for (const [k, v] of Object.entries(node)) out[k] = portableSchema(v);
  if (!Array.isArray(out.type)) return out;
  const { type, ...rest } = out;
  const top = {};
  const shared = {};
  for (const [k, v] of Object.entries(rest)) (SCHEMA_ANNOTATIONS.includes(k) ? top : shared)[k] = v;
  const branches = type.map((t) => (t === "null" ? { type: "null" } : { type: t, ...shared }));
  return { ...top, anyOf: branches };
}

export function mcpTools() {
  // outputSchema fragments — shallow and honest: they name the load-bearing
  // fields and stay permissive (additionalProperties defaults to true) since
  // NWS/NHC objects are passed through with more fields than we enumerate.
  // Full field docs live in /openapi.json (also an MCP resource).
  const isoStamp = { type: ["string", "null"], description: "ISO 8601 timestamp of the last data refresh." };
  const nwsPeriod = {
    type: "object",
    description:
      "An NWS forecast period, passed through (startTime, temperature, shortForecast, windSpeed, probabilityOfPrecipitation, ...) plus computed feelsLike °F where applicable. Full schema: https://crosbynews.com/openapi.json",
  };
  const tools = [
    {
      name: "get_current_conditions",
      title: "Current conditions",
      description:
        "Current weather for Crosby, TX: temperature, feels-like, sky, precip chance, humidity, dew point, UV index, measured air quality (EPA/AirNow, Houston metro area), and sunrise/sunset.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      outputSchema: {
        type: "object",
        properties: {
          location: { type: "string" },
          updated: isoStamp,
          sun: { type: ["object", "null"], properties: { sunrise: { type: "string" }, sunset: { type: "string" } } },
          uv: {
            type: ["object", "null"],
            description: "EPA UV index; null at night or when the EPA feed is down.",
            properties: { current: { type: "integer" }, currentCategory: { type: "string" }, peakToday: { type: ["integer", "null"] } },
          },
          airQuality: {
            type: ["object", "null"],
            description: "US AQI. measured:true = EPA/AirNow monitors (Houston metro reporting area incl. Crosby); measured:false = Open-Meteo modeled fallback. Regional, not Crosby-pinpoint either way.",
            properties: { usAqi: { type: "integer" }, category: { type: "string" }, dominantPollutant: { type: ["string", "null"] }, measured: { type: "boolean" }, reportingArea: { type: ["string", "null"] } },
          },
          current: { ...nwsPeriod, description: nwsPeriod.description + " Adds dewpointF and humidityPercent." },
        },
        required: ["location"],
      },
      annotations: MCP_READ_ONLY,
    },
    {
      name: "get_forecast",
      title: "Forecast",
      description:
        "Forecast for Crosby, TX from the U.S. National Weather Service. Returns the 7-day day/night forecast, or upcoming hourly periods if `hours` is given (up to 48 — through about two days out).",
      inputSchema: {
        type: "object",
        properties: {
          hours: { type: "integer", minimum: 1, maximum: 48, description: "Return this many upcoming hourly periods instead of the daily forecast." },
        },
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        properties: {
          location: { type: "string" },
          forecast: { type: "array", description: "7-day day/night periods (daily mode).", items: nwsPeriod },
          hourly: { type: "array", description: "Upcoming hourly periods (only when `hours` was given).", items: nwsPeriod },
        },
        required: ["location"],
      },
      annotations: MCP_READ_ONLY,
    },
    {
      name: "get_alerts",
      title: "Active alerts",
      description: "Active NWS weather alerts for Crosby, TX. Returns an empty list when none are active.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      outputSchema: {
        type: "object",
        properties: {
          location: { type: "string" },
          count: { type: "integer" },
          alerts: {
            type: "array",
            items: { type: "object", properties: { event: { type: "string" }, headline: { type: "string" }, severity: { type: "string" }, expires: { type: "string" } } },
          },
        },
        required: ["location", "count", "alerts"],
      },
      annotations: MCP_READ_ONLY,
    },
    {
      name: "get_tropical_outlook",
      title: "Atlantic tropical outlook",
      description:
        "Active Atlantic tropical cyclones from the NOAA National Hurricane Center, AND the areas it is watching for development that do not have names yet, with their formation chances. Covers hurricane season (June–November) for Crosby, TX. Returns an explicit all-clear only when there are neither — a quiet CurrentStorms list does not by itself mean a quiet basin.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      outputSchema: {
        type: "object",
        properties: {
          basin: { type: "string" },
          source: { type: "string" },
          updated: isoStamp,
          outlookIssued: isoStamp,
          disturbances: {
            type: ["array", "null"],
            description:
              "Areas the NHC is watching for development but has NOT named — the shaded areas on its graphical outlook. `null` means the outlook could not be read (status unknown); `[]` means the NHC is watching nothing — two different states. A formation chance is neither a storm nor a forecast track.",
            items: {
              type: "object",
              properties: {
                area: { type: "string", description: "NHC's own name for the area, in official English." },
                id: { type: ["string", "null"], description: 'Invest number when assigned, e.g. "AL95".' },
                chance48Percent: { type: ["integer", "null"] },
                chance48Category: { type: ["string", "null"], description: "low / medium / high, NHC's own wording." },
                chance7DayPercent: { type: ["integer", "null"] },
                chance7DayCategory: { type: ["string", "null"] },
              },
            },
          },
          storms: {
            type: "array",
            description: "Named/numbered cyclones only. Empty is common and does not by itself mean nothing is brewing; unnamed areas are in `disturbances`.",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                classificationLabel: { type: "string" },
                windMph: { type: ["integer", "null"] },
                pressureMb: { type: ["number", "null"] },
                lat: { type: ["number", "null"] },
                lon: { type: ["number", "null"] },
                movementDirection: { type: ["string", "null"] },
                advisoryUrl: { type: "string" },
              },
            },
          },
        },
        required: ["basin", "storms"],
      },
      annotations: MCP_READ_ONLY,
    },
    {
      name: "get_pollen",
      title: "Pollen & mold count",
      description:
        "The Houston Health Department's measured daily pollen and mold count (National Allergy Bureau scale) — tree, weed, and grass pollen plus mold spores, with the species actually counted. A real measurement, not a model; counts publish weekday mornings and apply regionally to Crosby, TX.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      outputSchema: {
        type: "object",
        properties: {
          location: { type: "string" },
          source: { type: "string" },
          measured: { type: "boolean" },
          updated: isoStamp,
          countDate: { type: ["string", "null"], description: "Calendar date (Central time) the count is for; weekends carry Friday's count." },
          officialUrl: { type: "string" },
          groups: {
            type: "object",
            description: "tree / weed / grass / mold — each null when that reading was missing from the day's report.",
            properties: {
              tree: { type: ["object", "null"], properties: { category: { type: "string" }, count: { type: "integer" } } },
              weed: { type: ["object", "null"], properties: { category: { type: "string" }, count: { type: "integer" } } },
              grass: { type: ["object", "null"], properties: { category: { type: "string" }, count: { type: "integer" } } },
              mold: { type: ["object", "null"], properties: { category: { type: "string" }, count: { type: "integer" } } },
            },
          },
          species: { type: "object", description: "Per-group list of the types counted above zero, as the lab names them." },
        },
        required: ["source", "groups"],
      },
      annotations: MCP_READ_ONLY,
    },
    {
      name: "get_burn_ban",
      title: "Burn ban status",
      description:
        "Current outdoor-burning ban status for Harris County, TX (which includes Crosby) from the Texas A&M Forest Service. Countywide only — TFS has no sub-county resolution, so this is never a Crosby-specific status.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      outputSchema: {
        type: "object",
        properties: {
          county: { type: "string", description: 'Always "Harris".' },
          source: { type: "string" },
          status: { type: ["string", "null"], description: '"Yes" = ban in effect, "No" = no active ban, null = status unavailable from the last check.' },
          startDate: { type: ["string", "null"], description: "ISO date-time the current ban took effect, as reported by TFS; null when there is no active ban." },
          statusSince: { type: ["string", "null"], description: "When the CURRENT status was first observed. Equal to trackingSince means no change has ever been witnessed — it is when observation began, NOT a transition date." },
          trackingSince: { type: ["string", "null"], description: "The first observation ever recorded for this feed." },
          lastChecked: isoStamp,
          officialUrl: { type: "string" },
        },
        required: ["county", "source"],
      },
      annotations: MCP_READ_ONLY,
    },
    {
      name: "get_air_quality",
      title: "Air quality (AQI)",
      description:
        "Current U.S. Air Quality Index for the Houston metro area (the Houston-Galveston-Brazoria reporting area, which includes Crosby, TX). Measured by EPA/AirNow monitors when available (measured:true), with an Open-Meteo modeled fallback (measured:false). Regional, not a Crosby-pinpoint reading.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      outputSchema: {
        type: "object",
        properties: {
          location: { type: "string" },
          updated: isoStamp,
          airQuality: {
            type: ["object", "null"],
            properties: {
              usAqi: { type: "integer" },
              category: { type: "string" },
              dominantPollutant: { type: ["string", "null"] },
              dominantMonitor: { type: ["string", "null"], description: "Site name of the monitor reporting the dominant pollutant (measured path)." },
              subIndices: { type: ["object", "null"], description: "Per-pollutant AQI (ozone/pm25/pm10/…)." },
              monitors: { type: ["object", "null"], description: "Per-pollutant reporting monitor site names (measured path)." },
              reportingAgency: { type: ["string", "null"] },
              measured: { type: "boolean" },
              reportingArea: { type: ["string", "null"] },
              observed: { type: ["string", "null"] },
              source: { type: "string" },
            },
          },
        },
        required: ["location", "airQuality"],
      },
      annotations: MCP_READ_ONLY,
    },
    {
      name: "get_crosby_news",
      title: "Local news",
      description:
        "Recent local news headlines for Crosby, TX and nearby northeast Harris County communities, aggregated from public sources and filtered for relevance. Empty when nothing recent.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      outputSchema: {
        type: "object",
        properties: {
          location: { type: "string" },
          source: { type: "string" },
          updated: isoStamp,
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                link: { type: "string" },
                source: { type: ["string", "null"] },
                published: { type: ["string", "null"] },
                category: { type: "string", description: "community or incident" },
              },
            },
          },
        },
        required: ["items"],
      },
      annotations: MCP_READ_ONLY,
    },
    {
      name: "get_school_events",
      title: "School calendar",
      description:
        "Upcoming Crosby ISD school-calendar events: first/last day of school, holidays, no-school and early-release days, testing windows, and campus activities.",
      inputSchema: {
        type: "object",
        properties: {
          limit: { type: "integer", minimum: 1, maximum: 60, description: "Maximum events to return (default 15)." },
        },
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        properties: {
          district: { type: "string" },
          source: { type: "string" },
          timezone: { type: "string" },
          updated: isoStamp,
          events: {
            type: "array",
            items: {
              type: "object",
              properties: {
                summary: { type: "string" },
                location: { type: ["string", "null"] },
                start: { type: "string", description: "All-day: YYYY-MM-DD. Timed: zone-less ISO local time (America/Chicago wall-clock)." },
                end: { type: ["string", "null"] },
                allDay: { type: "boolean" },
              },
            },
          },
        },
        required: ["events"],
      },
      annotations: MCP_READ_ONLY,
    },
    {
      name: "get_river_levels",
      title: "River & bayou levels",
      description:
        "Current water levels and NWS flood stages for the rivers and bayous that flood Crosby, TX and northeast Harris County (Cedar Bayou, San Jacinto River, Luce Bayou, and more). Each gauge reports its stage, flow, flood category, and thresholds.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      outputSchema: {
        type: "object",
        properties: {
          location: { type: "string" },
          source: { type: "string" },
          updated: isoStamp,
          gauges: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                name: { type: "string" },
                stage: { type: ["number", "null"], description: "Observed gauge height in ft." },
                flow: { type: ["number", "null"], description: "Observed discharge in cfs." },
                category: { type: "string", description: "no_flooding/action/minor/moderate/major, or not_defined where NWS defines no flood stages." },
                thresholds: { type: "object", description: "NWS flood-stage thresholds in ft, keyed action/minor/moderate/major." },
                officialUrl: { type: "string" },
              },
            },
          },
        },
        required: ["gauges"],
      },
      annotations: MCP_READ_ONLY,
    },
    {
      name: "get_fishing",
      title: "Fishing conditions",
      description:
        "Live water conditions for the waters people fish near Crosby, TX — Lake Houston, the San Jacinto River forks, the Trinity River, and nearby bayous — from USGS real-time monitoring. Full stations report temperature, dissolved oxygen, pH, and turbidity; some fished bayous report water level only. A nearby-station reading, not the exact fishing spot, and conditions rather than a guaranteed bite.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      outputSchema: {
        type: "object",
        properties: {
          location: { type: "string" },
          source: { type: "string" },
          note: { type: "string" },
          updated: isoStamp,
          stations: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                water: { type: ["string", "null"], description: "The fished water body (e.g. Lake Houston)." },
                spot: { type: ["string", "null"], description: "The station's location within that water." },
                knownFor: { type: ["string", "null"], description: "Species the water is known for." },
                temperatureF: { type: ["number", "null"] },
                dissolvedOxygenMgL: { type: ["number", "null"], description: "Main driver of fish activity; >6 healthy, 4-6 moderate, <4 low." },
                ph: { type: ["number", "null"] },
                turbidityFNU: { type: ["number", "null"], description: "Water clarity; higher = more stained." },
                waterLevelFt: { type: ["number", "null"], description: "Gage height, for level-only stations." },
                conditions: { type: "string", description: "Healthy oxygen / Moderate oxygen / Low oxygen / Water level only." },
                observed: { type: ["string", "null"] },
                officialUrl: { type: "string" },
              },
            },
          },
        },
        required: ["stations"],
      },
      annotations: MCP_READ_ONLY,
    },
    {
      name: "get_traffic",
      title: "Roads & traffic",
      description:
        "Live traffic incidents and scheduled lane closures on the roads Crosby, TX drives — US-90, FM-2100, FM-1942, and the Crosby stretch of IH-10 East — from Houston TranStar, plus links to the corridor traffic cameras. High-water road reports appear here during floods. Empty lists mean quiet roads.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      outputSchema: {
        type: "object",
        properties: {
          area: { type: "string" },
          source: { type: "string" },
          updated: isoStamp,
          incidents: {
            type: ["array", "null"],
            description: "Empty = no monitored incidents (the normal state); null = the incidents feed was unreachable at the last refresh.",
            items: {
              type: "object",
              properties: {
                location: { type: "string" },
                type: { type: "string", description: 'e.g. "Accident", "Stall", "High Water".' },
                status: { type: "string", description: 'e.g. "Verified at 4:24 PM" (Central time).' },
                lanesAffected: { type: ["string", "null"] },
              },
            },
          },
          laneClosures: {
            type: ["array", "null"],
            description: "Scheduled closures; empty = none, null = feed unreachable at the last refresh.",
            items: {
              type: "object",
              properties: {
                location: { type: "string" },
                schedule: { type: "string" },
                lanesAffected: { type: ["string", "null"] },
                status: { type: ["string", "null"] },
              },
            },
          },
          cameras: {
            type: "array",
            description: "Corridor cameras — pageUrl links TranStar's own camera pages (images are not embedded).",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                roadway: { type: "string" },
                lat: { type: "number" },
                lon: { type: "number" },
                pageUrl: { type: "string" },
              },
            },
          },
          liveMapUrl: { type: "string" },
        },
        required: ["area", "source"],
      },
      annotations: MCP_READ_ONLY,
    },
    {
      name: "get_emergency_contacts",
      title: "Emergency contacts",
      description:
        "Emergency resource directory for Crosby, TX (unincorporated Harris County): 911 guidance, sheriff non-emergency, power-outage and gas-leak reporting, the CAER industrial-incident line, flood and road tools, shelters, and disaster assistance. Static verified directory — in a life-threatening emergency, call 911.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      outputSchema: {
        type: "object",
        properties: {
          location: { type: "string" },
          note: { type: "string" },
          sections: {
            type: "array",
            items: {
              type: "object",
              properties: {
                heading: { type: "string" },
                notes: { type: "array", items: { type: "string" } },
                contacts: {
                  type: "array",
                  items: { type: "object", properties: { label: { type: "string" }, note: { type: "string" }, url: { type: "string", description: "tel: or https: URL." } } },
                },
              },
            },
          },
        },
        required: ["sections"],
      },
      annotations: MCP_READ_ONLY,
    },
    {
      name: "get_radar",
      title: "Weather radar image",
      description:
        "Latest NWS KHGX (Houston/Galveston) radar still image covering Crosby, TX, returned inline as a GIF. For the animated loop, see https://crosbynews.com/radar.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: MCP_READ_ONLY,
    },
    ...HISTORY_TOOLS(MCP_READ_ONLY),
  ];
  // The directory reads `annotations.title`, not the top-level `title`; derive it so the two cannot drift.
  return tools.map((t) => ({
    ...t,
    annotations: { ...t.annotations, title: t.title },
    ...(t.outputSchema ? { outputSchema: portableSchema(t.outputSchema) } : {}),
  }));
}

// MCP prompts — one genuinely useful one: a data-grounded daily briefing.
// prompts/get composes the live data server-side (no tool round-trips), so
// the client gets a self-contained prompt with everything already in it.
export function mcpPrompts() {
  return [
    {
      name: "crosby_briefing",
      title: "Crosby daily briefing",
      description:
        "Compose a concise daily briefing for a Crosby, TX resident: current weather with feels-like, today's outlook, active alerts, sunrise/sunset, recent local headlines, and upcoming Crosby ISD events — plus river levels, road incidents, Atlantic tropical systems, and heavy pollen/mold whenever any is a live concern. The prompt arrives pre-filled with live data.",
      arguments: [],
    },
  ];
}

export async function mcpGetPrompt(name, env) {
  if (name !== "crosby_briefing") {
    const e = new Error(`Unknown prompt: ${name}`);
    e.code = -32602;
    throw e;
  }
  // Water, tropics, and traffic ride along failure-tolerant: they only ever
  // ADD lines (above-normal gauges, active storms, road incidents), so a fetch
  // hiccup must not sink the whole briefing the way a weather failure
  // legitimately does.
  const [{ data }, news, cal, water, tropics, traffic, pollen] = await Promise.all([
    loadWeather(env),
    loadNews(env),
    loadCalendar(env),
    loadWater(env).catch(() => ({ gauges: [] })),
    loadTropics(env).catch(() => ({ storms: [], disturbances: null })),
    loadTraffic(env).catch(() => ({ incidents: null, closures: null })),
    loadPollen(env).catch(() => ({ groups: {} })),
  ]);
  const now = currentHourly(data);
  const lead = data.periods?.[0];
  const sun = sunTimesForCtDate(Date.now());
  const feels = feelsLikeF(now);
  const lines = ["# Live Crosby, TX data (as of " + fullTime(data.updated) + " CT)", ""];
  if (now) lines.push(`Now: ${now.temperature}°${now.temperatureUnit}, ${now.shortForecast}${feels != null ? `, feels like ${feels}°` : ""}${pop(now) ? `, ${pop(now)}% precip` : ""}.`);
  const uvNow = uvCurrent(data), uvPk = uvPeakToday(data);
  if (uvNow || uvPk) lines.push(`UV index: ${uvNow ? `${uvNow} (${uvCategory(uvNow)}) now` : ""}${uvNow && uvPk ? ", " : ""}${uvPk ? `${uvPk} peak today` : ""}.`);
  if (data.aqi?.usAqi != null) lines.push(`Air quality (${data.aqi.measured ? `measured, EPA/AirNow ${data.aqi.reportingArea || "Houston metro"} area` : "modeled, Open-Meteo fallback"}): US AQI ${data.aqi.usAqi} (${aqiCategory(data.aqi.usAqi)})${data.aqi.dominant ? `, dominant ${aqiDominantLabel(data.aqi.dominant)}` : ""}.`);
  if (lead) lines.push(`${lead.name}: ${lead.detailedForecast}`);
  if (sun) lines.push(`Sunrise ${clockTime(sun.sunrise)}, sunset ${clockTime(sun.sunset)} CT.`);
  const alerts = data.alerts ?? [];
  lines.push(
    alerts.length
      ? `ACTIVE ALERTS: ${alerts.map((a) => `${a.event}${a.headline ? ` — ${a.headline}` : ""}`).join("; ")}`
      : "No active weather alerts."
  );
  // Quiet rivers and a quiet basin add nothing — only surface either when it
  // is actually a live concern, so calm-day briefings stay short.
  const flooding = (water.gauges ?? []).filter((g) => WATER_FLOOD_CATS.includes(g.category));
  if (flooding.length)
    lines.push(
      `RIVER/BAYOU LEVELS ABOVE NORMAL: ${flooding
        .map((g) => `${g.name} at ${g.stage != null ? `${g.stage} ft` : "n/a"} (${waterCatLabel(g.category, "en")})`)
        .join("; ")}. Details: ${SITE}/water`
    );
  const storms = tropics.storms ?? [];
  if (storms.length) lines.push(`ACTIVE ATLANTIC TROPICAL SYSTEMS: ${storms.map((s) => tropicsStormLine(s, "en")).join("; ")}. Details: ${SITE}/tropics`);
  // Areas NHC is watching but has not named. Reported separately from storms
  // and never merged into them: "60% chance of forming" is not a storm, and an
  // agent relaying it as one would overstate the situation.
  const watching = tropicsWatchAreas(tropics);
  if (!storms.length && watching.length)
    lines.push(
      `ATLANTIC AREAS BEING WATCHED FOR DEVELOPMENT (no named storm): ${watching.map((d) => tropicsDisturbanceLine(d, "en")).join("; ")}. A formation chance is not a forecast track. Details: ${SITE}/tropics`
    );
  const roadIncidents = traffic.incidents ?? [];
  if (roadIncidents.length)
    lines.push(
      `ROAD INCIDENTS ON CROSBY-AREA ROADS: ${roadIncidents
        .map((i) => `${i.location}${i.type ? ` (${i.type})` : ""}`)
        .join("; ")}. Details: ${SITE}/traffic`
    );
  // Like rivers/storms/roads, pollen only earns a line when it's a live
  // concern — a Heavy-or-worse reading on the measured HHD count.
  const heavyPollen = POLLEN_GROUPS.filter(([key]) => pollenCatRank(pollen.groups?.[key]?.category) >= 3);
  if (heavyPollen.length && pollen.countDate)
    lines.push(
      `POLLEN/MOLD AT HEAVY LEVELS (measured count for ${pollenDateLabel(pollen.countDate, "en")}): ${heavyPollen
        .map(([key]) => `${pollenGroupLabel(key, "en")} ${pollen.groups[key].category} (${pollen.groups[key].count.toLocaleString("en-US")}/m³)`)
        .join("; ")}. Details: ${SITE}/pollen`
    );
  const items = (news.items ?? []).slice(0, 5);
  if (items.length) {
    lines.push("", "Recent local headlines:");
    for (const n of items) lines.push(`- ${n.title}${n.source ? ` (${n.source})` : ""}`);
  }
  const events = upcomingEvents(cal.events ?? []).slice(0, 5);
  if (events.length) {
    lines.push("", "Upcoming Crosby ISD events:");
    for (const e of events) {
      const when = new Date(e.start).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
      lines.push(`- ${when}: ${e.summary}`);
    }
  }
  lines.push(
    "",
    "Using ONLY the data above, write a friendly, concise daily briefing for a Crosby, TX resident. Lead with anything safety-relevant (alerts, flooding rivers, tropical systems, extreme heat index). Keep it under 150 words. Note that weather data is from the U.S. National Weather Service."
  );
  return {
    description: "Data-grounded prompt for a Crosby, TX daily briefing.",
    messages: [{ role: "user", content: { type: "text", text: lines.join("\n") } }],
  };
}

// MCP resources — the machine-readable site docs, readable in-protocol.
export const MCP_RESOURCES = [
  {
    uri: `${SITE}/llms.txt`,
    name: "crosbynews-overview",
    title: "crosbynews.com site overview",
    description: "Plain-language summary of the site, its pages, API, and data policy (llms.txt).",
    mimeType: "text/markdown",
  },
  {
    uri: `${SITE}/openapi.json`,
    name: "crosbynews-openapi",
    title: "crosbynews.com API spec",
    description: "OpenAPI 3.1 description of the weather, air-quality, pollen, news, school-calendar, water-levels, fishing, tropics, and traffic API.",
    mimeType: "application/json",
  },
];

export function mcpReadResource(uri) {
  const r = MCP_RESOURCES.find((x) => x.uri === uri);
  if (!r) return null;
  const text = uri.endsWith("/llms.txt") ? llmsTxt() : JSON.stringify(openApiSpec(), null, 2);
  return { contents: [{ uri, mimeType: r.mimeType, text }] };
}

export function mcpServerCard() {
  return {
    serverInfo: MCP_SERVER_INFO,
    protocolVersion: MCP_PROTOCOL_VERSION,
    description:
      "Live Crosby, Texas data: weather from the U.S. National Weather Service (current conditions, forecast, active alerts), a measured air-quality index (EPA/AirNow, with an Open-Meteo modeled fallback), the Houston Health Department's daily pollen and mold count, the Atlantic tropical outlook, river/bayou flood levels, USGS water conditions for nearby fishing waters, road incidents and lane closures, a live radar image, recent local news headlines, the Crosby ISD school calendar, and an emergency-contacts directory.",
    transport: { type: "streamable-http", endpoint: `${SITE}/mcp` },
    capabilities: { tools: { listChanged: false }, prompts: { listChanged: false }, resources: { listChanged: false } },
    tools: mcpTools().map((t) => ({ name: t.name, title: t.title, description: t.description })),
    prompts: mcpPrompts().map((p) => ({ name: p.name, title: p.title, description: p.description })),
    resources: MCP_RESOURCES.map((r) => ({ uri: r.uri, name: r.name, title: r.title })),
    documentation: `${SITE}/`,
  };
}

// Example questions, each answerable by the tools named beside it. Shown on
// the /mcp explainer in both languages and reused verbatim as the "use cases"
// in the Anthropic directory submission (docs/ops/anthropic-directory.md), so
// the public docs and the listing say the same thing.
export const MCP_EXAMPLE_PROMPTS = [
  { en: "Is there any severe weather or flooding risk in Crosby, TX right now?", es: "¿Hay algún riesgo de clima severo o inundación en Crosby, TX ahora mismo?", tools: ["get_alerts", "get_river_levels"] },
  { en: "What's the hourly forecast for Crosby tomorrow afternoon?", es: "¿Cuál es el pronóstico por hora para Crosby mañana por la tarde?", tools: ["get_forecast"] },
  { en: "Is anything brewing in the Atlantic or the Gulf this week?", es: "¿Se está formando algo en el Atlántico o en el Golfo esta semana?", tools: ["get_tropical_outlook"] },
  { en: "How bad is the pollen in Crosby today, and is the air quality okay for a run?", es: "¿Qué tan alto está el polen hoy en Crosby, y está bien la calidad del aire para salir a correr?", tools: ["get_pollen", "get_air_quality"] },
  { en: "Is there a burn ban in Harris County right now?", es: "¿Hay prohibición de quemas en el condado de Harris ahora mismo?", tools: ["get_burn_ban"] },
  { en: "Any wrecks or lane closures on US-90 or FM-2100 near Crosby?", es: "¿Hay accidentes o cierres de carriles en la US-90 o la FM-2100 cerca de Crosby?", tools: ["get_traffic"] },
  { en: "When is the next no-school day for Crosby ISD?", es: "¿Cuándo es el próximo día sin clases en Crosby ISD?", tools: ["get_school_events"] },
];

// Human-facing explainer shown when a browser opens /mcp (which only speaks
// POST JSON-RPC). Lists the tools and how to connect. The MCP protocol/API is
// English-only; `lang` renders a Spanish HUMAN explainer at /es/mcp that points
// readers back at the English /mcp endpoint (never /es/mcp) to actually connect.
export function mcpInfoHtml(lang) {
  const tools = mcpTools()
    .map((t) => `<li><code>${esc(t.name)}</code> &mdash; ${esc(t.description)}</li>`)
    .join("\n      ");
  // Hoisted so the <title>/<meta description> and the Open Graph pair are one
  // string each rather than two copies that can drift.
  const title = T(lang, "MCP Server", "Servidor MCP");
  const description = T(
    lang,
    "Model Context Protocol (MCP) server for Crosby, TX weather: connect an AI agent to get live conditions, forecast, and alerts.",
    "Servidor de Model Context Protocol (MCP) para datos de Crosby, TX: conecta un agente de IA para obtener el clima en vivo, el pronóstico y las alertas.",
  );
  return `<!DOCTYPE html>
<html lang="${T(lang, "en", "es-MX")}">
<head>
<meta charset="utf-8">
<title>${esc(title)} &mdash; crosbynews.com</title>
<meta name="description" content="${esc(description)}">
<meta property="og:title" content="${esc(title)} &mdash; crosbynews.com">
<meta property="og:description" content="${esc(description)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${canonicalFor("/mcp", lang)}">
${sharedHead(lang)}
<link rel="canonical" href="${canonicalFor("/mcp", lang)}">
${hreflangTags("/mcp")}
${JSONLD_SITE}
<style>${BASE_CSS}
  .card { background:var(--card); border-radius:12px; padding:0.9rem 1.1rem; margin-top:1rem; box-shadow:0 1px 3px rgba(0,0,0,0.07); }
  .card h2 { margin:0 0 0.5rem; }
  code { background:color-mix(in srgb,var(--ink) 10%, transparent); padding:0.05rem 0.3rem; border-radius:4px; font-size:0.9em; }
  pre { background:color-mix(in srgb,var(--ink) 8%, transparent); padding:0.8rem; border-radius:8px; overflow-x:auto; font-size:0.85rem; }
  .intro { color:var(--muted); margin:0.6rem 0 0; }
  ul { padding-left:1.1rem; } li { margin:0.3rem 0; }
</style>
</head>
<body>
${topbar("/mcp", lang)}
<main id="main">
  <h1>${T(lang, "MCP Server", "Servidor MCP")}</h1>
  <p class="intro">${T(lang, "This is the Model Context Protocol (MCP) endpoint for crosbynews.com. It is meant for AI agents, not browsers &mdash; it speaks JSON-RPC over HTTP POST. This page just explains what it is.", "Este es el punto de acceso de Model Context Protocol (MCP) de crosbynews.com. Está pensado para agentes de IA, no para navegadores &mdash; usa JSON-RPC sobre HTTP POST. Esta página solo explica qué es.")}</p>
  ${lang === "es" ? `<section class="card"><h2>Idioma</h2><p>El servidor MCP funciona <strong>solo en inglés</strong>. Para conectarte, usa la URL en inglés <code>${SITE}/mcp</code> &mdash; <strong>no</strong> <code>${SITE}/es/mcp</code>, que es únicamente esta página explicativa en español.</p></section>` : ""}
  <section class="card">
    <h2>${T(lang, "Endpoint", "Punto de acceso")}</h2>
    <p><code>${SITE}/mcp</code> &middot; ${T(lang, "transport", "transporte")}: Streamable HTTP (JSON-RPC 2.0). ${T(lang, "Discovery card", "Tarjeta de descubrimiento")}: <a href="/.well-known/mcp/server-card.json">/.well-known/mcp/server-card.json</a>.</p>
  </section>
  <section class="card">
    <h2>${T(lang, "Tools", "Herramientas")}</h2>
    ${lang === "es" ? `<p class="intro">Los nombres y las descripciones de las herramientas se muestran en inglés &mdash; el servidor responde en inglés.</p>` : ""}
    <ul>
      ${tools}
    </ul>
  </section>
  <section class="card">
    <h2>${T(lang, "Prompts &amp; resources", "Prompts y recursos")}</h2>
    <p>${T(lang, `The prompt <code>crosby_briefing</code> returns a data-grounded daily-briefing prompt with live weather, alerts, headlines, and school events already filled in. Resources expose <a href="/llms.txt"><code>llms.txt</code></a> and the <a href="/openapi.json">OpenAPI spec</a> in-protocol.`, `El prompt <code>crosby_briefing</code> devuelve un resumen diario con datos reales: clima en vivo, alertas, titulares y eventos escolares ya incluidos. Los recursos exponen <a href="/llms.txt"><code>llms.txt</code></a> y la <a href="/openapi.json">especificación OpenAPI</a> dentro del protocolo.`)}</p>
  </section>
  <section class="card">
    <h2>${T(lang, "Connect", "Conectar")}</h2>
    <p>${T(lang, `Any MCP client that accepts a server URL can use this one. It speaks Streamable HTTP over public HTTPS and needs no key or account:`, `Cualquier cliente MCP que acepte una URL de servidor puede usar este. Habla Streamable HTTP sobre HTTPS público y no requiere clave ni cuenta:`)}</p>
    <pre>${SITE}/mcp</pre>
    <ul>
      <li><strong>Claude</strong> (claude.ai ${T(lang, "and the desktop app", "y la app de escritorio")}) — ${T(lang, `add it as a custom connector under Settings → Connectors, paste the URL, and leave authentication off. Then turn it on in a chat from <strong>+ → Connectors</strong>.`, `agrégalo como conector personalizado en Configuración → Conectores, pega la URL y deja la autenticación desactivada. Luego actívalo en un chat desde <strong>+ → Conectores</strong>.`)}</li>
      <li><strong>Claude Code</strong> — <code>claude mcp add --transport http crosbynews ${SITE}/mcp</code></li>
      <li><strong>Grok</strong> — <code>grok mcp add --transport http crosbynews ${SITE}/mcp</code>${T(lang, `, or add it as a custom connector in the Grok app.`, `, o agrégalo como conector personalizado en la app de Grok.`)}</li>
      <li><strong>Perplexity</strong> — ${T(lang, `add a custom connector under Settings, paste the URL, and leave authentication set to none.`, `agrega un conector personalizado en Configuración, pega la URL y deja la autenticación en ninguna.`)}</li>
      <li><strong>ChatGPT</strong> — ${T(lang, `through developer mode, which OpenAI currently limits to Business and Enterprise/Edu workspaces on the web.`, `mediante el modo desarrollador, que OpenAI limita actualmente a espacios de trabajo Business y Enterprise/Edu en la web.`)}</li>
    </ul>
    <p class="intro">${T(lang, `Prefer a webpage? See the <a href="/">live forecast</a>, <a href="/hourly">hourly</a>, and <a href="/radar">radar</a>.`, `¿Prefieres una página web? Mira el <a href="/es/weather">pronóstico en vivo</a>, <a href="/es/hourly">por hora</a> y <a href="/es/radar">radar</a>.`)}</p>
  </section>
  <section class="card">
    <h2>${T(lang, "Try asking", "Prueba a preguntar")}</h2>
    <p class="intro">${T(lang, "Once connected, questions like these make the agent call the tools shown:", "Una vez conectado, preguntas como estas hacen que el agente llame a las herramientas indicadas:")}</p>
    <ul>
      ${MCP_EXAMPLE_PROMPTS.map((p) => `<li>&ldquo;${esc(lang === "es" ? p.es : p.en)}&rdquo; &mdash; ${p.tools.map((t) => `<code>${t}</code>`).join(", ")}</li>`).join("\n      ")}
    </ul>
  </section>
  <section class="card">
    <h2>${T(lang, "Privacy &amp; support", "Privacidad y soporte")}</h2>
    <p>${T(lang, `No account, no key, and no personal data. Tool arguments are used to answer the request and are not stored; the server keeps only aggregate call counts. Details: <a href="/privacy">privacy policy</a>. Questions or problems: <a href="mailto:contact@crosbynews.com">contact@crosbynews.com</a>; security reports: <a href="mailto:security@crosbynews.com">security@crosbynews.com</a>.`, `Sin cuenta, sin clave y sin datos personales. Los argumentos de las herramientas se usan para responder la solicitud y no se guardan; el servidor solo conserva conteos agregados de llamadas. Detalles: <a href="/es/privacy">política de privacidad</a>. Preguntas o problemas: <a href="mailto:contact@crosbynews.com">contact@crosbynews.com</a>; reportes de seguridad: <a href="mailto:security@crosbynews.com">security@crosbynews.com</a>.`)}</p>
  </section>
</main>
${footer({ page: "/mcp", lang: lang === "es" ? "es" : "en", source: T(lang, `Data from the U.S. National Weather Service (<a href="https://weather.gov">weather.gov</a>).`, `Datos del Servicio Meteorológico Nacional de EE. UU. (<a href="https://weather.gov">weather.gov</a>).`) })}
</body>
</html>`;
}

// Markdown rendering of the same explainer, served when an agent asks for it
// (Accept: text/markdown / ?format=md) — so the footer's "View as Markdown"
// link works here like it does on every content page. `lang` mirrors the HTML:
// the protocol stays English-only; the Spanish variant is a human explainer
// that points at the English /mcp endpoint.
export function mcpInfoMarkdown(lang) {
  const tools = mcpTools()
    .map((t) => `- \`${t.name}\` — ${t.description}`)
    .join("\n");
  const examples = MCP_EXAMPLE_PROMPTS
    .map((p) => `- "${lang === "es" ? p.es : p.en}" — ${p.tools.map((t) => `\`${t}\``).join(", ")}`)
    .join("\n");
  if (lang === "es") {
    return `# Servidor MCP — crosbynews.com

Este es el punto de acceso de Model Context Protocol (MCP) de crosbynews.com.
Usa JSON-RPC 2.0 sobre HTTP POST (transporte Streamable HTTP); esta página solo
explica qué es.

**El servidor MCP funciona solo en inglés.** Para conectarte, usa la URL en
inglés \`${SITE}/mcp\` — **no** \`${SITE}/es/mcp\`, que es únicamente esta página
explicativa en español.

## Punto de acceso

- \`${SITE}/mcp\` — transporte: Streamable HTTP (JSON-RPC 2.0 sobre POST)
- Tarjeta de descubrimiento: ${SITE}/.well-known/mcp/server-card.json

## Herramientas

_Los nombres y las descripciones se muestran en inglés — el servidor responde en inglés._

${tools}

## Prompts y recursos

- Prompt \`crosby_briefing\` — un resumen diario con datos reales (clima en vivo, alertas, titulares y eventos escolares ya incluidos).
- Recursos — \`${SITE}/llms.txt\` (resumen del sitio) y \`${SITE}/openapi.json\` (especificación de la API), legibles dentro del protocolo.

## Conectar

Cualquier cliente MCP que acepte una URL de servidor puede usar este. Habla
Streamable HTTP sobre HTTPS público y no requiere clave ni cuenta:

\`\`\`
${SITE}/mcp
\`\`\`

- **Claude** (claude.ai y la app de escritorio) — agrégalo como conector personalizado en Configuración → Conectores, pega la URL y deja la autenticación desactivada. Luego actívalo en un chat desde **+ → Conectores**.
- **Claude Code** — \`claude mcp add --transport http crosbynews ${SITE}/mcp\`
- **Grok** — \`grok mcp add --transport http crosbynews ${SITE}/mcp\`, o agrégalo como conector personalizado en la app de Grok.
- **Perplexity** — agrega un conector personalizado en Configuración, pega la URL y deja la autenticación en ninguna.
- **ChatGPT** — mediante el modo desarrollador, que OpenAI limita actualmente a espacios de trabajo Business y Enterprise/Edu en la web.

¿Prefieres una página web? Mira el [pronóstico en vivo](${SITE}/es/weather),
[por hora](${SITE}/es/hourly) y [radar](${SITE}/es/radar).

## Prueba a preguntar

Una vez conectado, preguntas como estas hacen que el agente llame a las
herramientas indicadas:

${examples}

## Privacidad y soporte

Sin cuenta, sin clave y sin datos personales. Los argumentos de las
herramientas se usan para responder la solicitud y no se guardan; el servidor
solo conserva conteos agregados de llamadas. Detalles:
[política de privacidad](${SITE}/es/privacy). Preguntas o problemas:
contact@crosbynews.com; reportes de seguridad: security@crosbynews.com.

---
[crosbynews.com](${SITE}/es) · datos del Servicio Meteorológico Nacional de EE. UU.
`;
  }
  return `# MCP Server — crosbynews.com

This is the Model Context Protocol (MCP) endpoint for crosbynews.com. It speaks
JSON-RPC 2.0 over HTTP POST (Streamable HTTP transport); this page just explains
what it is.

## Endpoint

- \`${SITE}/mcp\` — transport: Streamable HTTP (JSON-RPC 2.0 over POST)
- Discovery card: ${SITE}/.well-known/mcp/server-card.json

## Tools

${tools}

## Prompts & resources

- Prompt \`crosby_briefing\` — a data-grounded daily-briefing prompt (live weather, alerts, headlines, and school events pre-filled).
- Resources — \`${SITE}/llms.txt\` (site overview) and \`${SITE}/openapi.json\` (API spec), readable in-protocol.

## Connect

Any MCP client that accepts a server URL can use this one. It speaks Streamable
HTTP over public HTTPS and needs no key or account:

\`\`\`
${SITE}/mcp
\`\`\`

- **Claude** (claude.ai and the desktop app) — add it as a custom connector under Settings → Connectors, paste the URL, and leave authentication off. Then turn it on in a chat from **+ → Connectors**.
- **Claude Code** — \`claude mcp add --transport http crosbynews ${SITE}/mcp\`
- **Grok** — \`grok mcp add --transport http crosbynews ${SITE}/mcp\`, or add it as a custom connector in the Grok app.
- **Perplexity** — add a custom connector under Settings, paste the URL, and leave authentication set to none.
- **ChatGPT** — through developer mode, which OpenAI currently limits to Business and Enterprise/Edu workspaces on the web.

Prefer a webpage? See the [live forecast](${SITE}/),
[hourly](${SITE}/hourly), and [radar](${SITE}/radar).

## Try asking

Once connected, questions like these make the agent call the tools shown:

${examples}

## Privacy & support

No account, no key, and no personal data. Tool arguments are used to answer the
request and are not stored; the server keeps only aggregate call counts.
Details: [privacy policy](${SITE}/privacy). Questions or problems:
contact@crosbynews.com; security reports: security@crosbynews.com.

---
[crosbynews.com](${SITE}/) · data from the U.S. National Weather Service
`;
}

// ArrayBuffer → base64, chunked so String.fromCharCode never sees an argument
// list long enough to overflow the call stack (radar stills run ~50–150 KB).
export function bufToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// What to say when a tool's data cannot be loaded: which feed it depends on and
// the human page that shows the same data. get_radar and get_emergency_contacts
// are absent because neither can throw (radar degrades to a text fallback,
// emergency contacts are static).
export const MCP_TOOL_SOURCES = {
  get_current_conditions: ["National Weather Service forecast", "/weather"],
  get_forecast: ["National Weather Service forecast", "/weather"],
  get_alerts: ["National Weather Service alerts", "/alerts"],
  get_air_quality: ["air-quality (EPA/AirNow)", "/air"],
  get_tropical_outlook: ["National Hurricane Center", "/tropics"],
  get_pollen: ["Houston Health Department pollen count", "/pollen"],
  get_burn_ban: ["Texas A&M Forest Service burn-ban", "/burn-ban"],
  get_crosby_news: ["local news", "/news"],
  get_school_events: ["Crosby ISD calendar", "/calendar"],
  get_river_levels: ["NWS river-gauge", "/water"],
  get_fishing: ["USGS water-conditions", "/fishing"],
  get_traffic: ["Houston TranStar traffic", "/traffic"],
  get_flood_history: ["flood-record", "/water"],
  get_warning_history: ["warning-record", "/history"],
};

// Per-argument advice appended to a validation error, so the caller learns
// what omitting the argument does instead of only what was wrong.
const MCP_OMIT_HINTS = {
  "get_forecast.hours": "Omit it for the 7-day day/night forecast.",
  "get_school_events.limit": "Omit it for the default of 15 events.",
};

const toolError = (text) => ({ content: [{ type: "text", text }], isError: true });

// Checks `args` against the tool's own inputSchema. Only the keywords those
// schemas use are implemented (type integer, minimum, maximum,
// additionalProperties:false); scripts/test-mcp-server.mjs fails if a tool
// gains a property of any other type, so a new parameter cannot slip past
// validation unchecked. `null` counts as omitted: some clients send it for
// optional parameters they were not asked to fill.
export function validateToolArgs(tool, args) {
  if (args == null) return { args: {} };
  if (typeof args !== "object" || Array.isArray(args)) {
    return { error: `Arguments for ${tool.name} must be a JSON object.` };
  }
  const props = tool.inputSchema?.properties ?? {};
  const names = Object.keys(props);
  const clean = {};
  for (const [key, value] of Object.entries(args)) {
    const spec = props[key];
    if (!spec) {
      return {
        error: `Unknown argument "${key}". ${tool.name} ${names.length ? `accepts only: ${names.join(", ")}` : "takes no arguments"}.`,
      };
    }
    if (value === null || value === undefined) continue;
    if (spec.type === "integer") {
      const ok = typeof value === "number" && Number.isInteger(value) && value >= spec.minimum && value <= spec.maximum;
      if (!ok) {
        const hint = MCP_OMIT_HINTS[`${tool.name}.${key}`];
        return {
          error: `"${key}" must be a whole number from ${spec.minimum} to ${spec.maximum}; got ${JSON.stringify(value)}.${hint ? ` ${hint}` : ""}`,
        };
      }
    }
    clean[key] = value;
  }
  return { args: clean };
}

// tools/call entry point. Order: unknown tool → JSON-RPC -32602 (a protocol
// error, per spec); bad arguments → isError result the model can read and
// correct, returned before any KV read; a data-load failure → isError result
// naming the feed and the page to check, with the upstream detail kept.
export async function mcpCallTool(name, args, env) {
  const tool = mcpTools().find((t) => t.name === name);
  if (!tool) {
    const err = new Error(`Unknown tool: ${name}`);
    err.code = -32602;
    throw err;
  }
  const checked = validateToolArgs(tool, args);
  if (checked.error) return toolError(checked.error);
  try {
    return await runTool(name, checked.args, env);
  } catch (e) {
    const [source, page] = MCP_TOOL_SOURCES[name] ?? ["crosbynews.com", "/"];
    const detail = (e && e.message) || String(e);
    return toolError(
      `Could not load the ${source} data for ${name} right now (${detail}). This is usually a temporary upstream or cache problem; retrying in a few minutes may succeed. The same data is on ${SITE}${page}.`
    );
  }
}

async function runTool(name, args, env) {
  // The record tools read D1, not KV.
  if (name === "get_flood_history" || name === "get_warning_history") return runHistoryTool(name, env);
  // News, calendar, water, and tropics tools read their own KV keys — handled
  // first so they don't pay for (or fail on) a weather load they never use.
  if (name === "get_tropical_outlook") {
    const tropics = await loadTropics(env);
    const payload = apiTropics(tropics);
    const stormText = payload.storms
      .map((s) => {
        const bits = [];
        if (s.windMph != null) bits.push(`${s.windMph} mph winds`);
        if (s.pressureMb != null) bits.push(`${s.pressureMb} mb`);
        if (s.lat != null && s.lon != null) bits.push(`near ${Math.abs(s.lat)}°${s.lat < 0 ? "S" : "N"} ${Math.abs(s.lon)}°${s.lon < 0 ? "W" : "E"}`);
        if (s.movementDirection) bits.push(`moving ${s.movementDirection}`);
        return `- ${s.classificationLabel} ${s.name}${bits.length ? ` — ${bits.join(", ")}` : ""} (advisory: ${s.advisoryUrl})`;
      })
      .join("\n");
    // The all-clear is only stated when BOTH lists are empty. An agent reading
    // an empty `storms` and announcing "all clear" is precisely the mistake
    // this page made to a human reader on 2026-08-24.
    const dzText =
      payload.disturbances === null
        ? "The NHC tropical outlook could not be read, so whether anything is being watched is UNKNOWN — this is not an all-clear."
        : payload.disturbances.length
          ? `Areas being watched for development (not named storms):\n${payload.disturbances
              .map((d) => {
                const w = [];
                if (d.chance48Percent != null) w.push(`${d.chance48Percent}% in 48h`);
                if (d.chance7DayPercent != null) w.push(`${d.chance7DayPercent}% in 7 days`);
                return `- ${d.area}${d.id ? ` (${d.id})` : ""}${w.length ? ` — ${w.join(", ")} chance of forming` : ""}`;
              })
              .join("\n")}\nA formation chance is not a forecast track.`
          : "";
    const text =
      [stormText ? `Active Atlantic systems:\n${stormText}` : "", dzText].filter(Boolean).join("\n\n") ||
      "No active tropical systems in the Atlantic basin and no areas under watch for development — all clear. (Hurricane season runs June–November; Crosby's local threat is inland rain flooding, not surge.)";
    return { content: [{ type: "text", text }], structuredContent: payload };
  }
  if (name === "get_traffic") {
    const traffic = await loadTraffic(env);
    const payload = apiTraffic(traffic);
    const incLines =
      payload.incidents === null
        ? "Incident data is temporarily unavailable."
        : payload.incidents.length
          ? payload.incidents
              .map((i) => `- ${i.location}${i.type ? ` — ${i.type}` : ""}${i.status ? ` (${i.status})` : ""}${i.lanesAffected ? `. Lanes affected: ${i.lanesAffected}` : ""}`)
              .join("\n")
          : "No monitored incidents on Crosby-area roads right now (US-90, FM-2100, FM-1942, IH-10 East).";
    const clLine =
      payload.laneClosures === null
        ? "Lane-closure data is temporarily unavailable."
        : payload.laneClosures.length
          ? `${payload.laneClosures.length} scheduled lane closure(s) on the Crosby corridors — see structured data or ${SITE}/traffic.`
          : "No scheduled lane closures on the Crosby corridors.";
    const text = `${incLines}\n\n${clLine}\n\nLive cameras and map: ${SITE}/traffic (data: Houston TranStar). Never drive into high water.`;
    return { content: [{ type: "text", text }], structuredContent: payload };
  }
  if (name === "get_pollen") {
    const pollen = await loadPollen(env);
    const payload = apiPollen(pollen);
    const parts = POLLEN_GROUPS.filter(([key]) => payload.groups[key]).map(([key]) => {
      const g = payload.groups[key];
      return `${pollenGroupLabel(key, "en")}: ${g.category} (${g.count.toLocaleString("en-US")}/m³)`;
    });
    const text = parts.length
      ? `${parts.join(" · ")} — measured count for ${pollenDateLabel(payload.countDate, "en")} by the Houston Health Department (National Allergy Bureau station; new counts publish weekday mornings). Details: ${SITE}/pollen`
      : `The pollen and mold count is temporarily unavailable. Official source: ${payload.officialUrl}`;
    return { content: [{ type: "text", text }], structuredContent: payload };
  }
  if (name === "get_burn_ban") {
    const burnban = await loadBurnBan(env);
    const payload = apiBurnBan(burnban);
    // Scope matters here as much as on the page: a Harris County ban covers
    // the UNINCORPORATED county (where Crosby is), not every city in it.
    // burnbanSince() supplies the history clause, and is the only thing
    // allowed to turn statusSince into a sentence — see its comment.
    const since = burnbanSince(burnban, "en");
    const tail = `${since ? ` ${since}` : ""} A county ban is not the only thing that governs outdoor burning: Texas restricts it statewide regardless. Official page: ${payload.officialUrl}`;
    const text =
      payload.status === "Yes"
        ? `Burn ban in effect: outdoor burning is prohibited in unincorporated Harris County, TX, which includes Crosby.${tail}`
        : payload.status === "No"
          ? `No burn ban in Harris County, TX right now.${tail}`
          : `Burn ban status is temporarily unavailable. Official page: ${payload.officialUrl}`;
    return { content: [{ type: "text", text }], structuredContent: payload };
  }
  if (name === "get_air_quality") {
    const { data } = await loadWeather(env);
    const payload = apiAir(data);
    const a = payload.airQuality;
    const text = a
      ? `US AQI ${a.usAqi} (${a.category})${a.dominantPollutant ? `, ${a.dominantPollutant}-driven` : ""} near Crosby, TX — ${a.measured ? `measured by the closest ${a.reportingAgency || "TCEQ/AirNow"} monitors${a.dominantMonitor ? ` (${a.dominantPollutant} from ${a.dominantMonitor})` : ""} in the ${a.reportingArea || "Houston-Galveston-Brazoria"} area` : "modeled (Open-Meteo fallback)"}. ${aqiHealth(a.usAqi, "en")} Details: ${SITE}/air`
      : `The air quality reading is temporarily unavailable. See ${SITE}/air`;
    return { content: [{ type: "text", text }], structuredContent: payload };
  }
  if (name === "get_emergency_contacts") {
    const abs = (href) => (href.startsWith("/") ? `${SITE}${href}` : href);
    const payload = {
      location: "Crosby, TX (unincorporated Harris County)",
      note: "In an immediate emergency — medical crisis, fire, crime in progress, water entering a home — call 911. Crosby is unincorporated, so Houston's 311 does not cover it.",
      sections: EMERGENCY.sections.map((s) => ({
        heading: s.h,
        notes: s.p ?? [],
        contacts: (s.links ?? []).map((l) => ({ label: l.label, note: l.note, url: abs(l.href) })),
      })),
    };
    const text = [
      "Emergency resources for Crosby, TX. In an immediate emergency, call 911.",
      ...payload.sections
        .filter((s) => s.contacts.length)
        .map((s) => `${s.heading}:\n${s.contacts.map((c) => `- ${c.label} — ${c.note}`).join("\n")}`),
      `Full directory: ${SITE}/emergency`,
    ].join("\n\n");
    return { content: [{ type: "text", text }], structuredContent: payload };
  }
  if (name === "get_radar") {
    let res = null;
    try {
      res = await fetch("https://radar.weather.gov/ridge/standard/KHGX_0.gif", {
        headers: { "User-Agent": "crosbynews.com", Accept: "image/gif,image/*" },
        cf: { cacheTtl: 180, cacheEverything: true },
      });
    } catch {}
    if (!res || !res.ok) {
      return {
        content: [{ type: "text", text: `Radar imagery is temporarily unavailable — see ${SITE}/radar for the live loop.` }],
      };
    }
    const data = bufToBase64(await res.arrayBuffer());
    return {
      content: [
        { type: "text", text: `Latest NWS KHGX radar still (covers Crosby, TX — the Houston/Galveston radar). Animated loop: ${SITE}/radar` },
        { type: "image", data, mimeType: res.headers.get("content-type")?.split(";")[0] || "image/gif" },
      ],
    };
  }
  if (name === "get_crosby_news") {
    const news = await loadNews(env);
    const items = news.items ?? [];
    const text = items.length
      ? items
          .map((n) => `- ${n.title}${n.source ? ` (${n.source}${n.ts ? `, ${newsDate(n.ts)}` : ""})` : ""}`)
          .join("\n")
      : "No recent Crosby news right now.";
    return { content: [{ type: "text", text }], structuredContent: apiNews(news) };
  }
  if (name === "get_school_events") {
    const cal = await loadCalendar(env);
    const limit = args.limit ?? 15;
    const payload = apiCalendar(cal);
    payload.events = payload.events.slice(0, limit);
    const shown = upcomingEvents(cal.events ?? []).slice(0, limit);
    const text = shown.length
      ? shown
          .map((e) => {
            const when = new Date(e.start).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
            return `- ${when}: ${e.summary}${e.allDay ? "" : ` (${calTime(e.start)})`}${e.location ? ` — ${e.location}` : ""}`;
          })
          .join("\n")
      : "No upcoming Crosby ISD events are posted right now.";
    return { content: [{ type: "text", text }], structuredContent: payload };
  }
  if (name === "get_river_levels") {
    const water = await loadWater(env);
    const payload = apiWater(water);
    const text = payload.gauges.length
      ? payload.gauges
          .map((g) => {
            const th = ["action", "minor", "moderate", "major"]
              .filter((k) => typeof g.thresholds[k] === "number")
              .map((k) => `${k} ${g.thresholds[k]}ft`)
              .join(", ");
            return `- ${g.name}: ${g.stage != null ? `${g.stage} ft` : "n/a"} (${waterState(g, "en").label})${g.flow != null ? `, ${g.flow.toLocaleString("en-US")} cfs` : ""}${th ? ` [flood stages: ${th}]` : ""}`;
          })
          .join("\n")
      : "Water level data is temporarily unavailable.";
    return { content: [{ type: "text", text }], structuredContent: payload };
  }
  if (name === "get_fishing") {
    const fishing = await loadFishing(env);
    const payload = apiFishing(fishing);
    const text = payload.stations.length
      ? payload.stations
          .map((s) => {
            const wq =
              s.dissolvedOxygenMgL != null
                ? `${s.temperatureF != null ? `${s.temperatureF}°F, ` : ""}DO ${s.dissolvedOxygenMgL} mg/L${s.ph != null ? `, pH ${s.ph}` : ""}${s.turbidityFNU != null ? `, turbidity ${Math.round(s.turbidityFNU)} FNU` : ""}`
                : s.waterLevelFt != null
                ? `water level ${s.waterLevelFt} ft`
                : "no reading";
            return `- ${s.water}${s.spot ? ` (${s.spot})` : ""}: ${s.conditions} — ${wq}`;
          })
          .join("\n")
      : "Fishing conditions are temporarily unavailable.";
    return { content: [{ type: "text", text }], structuredContent: payload };
  }

  const { data } = await loadWeather(env);
  if (name === "get_current_conditions") {
    const now = currentHourly(data);
    const feels = feelsLikeF(now);
    const sun = sunTimesForCtDate(Date.now());
    const uvNow = uvCurrent(data);
    const aqi = data.aqi;
    const text = now
      ? `Crosby, TX: ${now.temperature}°${now.temperatureUnit}, ${now.shortForecast}` +
        `${feels != null ? `, feels like ${feels}°` : ""}${pop(now) ? `, ${pop(now)}% precip` : ""} (as of ${clockTime(now.startTime)} CT).` +
        `${uvNow ? ` UV index ${uvNow} (${uvCategory(uvNow)}).` : ""}` +
        `${aqi?.usAqi != null ? ` Air quality (${aqi.measured ? `measured, ${aqi.reportingArea || "Houston metro"} area` : "modeled"}) US AQI ${aqi.usAqi} (${aqiCategory(aqi.usAqi)}).` : ""}` +
        `${sun ? ` Sunrise ${clockTime(sun.sunrise)}, sunset ${clockTime(sun.sunset)} CT.` : ""}`
      : "Current conditions are unavailable.";
    return {
      content: [{ type: "text", text }],
      structuredContent: {
        location: data.place,
        updated: data.updated,
        sun: sun ? { sunrise: new Date(sun.sunrise).toISOString(), sunset: new Date(sun.sunset).toISOString() } : null,
        uv: uvNow != null ? { current: uvNow, currentCategory: uvCategory(uvNow), peakToday: uvPeakToday(data) } : null,
        airQuality: aqi?.usAqi != null ? { usAqi: aqi.usAqi, category: aqiCategory(aqi.usAqi), dominantPollutant: aqiDominantLabel(aqi.dominant), measured: !!aqi.measured, reportingArea: aqi.reportingArea ?? null, source: aqi.measured ? "EPA/AirNow measured (Houston metro reporting area)" : "Open-Meteo (modeled fallback)" } : null,
        current: now
          ? {
              ...now,
              feelsLike: feelsLikeRawF(now),
              // Normalized conveniences: NWS reports dew point in °C and wraps
              // humidity in a unit object — chat clients want plain numbers.
              dewpointF: typeof now.dewpoint?.value === "number" ? Math.round((now.dewpoint.value * 9) / 5 + 32) : null,
              humidityPercent: typeof now.relativeHumidity?.value === "number" ? Math.round(now.relativeHumidity.value) : null,
            }
          : null,
      },
    };
  }
  if (name === "get_forecast") {
    const hours = args.hours;
    if (hours != null) {
      // The KV cache keeps 48 hourly periods (the /hourly page's supply) —
      // serve up to all of them so "tomorrow evening" is answerable.
      const slice = (data.hourly ?? []).slice(0, hours);
      const text =
        slice
          .map((h) => {
            const feels = feelsLikeRawF(h);
            return `${hourLabel(h.startTime)}: ${h.temperature}°${h.temperatureUnit}, ${h.shortForecast}${feels != null ? `, feels like ${feels}°` : ""}${pop(h) ? `, ${pop(h)}% precip` : ""}`;
          })
          .join("\n") || "No hourly data.";
      return { content: [{ type: "text", text }], structuredContent: { location: data.place, hourly: slice.map((h) => ({ ...h, feelsLike: feelsLikeRawF(h) })) } };
    }
    const text =
      (data.periods ?? [])
        .map((p) => `${p.name}: ${p.isDaytime ? "High" : "Low"} ${p.temperature}°${p.temperatureUnit}, ${p.shortForecast}. ${p.detailedForecast}`)
        .join("\n\n") || "No forecast data.";
    return { content: [{ type: "text", text }], structuredContent: { location: data.place, forecast: data.periods ?? [] } };
  }
  if (name === "get_alerts") {
    const alerts = data.alerts ?? [];
    const text = alerts.length
      ? alerts.map((a) => `${a.event}${a.headline ? ` — ${a.headline}` : ""}${a.expires ? ` (until ${fullTime(a.expires)} CT)` : ""}`).join("\n")
      : "No active weather alerts for Crosby, TX.";
    return { content: [{ type: "text", text }], structuredContent: { location: data.place, count: alerts.length, alerts } };
  }
  const err = new Error(`Unknown tool: ${name}`);
  err.code = -32602;
  throw err;
}

export async function mcpHandle(msg, env) {
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    return msg && msg.id != null ? rpcError(msg.id, -32600, "Invalid Request") : null;
  }
  const { id, method, params } = msg;
  const isRequest = id !== undefined && id !== null;
  switch (method) {
    case "initialize":
      return rpcResult(id, {
        protocolVersion: MCP_SUPPORTED_VERSIONS.includes(params?.protocolVersion) ? params.protocolVersion : MCP_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false }, prompts: { listChanged: false }, resources: { listChanged: false } },
        serverInfo: MCP_SERVER_INFO,
        instructions:
          "Live Crosby, Texas data: weather from the U.S. National Weather Service, a measured air-quality index (EPA/AirNow), the daily pollen and mold count, the Atlantic tropical outlook, river/bayou flood levels, USGS water conditions for nearby fishing waters, road incidents and lane closures, a radar image, local news headlines, the Crosby ISD school calendar, and an emergency-contacts directory.",
      });
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, { tools: mcpTools() });
    case "prompts/list":
      return rpcResult(id, { prompts: mcpPrompts() });
    case "prompts/get":
      try {
        return rpcResult(id, await mcpGetPrompt(params?.name, env));
      } catch (e) {
        return rpcError(id, typeof e?.code === "number" ? e.code : -32603, (e && e.message) || "prompt failed");
      }
    case "resources/list":
      return rpcResult(id, { resources: MCP_RESOURCES });
    case "resources/read": {
      const res = mcpReadResource(params?.uri);
      return res ? rpcResult(id, res) : rpcError(id, -32602, `Unknown resource: ${params?.uri}`);
    }
    case "tools/call":
      try {
        const res = await mcpCallTool(params?.name, params?.arguments ?? {}, env);
        return rpcResult(id, res);
      } catch (e) {
        if (e && typeof e.code === "number") return rpcError(id, e.code, e.message);
        return rpcResult(id, { content: [{ type: "text", text: `Error: ${(e && e.message) || e}` }], isError: true });
      }
    default:
      // Notifications (e.g. notifications/initialized) get no response.
      if (!isRequest) return null;
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}
