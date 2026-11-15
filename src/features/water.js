// River and bayou flood gauges from NOAA/NWS NWPS — the waters that flood
// Crosby and NE Harris County.
//
// The badge is NWPS's own floodCategory; we never invent a classification.
// -9999 (undefined threshold) and -999 (no forecast) are NWPS sentinels,
// filtered by waterNum() so they never render as numbers.

import { T, canonicalFor, hreflangTags, esPath } from "../i18n.js";
import { esc, fullTime, clockTime, dateStamp, timeTag } from "../lib/format.js";
import { BASE_CSS } from "../assets/base-css.js";
import { topbar, footer } from "../chrome.js";
import { JSONLD_SITE, sharedHead } from "../seo.js";
import { gaugePagePath } from "../registry.js";
import { fetchUsgsOgc } from "./fishing.js";

// Crosby's defining hazard is flooding. This renders live stage + flood-
// category for the waters that flood Crosby / NE Harris County, from NOAA/NWS
// National Water Prediction Service (water.noaa.gov) — the same agency family
// as the NWS weather we already serve, so attribution stays consistent and no
// API key is needed. The Worker CAN reach NWPS, so this uses the cron + KV
// pattern (key "water", cron-owned, refreshed every 15 min since levels move
// fast in a flood), like weather/calendar. NWPS gives observed stage, flow, and
// the flood-category THRESHOLDS all keyed to the same gauge datum, so the
// current reading and the thresholds are directly comparable (never mixed
// across datums). NWPS's own `floodCategory` is used verbatim for the badge —
// we don't invent classifications on a life-safety page.
export const WATER_KV_KEY = "water";
// The Crosby-core gauges (NWPS location IDs), the waters that actually flood
// Crosby and the surrounding NE Harris County / San Jacinto corridor.
export const WATER_GAUGES = [
  { lid: "HCDT2", en: "Cedar Bayou near Crosby", es: "Cedar Bayou cerca de Crosby" },
  // noFlow: NWPS still reports a flow here, but USGS measures none that it
  // could stand for. 08072000 is a lake-level gage with no discharge series;
  // 08072050 is tidal, where measured flow swings both ways through zero while
  // NWPS's figure stays thousands of cfs positive. Stage is real at both.
  { lid: "SHLT2", en: "San Jacinto River near Sheldon", es: "Río San Jacinto cerca de Sheldon", noFlow: true },
  { lid: "HSJT2", en: "San Jacinto River at Lake Houston", es: "Río San Jacinto en Lake Houston", noFlow: true },
  { lid: "HFFT2", en: "Luce Bayou near Huffman", es: "Luce Bayou cerca de Huffman" },
  { lid: "GMKT2", en: "Goose Creek near McNair", es: "Goose Creek cerca de McNair" },
  { lid: "NCET2", en: "East Fork San Jacinto River near New Caney", es: "Bifurcación Este del Río San Jacinto cerca de New Caney" },
];
export const nwpsGaugeUrl = (lid) => `https://water.noaa.gov/gauges/${lid}`;

// NWPS uses -9999 (undefined threshold) and -999 (no current forecast) as
// sentinels; treat anything that low as "not a real reading".
export const waterNum = (v) => (typeof v === "number" && v > -900 ? v : null);

// NWPS floodCategory -> display label. Order low→high for context math.
export const WATER_CAT_ORDER = ["no_flooding", "action", "minor", "moderate", "major"];
export function waterCatLabel(cat, lang) {
  return (
    {
      no_flooding: T(lang, "Normal", "Normal"),
      action: T(lang, "Action stage", "Etapa de acción"),
      minor: T(lang, "Minor flooding", "Inundación menor"),
      moderate: T(lang, "Moderate flooding", "Inundación moderada"),
      major: T(lang, "Major flooding", "Inundación mayor"),
    }[cat] || T(lang, "Level unavailable", "Nivel no disponible")
  );
}
export const waterCatClass = (cat) =>
  ({ no_flooding: "w-normal", action: "w-action", minor: "w-minor", moderate: "w-moderate", major: "w-major" }[cat] || "w-unknown");
