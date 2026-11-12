// The two MCP tools over the record: a gauge's flood history and the NWS
// warning history. Each is built on the same loader as its page
// (loadGaugePage, loadHistory), so a tool and its page cannot disagree.
// Read-only, no arguments; a D1 failure becomes the usual isError result via
// MCP_TOOL_SOURCES in server.js.

import { SITE } from "../config.js";
import { PAGES } from "../registry.js";
import { RECORD_OBSERVED_FROM, ctDay } from "../record.js";
import { loadGaugePage, crestVsStages, crestWhen, crestStatus } from "../features/gauge.js";
import { loadHistory, yearTable, pointBy, eventName, POINT_COLUMNS, POLYGONS_OFFICIAL_FROM, ZONE } from "../features/history.js";

const HIGHEST = 5;
const COLUMN_KEYS = { "TO.W": "tornado", "SV.W": "severeThunderstorm", "FF.W": "flashFlood", "FA.W": "floodWarning", "FA.Y": "floodAdvisory" };
const dateOnly = (iso) => (crestWhen(iso, "en").text.endsWith(" CT") ? new Date(iso).toISOString() : iso.slice(0, 10));

export const HISTORY_TOOLS = (annotations) => [
  {
    name: "get_flood_history",
    title: "Flood history of Crosby's river gauges",
    description:
      "The flood record for the river gauges near Crosby, TX that have one (Cedar Bayou near Crosby, the San Jacinto River near Sheldon and at Lake Houston, the East Fork San Jacinto near New Caney): each gauge's highest historic crests as NOAA publishes them, measured against TODAY's NWS flood stages (stages may have differed when a crest happened), how many crests and river flood warnings the record holds, and a link to the full page. Crests NOAA marks as on an older gauge datum are counted but never compared. For current levels use get_river_levels.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    outputSchema: {
      type: "object",
      properties: {
        source: { type: "string" },
        note: { type: "string" },
        gauges: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "NWS location id (LID)." },
              name: { type: "string" },
              page: { type: "string", description: "The gauge's flood-history page." },
              floodStages: { type: "object", description: "Today's NWS flood stages in ft, keyed action/minor/moderate/major; empty where none are defined." },
              crestCount: { type: "integer" },
              oldDatumCrestCount: { type: "integer", description: "Crests on an older gauge datum: not comparable with today's stages." },
              highestCrests: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    date: { type: "string", description: "YYYY-MM-DD when NOAA gives no time, else an ISO instant." },
                    when: { type: "string", description: "The same date for people: Central time when NOAA gives a time." },
                    stageFt: { type: "number" },
                    againstTodaysStages: { type: ["string", "null"] },
                    status: { type: "string", description: "NWS crest status: Preliminary, Official or Record (\u2014 when none)." },
                    noaaCode: { type: ["string", "null"], description: "The letter NWPS publishes for that status (P, O, R)." },
                    noaaFlowCfs: { type: ["number", "null"], description: "Crest flow as NOAA publishes it; null when none, or on gauges where NOAA's figure is not a measured flow." },
                    usgsFlowCfs: { type: ["number", "null"], description: "USGS's annual peak flow, when that year's peak falls on the crest's date." },
                  },
                },
              },
              riverFloodWarnings: { type: "integer" },
              latestRiverFloodWarning: { type: ["string", "null"] },
            },
          },
        },
      },
      required: ["gauges"],
    },
    annotations,
  },
  {
    name: "get_warning_history",
    title: "NWS warning history for Crosby",
    description:
      "How many National Weather Service warnings, watches and advisories have covered Crosby, TX, by type and year, computed from the site's record: tornado, severe thunderstorm, flash flood and flood warnings whose polygon contained Crosby (counted from 2007-10-01, when polygons became the official warned area), products for forecast zone TXZ213 (tropical, winter, heat, fire weather, fog; the zone has been redrawn), and Harris County watches. Includes the date of every tornado warning. For active alerts use get_alerts.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    outputSchema: {
      type: "object",
      properties: {
        source: { type: "string" },
        page: { type: "string" },
        polygonsCountedFrom: { type: "string" },
        zone: { type: "string" },
        totals: { type: "object", description: "Polygon warnings containing Crosby, keyed tornado/severeThunderstorm/flashFlood/floodWarning/floodAdvisory." },
        tornadoWarnings: { type: "array", items: { type: "string", description: "ISO instant each was issued." } },
        byYear: { type: "array", items: { type: "object", description: "One row per Central-time year: year plus a count per totals key." } },
        zoneProducts: { type: "array", items: { type: "object", description: "product, code, count, first, latest." } },
        countyWatches: { type: "array", items: { type: "object", description: "product, code, count, first, latest." } },
        notes: { type: "array", items: { type: "string" } },
      },
      required: ["totals"],
    },
    annotations,
  },
];

