// The get_rainfall tool: measured rain at the USGS weather station on the
// Lake Houston dam, the same record and loader as the /rain page (loadRain),
// so the tool and the page cannot disagree. Read-only, no arguments. A D1
// failure becomes the usual isError result via MCP_TOOL_SOURCES in server.js.

import { SITE } from "../config.js";
import { loadRain, expectedReadings, RAIN_STATION, RAIN_STATION_URL } from "../features/rain.js";

const RECENT_DAYS = 7;
const round2 = (x) => Math.round(x * 100) / 100;
const ctStamp = (iso) => `${new Date(iso).toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "medium", timeStyle: "short" })} CT`;

// `expected` is the number of 15-minute readings that window should hold.
function windowOf(w, expected) {
  if (!w || !w.n) return { inches: null, readings: 0, expectedReadings: expected, complete: false, provisionalReadings: 0 };
  return { inches: round2(w.s), readings: w.n, expectedReadings: expected, complete: w.n >= expected, provisionalReadings: w.prov ?? 0 };
}

const windowSchema = {
  type: "object",
  properties: {
    inches: { type: ["number", "null"], description: "Rain in the window, rounded to 0.01 in; null when it holds no readings." },
    readings: { type: "integer" },
    expectedReadings: { type: "integer" },
    complete: { type: "boolean" },
    provisionalReadings: { type: "integer" },
  },
  required: ["inches", "readings", "expectedReadings", "complete"],
};

export const RAIN_TOOLS = (annotations) => [
  {
    name: "get_rainfall",
    title: "Measured rainfall",
    description:
      "Rain measured by the USGS weather station at the Lake Houston dam, about 5 miles west of Crosby, TX, in 15-minute amounts: the last hour, the last 24 hours, the day so far, and the last 7 days. Each window ends at the latest reading (latestReading), not at the current time, so check latestReading before reading a window as recent. A window or day short of its readings is marked incomplete and its total may be low; a missing reading is not a dry spell. Amounts are inches. Readings are provisional USGS data. This is one station, and rain can differ a lot over a few miles. For the forecast use get_forecast; for flooding use get_river_levels.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    outputSchema: {
      type: "object",
      properties: {
        source: { type: "string" },
        station: {
          type: "object",
          properties: { id: { type: "string" }, name: { type: "string" }, url: { type: "string" } },
        },
        page: { type: "string" },
        latestReading: { type: ["string", "null"], description: "ISO 8601 instant of the newest reading. Every window ends here." },
        since: { type: ["string", "null"], description: "First Central day with a reading (YYYY-MM-DD)." },
        windows: {
          type: ["object", "null"],
          description: "Null when no readings exist yet.",
          properties: {
            lastHour: windowSchema,
            last24Hours: windowSchema,
            todaySoFar: {
              type: "object",
              properties: {
                day: { type: "string", description: "Central day (YYYY-MM-DD) of the latest reading." },
                inches: { type: ["number", "null"] },
                readings: { type: "integer" },
                expectedReadings: { type: "integer", description: "Readings the whole day holds; a day still in progress is partial." },
                complete: { type: "boolean" },
                provisionalReadings: { type: "integer" },
              },
            },
          },
        },
        recentDays: {
          type: "array",
          description: "Newest first.",
          items: {
            type: "object",
            properties: {
              day: { type: "string" },
              inches: { type: "number" },
              readings: { type: "integer" },
              expectedReadings: { type: "integer" },
              complete: { type: "boolean" },
            },
          },
        },
        notes: { type: "array", items: { type: "string" } },
        updated: { type: ["string", "null"] },
      },
      required: ["source", "station", "recentDays", "notes"],
    },
    annotations,
  },
];

export async function runRainTool(env) {
  const d = await loadRain(env);
  const w = d.window;
  const windows = d.last
    ? {
        lastHour: windowOf(w.hour, 4),
        last24Hours: windowOf(w.day, 96),
        todaySoFar: { day: w.todayDay, ...windowOf(w.today, expectedReadings(w.todayDay)) },
      }
    : null;
  const recentDays = d.daily.slice(0, RECENT_DAYS).map((r) => ({
    day: r.day,
    inches: round2(r.total),
    readings: r.n,
    expectedReadings: expectedReadings(r.day),
    complete: r.n >= expectedReadings(r.day),
  }));
  const payload = {
    source: "U.S. Geological Survey weather station 08072000 (Lake Houston dam), rain as 15-minute amounts. Provisional until USGS reviews it.",
    station: { id: RAIN_STATION, name: "Lake Houston dam (USGS weather station)", url: RAIN_STATION_URL },
    page: `${SITE}/rain`,
    latestReading: d.last ? new Date(d.last).toISOString() : null,
    since: d.since,
    windows,
    recentDays,
    notes: [
      "Totals are sums of the 15-minute amounts USGS publishes. USGS marks recent readings provisional and can revise them; the site re-reads the last 35 days each day.",
      "A window or day marked incomplete is missing some readings, so its total may be low. It is not evidence that no rain fell.",
      "An amount over 8 inches in 15 minutes is treated as a sensor error and left out, which marks its day incomplete.",
      "A rain day is a day with at least 0.01 in.",
    ],
    updated: d.last ? new Date(d.last).toISOString() : null,
  };
  const text = d.last
    ? [
        `Rain at the Lake Houston dam (USGS station ${RAIN_STATION}), through the reading of ${ctStamp(d.last)}:`,
        `Last hour: ${windows.lastHour.inches === null ? "no readings" : `${windows.lastHour.inches.toFixed(2)} in`} (${windows.lastHour.readings} of 4 readings${windows.lastHour.complete ? "" : ", incomplete"}).`,
        `Last 24 hours: ${windows.last24Hours.inches === null ? "no readings" : `${windows.last24Hours.inches.toFixed(2)} in`} (${windows.last24Hours.readings} of 96 readings${windows.last24Hours.complete ? "" : ", incomplete"}).`,
        `${windows.todaySoFar.day} so far: ${windows.todaySoFar.inches === null ? "no readings" : `${windows.todaySoFar.inches.toFixed(2)} in`} (${windows.todaySoFar.readings} of ${windows.todaySoFar.expectedReadings} readings for the day).`,
        `Recent days, newest first: ${recentDays.map((r) => `${r.day} ${r.inches.toFixed(2)} in${r.complete ? "" : " (incomplete)"}`).join("; ") || "none"}.`,
        "Provisional USGS data. Full record: " + payload.page,
      ].join("\n")
    : "No rain readings have been recorded yet. Full record: " + payload.page;
  return { content: [{ type: "text", text }], structuredContent: payload };
}