// Only real NWS flood categories count as "elevated" for the top status panel.
export const WATER_FLOOD_CATS = ["action", "minor", "moderate", "major"];
// Display state per gauge: a real NWS flood category (colored), a neutral
// "monitored" level when the gauge reports a stage but NWS defines no flood
// categories for it (e.g. the Lake Houston reservoir gauge, category
// "not_defined"), or "unavailable" when the gauge is offline. Never invents a
// classification NWS didn't publish.
export function waterState(g, lang) {
  if (g.stage == null) return { cls: "w-unknown", label: T(lang, "Unavailable", "No disponible") };
  if (g.category === "no_flooding" || WATER_FLOOD_CATS.includes(g.category))
    return { cls: waterCatClass(g.category), label: waterCatLabel(g.category, lang) };
  return { cls: "w-monitored", label: T(lang, "Monitored", "Monitoreado") };
}

// The flood-category badge and card edge, shared by /water and the gauge
// pages so a category reads the same colour everywhere. Every badge fill
// carries white text; scripts/test-contrast.mjs measures these rules here.
export const WATER_STATE_CSS = `
  .gauge-badge { flex:none; font-size:0.9rem; font-weight:600; white-space:nowrap; }
  .gauge-badge::before { content:""; display:inline-block; width:0.62em; height:0.62em; margin-right:0.45em; background:var(--mark,var(--quiet)); }
  .w-normal { --mark:var(--ok); } .w-action { --mark:var(--warn); } .w-minor { --mark:var(--hot); } .w-moderate { --mark:var(--bad); } .w-major { --mark:var(--severe); } .w-monitored { --mark:var(--info); }
`;

// Fetch each gauge once and return both what the pages need now and what the
// record keeps. Per-gauge try/catch so one bad gauge never sinks the batch;
// throw only if EVERY gauge failed, so the cron aborts-without-writing on a
// total NWPS outage and the last snapshot survives.
//
//   snapshot  { updated, gauges }  — the KV value behind /water.
//   history   [{ lid, name, usgsId, crests, impacts }] — NOAA's historic crests
//             and flood-impact statements, which arrive in the same response.
//             They go to D1 (src/record.js), never to KV: they change a few
//             times a decade and would triple the snapshot.
export async function fetchWaterFull() {
  const results = await Promise.all(
    WATER_GAUGES.map(async (g) => {
      try {
        const res = await fetch(`https://api.water.noaa.gov/nwps/v1/gauges/${g.lid}`, {
          headers: { "User-Agent": "crosbynews.com", Accept: "application/json" },
        });
        if (!res.ok) return null;
        const d = await res.json();
        const obs = d.status?.observed ?? {};
        const cats = d.flood?.categories ?? {};
        const thresholds = {};
        for (const k of ["action", "minor", "moderate", "major"]) {
          const s = waterNum(cats[k]?.stage);
          if (s != null) thresholds[k] = s;
        }
        return {
          gauge: {
            lid: g.lid,
            name: d.name || g.en,
            usgsId: d.usgsId || null,
            stage: waterNum(obs.primary),
            stageUnit: obs.primaryUnit || "ft",
            flow: g.noFlow ? null : waterNum(obs.secondary), // kcfs
            category: obs.floodCategory || "unknown",
            validTime: obs.validTime || null,
            thresholds,
          },
          history: {
            lid: g.lid,
            name: d.name || g.en,
            usgsId: d.usgsId || null,
            crests: Array.isArray(d.flood?.crests?.historic) ? d.flood.crests.historic : [],
            impacts: Array.isArray(d.flood?.impacts) ? d.flood.impacts : [],
          },
        };
      } catch {
        return null;
      }
    })
  );
  const ok = results.filter(Boolean);
  if (!ok.length) throw new Error("NWPS: all gauge fetches failed");
  return {
    snapshot: { updated: new Date().toISOString(), gauges: ok.map((r) => r.gauge) },
    history: ok.map((r) => r.history),
  };
}

// USGS annual peaks for one site: the highest flow and gauge height of each
// water year, as USGS publishes them in its peaks collection. Flow (00060) and
// height (00065) arrive as separate rows sharing a date; a peak USGS dates
// only to the month or year cannot be matched to a crest and is skipped.
export async function fetchUsgsPeaks(env, usgsId) {
  const res = await fetchUsgsOgc(`https://api.waterdata.usgs.gov/ogcapi/v0/collections/peaks/items?monitoring_location_id=USGS-${encodeURIComponent(usgsId)}&f=json&limit=1000`, env);
  const byDay = new Map();
  for (const f of (await res.json()).features || []) {
    const p = f?.properties || {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.time || "") || !Number.isFinite(Number(p.water_year))) continue;
    const v = p.value === null || p.value === "" || p.value === undefined ? null : Number(p.value);
    if (v !== null && !Number.isFinite(v)) continue;
    const row = byDay.get(p.time) || { day: p.time, waterYear: Number(p.water_year), flow: null, stage: null, flowQualifier: null, stageQualifier: null };
    const q = Array.isArray(p.qualifier) && p.qualifier.length ? JSON.stringify(p.qualifier) : null;
    if (p.parameter_code === "00060") Object.assign(row, { flow: v, flowQualifier: q });
    else if (p.parameter_code === "00065") Object.assign(row, { stage: v, stageQualifier: q });
    else continue;
    byDay.set(p.time, row);
  }
  return [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : 1));
}