export async function runHistoryTool(name, env) {
  if (name === "get_flood_history") {
    const gauges = await Promise.all(PAGES.filter((p) => p.gauge).map((p) => loadGaugePage(env, p.gauge)));
    const payload = {
      source: "NOAA/NWS National Water Prediction Service (crests, flood stages); NWS river flood warnings as recorded by crosbynews.com, with the Iowa Environmental Mesonet archive before it began recording.",
      note: "Crests are compared with the flood stages NWS defines today; the stages in force when a crest happened may have been different.",
      gauges: gauges.map((d) => ({
        id: d.lid,
        name: d.names.en,
        page: SITE + d.page,
        floodStages: d.gauge?.thresholds ?? {},
        crestCount: d.crests.length + d.oldCrests.length,
        oldDatumCrestCount: d.oldCrests.length,
        highestCrests: d.crests.slice(0, HIGHEST).map((c) => ({ date: dateOnly(c.occurred), when: crestWhen(c.occurred, "en").text, stageFt: c.stage, againstTodaysStages: crestVsStages(c.stage, d.gauge?.thresholds, "en"), status: crestStatus(c.quality, "en"), noaaCode: c.quality ?? null, noaaFlowCfs: d.noFlow ? null : (c.flow ?? null), usgsFlowCfs: c.usgsFlow ?? null })),
        riverFloodWarnings: d.warnings.length,
        latestRiverFloodWarning: d.warnings[0]?.issued ?? null,
      })),
    };
    const text = payload.gauges
      .map((g) => {
        const top = g.highestCrests[0];
        return `- ${g.name} (${g.id}): ${g.crestCount} crests on record${g.oldDatumCrestCount ? ` (${g.oldDatumCrestCount} on an older datum)` : ""}; highest ${top ? `${top.stageFt} ft on ${top.when}${top.againstTodaysStages ? `, ${top.againstTodaysStages}` : ""}` : "none listed"}; ${g.riverFloodWarnings} river flood warnings recorded. ${g.page}`;
      })
      .join("\n");
    return { content: [{ type: "text", text: `${text}\n\n${payload.note}` }], structuredContent: payload };
  }
  if (name === "get_warning_history") {
    const d = await loadHistory(env);
    const { years, totals } = yearTable(d);
    const keyed = (c) => Object.fromEntries(POINT_COLUMNS.map((k) => [COLUMN_KEYS[k], c[k]]));
    const group = (rows) => rows.map((g) => ({ product: eventName(g, "en"), code: `${g.phenomena}.${g.significance}`, count: g.n, first: g.first, latest: g.last }));
    const tornadoes = pointBy(d, "TO.W").map((r) => r.issued);
    const payload = {
      source: "U.S. National Weather Service products as recorded by crosbynews.com, with the Iowa Environmental Mesonet archive (Iowa State University) before it began recording.",
      page: `${SITE}/history`,
      polygonsCountedFrom: POLYGONS_OFFICIAL_FROM,
      zone: ZONE,
      totals: keyed(totals),
      tornadoWarnings: tornadoes,
      byYear: years.map(([year, c]) => ({ year, ...keyed(c) })),
      zoneProducts: group(d.zone),
      countyWatches: group(d.county),
      notes: [
        "Each count is one NWS event (an extended warning counts once); years are Central-time calendar years of issue.",
        `Zone ${ZONE} has been redrawn; an older entry covers whatever the zone covered then.`,
        "County watches cover all of Harris County, a very large county.",
        `The site began filing its own observations on ${RECORD_OBSERVED_FROM}.`,
      ],
    };
    const t = payload.totals;
    const zw = payload.zoneProducts.filter((z) => z.code.endsWith(".W")).map((z) => `${z.product} ${z.count}`).join(", ");
    const text = [
      `Since ${POLYGONS_OFFICIAL_FROM}, warnings whose polygon contained Crosby: ${t.tornado} tornado, ${t.severeThunderstorm} severe thunderstorm, ${t.flashFlood} flash flood, ${t.floodWarning} flood.`,
      tornadoes.length ? `Tornado warnings issued (Central dates): ${tornadoes.map(ctDay).join(", ")}.` : "No tornado warning has included Crosby.",
      zw ? `Warnings for zone ${ZONE}: ${zw}.` : "",
      `Full table: ${payload.page}`,
    ].filter(Boolean).join("\n");
    return { content: [{ type: "text", text }], structuredContent: payload };
  }
  return null;
}