// The snapshot alone, for the cold-cache path.
export async function fetchWater() {
  return (await fetchWaterFull()).snapshot;
}

// Read the cached water levels, self-healing on a cold/malformed entry (the
// cron keeps it fresh; this mirrors loadCalendar).
export async function loadWater(env) {
  let data = null;
  try {
    data = await env.WEATHER.get(WATER_KV_KEY, "json");
  } catch (e) {
    console.error("KV water parse failed:", e && e.stack);
  }
  if (!data || !Array.isArray(data.gauges)) {
    try {
      data = await fetchWater();
      await env.WEATHER.put(WATER_KV_KEY, JSON.stringify(data));
    } catch (e) {
      console.error("water cold fetch failed:", e && e.stack);
      data = { updated: null, gauges: [] };
    }
  }
  return data;
}

// Discharge for display: NWPS gives kcfs; cfs reads better for these waters.
export const waterFlowCfs = (flowKcfs) => (flowKcfs == null ? null : Math.round(flowKcfs * 1000));

// A short, safe context line. Only the reassuring "below action" headroom in
// the normal case (action defined + stage below it); flooding states let the
// badge speak for itself rather than compute anything fragile.
export function waterContext(g, lang) {
  if (g.stage == null) return T(lang, "Reading temporarily unavailable", "Lectura no disponible temporalmente");
  const action = g.thresholds.action;
  if (g.category === "no_flooding" && typeof action === "number" && g.stage < action) {
    return T(
      lang,
      `${(action - g.stage).toFixed(1)} ft below action stage`,
      `${(action - g.stage).toFixed(1)} ft por debajo de la etapa de acción`
    );
  }
  return "";
}

export function waterThresholdLine(g, lang) {
  const parts = [];
  for (const k of ["action", "minor", "moderate", "major"]) {
    if (typeof g.thresholds[k] === "number") parts.push(`${waterCatLabel(k, lang)} ${g.thresholds[k]} ft`);
  }
  return parts.join(" &middot; ");
}

export function waterHtml(data, lang) {
  const gauges = data.gauges ?? [];
  const anyFlooding = gauges.some((g) => WATER_FLOOD_CATS.includes(g.category));
  const cards = gauges
    .map((g) => {
      const cfs = waterFlowCfs(g.flow);
      const ctx = waterContext(g, lang);
      const th = waterThresholdLine(g, lang);
      const st = waterState(g, lang);
      const page = gaugePagePath(g.lid);
      return `      <article class="gauge ${st.cls}">
        <div class="gauge-head">
          <h2><a href="${nwpsGaugeUrl(g.lid)}" target="_blank" rel="noopener">${esc(T(lang, g.name, (WATER_GAUGES.find((x) => x.lid === g.lid) || {}).es || g.name))}</a></h2>
          <span class="gauge-badge" data-nosnippet>${esc(st.label)}</span>
        </div>
        <div data-nosnippet>
        <p class="gauge-stage">${g.stage != null ? `${esc(g.stage)}<span class="u"> ft</span>` : "&ndash;"}${cfs != null ? ` <span class="gauge-flow">&middot; ${esc(cfs.toLocaleString(lang === "es" ? "es-MX" : "en-US"))} ${T(lang, "cfs", "pie³/s")}</span>` : ""}</p>
        <p class="gauge-meta">${ctx ? `${esc(ctx)} &middot; ` : ""}${g.validTime ? `${T(lang, "as of", "a las")} ${timeTag(g.validTime, `${clockTime(g.validTime, lang)} CT`)}` : ""}</p>
        </div>
        ${th ? `<p class="gauge-th">${th}</p>` : ""}
        ${page ? `<p class="gauge-more"><a href="${lang === "es" ? esPath(page) : page}">${T(lang, "Past floods at this gauge", "Inundaciones pasadas en este medidor")}</a></p>` : ""}
      </article>`;
    })
    .join("\n");

  const title = T(lang, "Crosby, TX Water Levels", "Niveles de agua de Crosby, TX");
  const desc = T(
    lang,
    "River and bayou levels with National Weather Service flood stages for Crosby, TX: Cedar Bayou, the San Jacinto River, Luce Bayou and more.",
    "Niveles de ríos y arroyos con las etapas de inundación del Servicio Meteorológico Nacional para Crosby, TX: Cedar Bayou, el río San Jacinto y más."
  );
  const status = gauges.length
    ? anyFlooding
      ? `<div class="status status-alert" role="status"><div><p class="status-title">${T(lang, "Water is high", "El agua está alta")}</p><p class="status-sub">${T(lang, "At least one gauge is at or above flood stage. The readings are below.", "Al menos un medidor está en etapa de inundación o por encima. Las lecturas están abajo.")}</p></div></div>`
      : `<div class="status status-ok" role="status"><div><p class="status-title">${T(lang, "All gauges are normal", "Todos los medidores están normales")}</p><p class="status-sub">${T(lang, "None of the gauges near Crosby is at flood stage. Readings are refreshed every 15 minutes.", "Ninguno de los medidores cerca de Crosby está en etapa de inundación. Las lecturas se actualizan cada 15 minutos.")}</p></div></div>`
    : `<p class="none">${T(lang, "Water level data is temporarily unavailable.", "Los datos de nivel de agua no están disponibles temporalmente.")}</p>`;

  return `<!DOCTYPE html>
<html lang="${T(lang, "en", "es-MX")}">
<head>
<meta charset="utf-8">
<title>${esc(title)} &mdash; crosbynews.com</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${T(lang, "Live river and bayou levels with NWS flood stages for the Crosby, TX area.", "Niveles de ríos y arroyos en vivo con las etapas de inundación del NWS para la zona de Crosby, TX.")}">
<meta property="og:type" content="website">
<meta property="og:url" content="${canonicalFor("/water", lang)}">
${sharedHead(lang)}
<link rel="canonical" href="${canonicalFor("/water", lang)}">
${hreflangTags("/water")}
${JSONLD_SITE}
<style>${BASE_CSS}
  .gauges { columns:2 20rem; column-gap:2.5rem; margin-top:1.2rem; }
  .gauge { break-inside:avoid; padding:0.8rem 0 0.9rem 0.9rem; border-left:4px solid var(--mark,var(--quiet)); margin-bottom:1.1rem; }
  .gauge-head { display:flex; justify-content:space-between; align-items:baseline; gap:0.8rem; }
  .gauge-head h2 { margin:0; padding:0; border:0; font-size:1.1rem; }
  .gauge-head a { color:var(--ink); }
  .gauge-stage { margin:0.35rem 0 0; font-family:var(--serif); font-size:2.2rem; font-weight:700; line-height:1; }
  .gauge-stage .u, .gauge-flow { font-family:system-ui,sans-serif; font-size:0.95rem; font-weight:400; color:var(--muted); }
  .gauge-meta, .gauge-th { margin:0.3rem 0 0; font-size:0.9rem; color:var(--muted); }
  .gauge-more { margin:0.4rem 0 0; font-size:0.95rem; }
${WATER_STATE_CSS}
  .safety { margin-top:1.4rem; }
</style>
</head>
<body>
${topbar("/water", lang)}
<main id="main">
  <h1>${esc(title)}</h1>
  <p class="intro">${T(lang, "How high the water is on the rivers and bayous that flood Crosby and northeast Harris County, next to the stage at which the National Weather Service says each one floods. The reading and the flood stages come from the same gauge, so the two can be compared directly.", "Qué tan alta está el agua en los ríos y arroyos que inundan Crosby y el noreste del condado de Harris, junto a la etapa en la que el Servicio Meteorológico Nacional dice que cada uno se inunda. La lectura y las etapas de inundación vienen del mismo medidor, así que se pueden comparar directamente.")}${data.updated ? ` ${T(lang, "Updated", "Actualizado")} ${dateStamp(data.updated, lang)}.` : ""}</p>
  <div data-nosnippet>${status}</div>
  <div class="gauges">
${cards}
  </div>
  <p class="safety">${T(lang, "In a flood emergency, call 911. Never drive or walk into floodwater. These numbers are copied from the National Weather Service. Each gauge's name links to its official page, and flood warnings are on the <a href=\"/alerts\">alerts page</a>.", "En una emergencia por inundación, llama al 911. Nunca manejes ni camines hacia el agua de una inundación. Estos números se copian del Servicio Meteorológico Nacional. El nombre de cada medidor enlaza a su página oficial, y los avisos de inundación están en la <a href=\"/es/alerts\">página de alertas</a>.")}</p>
  <p>${T(lang, "Related:", "Relacionado:")} <a href="${lang === "es" ? "/es/rain" : "/rain"}">${T(lang, "measured rain", "lluvia medida")}</a>, <a href="${lang === "es" ? "/es/radar" : "/radar"}">${T(lang, "radar", "radar")}</a>, <a href="${lang === "es" ? "/es/weather" : "/weather"}">${T(lang, "forecast", "pronóstico")}</a>.</p>
</main>
${footer({ page: "/water", lang, source: T(lang, `Water data from the NOAA/NWS <a href="https://water.noaa.gov">National Water Prediction Service</a>.`, `Datos de agua del <a href="https://water.noaa.gov">Servicio Nacional de Predicción de Agua</a> de NOAA/NWS.`) })}
</body>
</html>`;
}

export function waterMarkdown(data, lang) {
  const gauges = data.gauges ?? [];
  const out = [
    `# ${T(lang, "Crosby, TX Water Levels", "Niveles de agua de Crosby, TX")}`,
    "",
    `_${T(lang, "Live river and bayou levels with NWS flood stages for the Crosby, TX area.", "Niveles de ríos y arroyos en vivo con las etapas de inundación del NWS para la zona de Crosby, TX.")}${data.updated ? ` ${T(lang, "Updated", "Actualizado")} ${fullTime(data.updated, lang)} CT.` : ""}_`,
    "",
  ];
  if (gauges.length) {
    for (const g of gauges) {
      const cfs = waterFlowCfs(g.flow);
      out.push(`## ${T(lang, g.name, (WATER_GAUGES.find((x) => x.lid === g.lid) || {}).es || g.name)}`);
      out.push(
        `- **${waterState(g, lang).label}**${g.stage != null ? ` — ${g.stage} ft` : ""}${cfs != null ? `, ${cfs.toLocaleString(lang === "es" ? "es-MX" : "en-US")} ${T(lang, "cfs", "pie³/s")}` : ""}${g.validTime ? ` (${T(lang, "as of", "a las")} ${clockTime(g.validTime, lang)} CT)` : ""}`
      );
      const th = ["action", "minor", "moderate", "major"]
        .filter((k) => typeof g.thresholds[k] === "number")
        .map((k) => `${waterCatLabel(k, lang)} ${g.thresholds[k]} ft`)
        .join(", ");
      if (th) out.push(`- ${T(lang, "Flood stages", "Etapas de inundación")}: ${th}`);
      const page = gaugePagePath(g.lid);
      if (page) out.push(`- ${T(lang, "Flood history", "Historial de inundaciones")}: ${canonicalFor(page, lang)}`);
      out.push(`- ${T(lang, "Official gauge", "Medidor oficial")}: ${nwpsGaugeUrl(g.lid)}`, "");
    }
  } else {
    out.push(T(lang, "Water level data is temporarily unavailable.", "Los datos de nivel de agua no están disponibles temporalmente."));
  }
  out.push(
    "---",
    `${T(lang, "In a flood emergency call 911. Never drive into floodwater.", "En una emergencia por inundación llama al 911. Nunca conduzcas hacia el agua de inundación.")} ${T(lang, "Data from the NOAA/NWS National Water Prediction Service.", "Datos del Servicio Nacional de Predicción de Agua de NOAA/NWS.")} · [crosbynews.com](${canonicalFor("/", lang)})`
  );
  return out.join("\n");
}

// JSON shape served at /api/water — the same NWPS data behind /water.
export function apiWater(data) {
  return {
    location: "Crosby, TX area (northeast Harris County / San Jacinto corridor)",
    source: "NOAA/NWS National Water Prediction Service (water.noaa.gov)",
    updated: data.updated ?? null,
    gauges: (data.gauges ?? []).map((g) => ({
      id: g.lid,
      name: g.name,
      usgsId: g.usgsId,
      stage: g.stage,
      stageUnit: g.stageUnit || "ft",
      flow: waterFlowCfs(g.flow),
      flowUnit: "cfs",
      category: g.category,
      validTime: g.validTime,
      thresholds: g.thresholds,
      thresholdUnit: "ft",
      officialUrl: nwpsGaugeUrl(g.lid),
    })),
  };
}
