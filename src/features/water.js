// River and bayou flood gauges from NOAA/NWS NWPS — the waters that flood
// Crosby and NE Harris County.
//
// The badge is NWPS's own floodCategory; we never invent a classification.
// -9999 (undefined threshold) and -999 (no forecast) are NWPS sentinels,
// filtered by waterNum() so they never render as numbers.

import { T, canonicalFor, hreflangTags } from "../i18n.js";
import { esc, fullTime, clockTime } from "../lib/format.js";
import { BASE_CSS } from "../assets/base-css.js";
import { topbar, footer } from "../chrome.js";
import { JSONLD_SITE, OG_COMMON } from "../seo.js";

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
  { lid: "SHLT2", en: "San Jacinto River near Sheldon", es: "Río San Jacinto cerca de Sheldon" },
  { lid: "HSJT2", en: "San Jacinto River at Lake Houston", es: "Río San Jacinto en Lake Houston" },
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

// Fetch each gauge, extract a compact record. Per-gauge try/catch so one bad
// gauge never sinks the batch; throw only if EVERY gauge failed, so the cron
// aborts-without-writing on a total NWPS outage and the last snapshot survives.
export async function fetchWater() {
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
          lid: g.lid,
          name: d.name || g.en,
          usgsId: d.usgsId || null,
          stage: waterNum(obs.primary),
          stageUnit: obs.primaryUnit || "ft",
          flow: waterNum(obs.secondary), // kcfs
          category: obs.floodCategory || "unknown",
          validTime: obs.validTime || null,
          thresholds,
        };
      } catch {
        return null;
      }
    })
  );
  const gauges = results.filter(Boolean);
  if (!gauges.length) throw new Error("NWPS: all gauge fetches failed");
  return { updated: new Date().toISOString(), gauges };
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
      return `      <article class="gauge ${st.cls}">
        <div class="gauge-head">
          <h2><a href="${nwpsGaugeUrl(g.lid)}" target="_blank" rel="noopener">${esc(T(lang, g.name, (WATER_GAUGES.find((x) => x.lid === g.lid) || {}).es || g.name))}</a></h2>
          <span class="gauge-badge">${esc(st.label)}</span>
        </div>
        <p class="gauge-stage">${g.stage != null ? `${esc(g.stage)}<span class="u"> ft</span>` : "&ndash;"}${cfs != null ? ` <span class="gauge-flow">&middot; ${esc(cfs.toLocaleString(lang === "es" ? "es-MX" : "en-US"))} ${T(lang, "cfs", "pie³/s")}</span>` : ""}</p>
        <p class="gauge-meta">${ctx ? `${esc(ctx)} &middot; ` : ""}${g.validTime ? `${T(lang, "as of", "a las")} ${esc(clockTime(g.validTime, lang))} CT` : ""}</p>
        ${th ? `<p class="gauge-th">${th}</p>` : ""}
      </article>`;
    })
    .join("\n");

  const title = T(lang, "Crosby, TX Water Levels", "Niveles de agua de Crosby, TX");
  const desc = T(
    lang,
    "Live river and bayou levels with National Weather Service flood stages for Crosby, TX and the northeast Harris County / San Jacinto corridor — Cedar Bayou, the San Jacinto River, Luce Bayou and more.",
    "Niveles de ríos y arroyos en vivo con las etapas de inundación del Servicio Meteorológico Nacional para Crosby, TX y el corredor del noreste del condado de Harris / San Jacinto: Cedar Bayou, el río San Jacinto, Luce Bayou y más."
  );
  const status = gauges.length
    ? anyFlooding
      ? `<div class="status status-alert" role="status"><span class="status-icon">&#9888;</span><div><p class="status-title">${T(lang, "Elevated water levels", "Niveles de agua elevados")}</p><p class="status-sub">${T(lang, "One or more gauges are at or above flood stage &mdash; see below and follow official guidance.", "Uno o más medidores están en etapa de inundación o por encima &mdash; ver abajo y seguir la guía oficial.")}</p></div></div>`
      : `<div class="status status-ok" role="status"><span class="status-icon">&#10004;</span><div><p class="status-title">${T(lang, "All gauges normal", "Todos los medidores normales")}</p><p class="status-sub">${T(lang, "No area gauges are at flood stage right now. Levels refresh every 15 minutes.", "Ningún medidor del área está en etapa de inundación ahora. Los niveles se actualizan cada 15 minutos.")}</p></div></div>`
    : `<p class="none">${T(lang, "Water level data is temporarily unavailable.", "Los datos de nivel de agua no están disponibles temporalmente.")}</p>`;

  return `<!DOCTYPE html>
<html lang="${T(lang, "en", "es-MX")}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} &mdash; crosbynews.com</title>
<meta name="description" content="${esc(desc)}">
<meta name="theme-color" content="#0b3d61">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${T(lang, "Live river and bayou levels with NWS flood stages for the Crosby, TX area.", "Niveles de ríos y arroyos en vivo con las etapas de inundación del NWS para la zona de Crosby, TX.")}">
<meta property="og:type" content="website">
<meta property="og:url" content="${canonicalFor("/water", lang)}">
${OG_COMMON}
<link rel="canonical" href="${canonicalFor("/water", lang)}">
${hreflangTags("/water")}
${JSONLD_SITE}
<link rel="manifest" href="/manifest.json">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="alternate icon" href="/favicon.ico">
<style>${BASE_CSS}
  .status { display:flex; align-items:center; gap:1rem; border-radius:16px; padding:1.2rem 1.4rem; margin-top:0.8rem; color:#fff; }
  .status-icon { font-size:2.4rem; line-height:1; flex:none; }
  .status-title { margin:0; font-size:1.5rem; font-weight:800; line-height:1.1; }
  .status-sub { margin:0.35rem 0 0; font-size:0.98rem; opacity:0.95; }
  .status-ok { background:linear-gradient(135deg,#1f8b4c,#2eb86a); }
  .status-alert { background:linear-gradient(135deg,#a3271b,#d44230); }
  .gauges { display:grid; gap:0.7rem; grid-template-columns:repeat(auto-fill,minmax(260px,1fr)); margin-top:1rem; }
  .gauge { background:var(--card); border-radius:12px; padding:0.85rem 1rem; box-shadow:0 1px 3px rgba(0,0,0,0.07); border-left:5px solid var(--muted); }
  .gauge-head { display:flex; justify-content:space-between; align-items:flex-start; gap:0.5rem; }
  .gauge-head h2 { margin:0; font-size:1rem; }
  .gauge-head a { color:var(--ink); text-decoration:none; }
  .gauge-head a:hover { text-decoration:underline; }
  .gauge-badge { flex:none; font-size:0.72rem; font-weight:700; text-transform:uppercase; letter-spacing:0.03em; padding:0.15rem 0.5rem; border-radius:999px; color:#fff; background:var(--muted); white-space:nowrap; }
  .gauge-stage { margin:0.5rem 0 0; font-size:1.9rem; font-weight:800; line-height:1; }
  .gauge-stage .u { font-size:0.9rem; font-weight:600; opacity:0.7; }
  .gauge-flow { font-size:0.85rem; font-weight:600; color:var(--muted); }
  .gauge-meta { margin:0.3rem 0 0; font-size:0.82rem; color:var(--muted); }
  .gauge-th { margin:0.4rem 0 0; font-size:0.78rem; color:var(--muted); }
  .w-normal { border-left-color:#2eb86a; } .w-normal .gauge-badge { background:#1f8b4c; }
  .w-action { border-left-color:#e0a800; } .w-action .gauge-badge { background:#b8860b; }
  .w-minor { border-left-color:#e8720c; } .w-minor .gauge-badge { background:#c85a08; }
  .w-moderate { border-left-color:#d44230; } .w-moderate .gauge-badge { background:#b5301f; }
  .w-major { border-left-color:#8e2ec2; } .w-major .gauge-badge { background:#6f1fa0; }
  .w-monitored { border-left-color:var(--accent); } .w-monitored .gauge-badge { background:var(--accent); }
  .intro { color:var(--muted); margin:0.6rem 0 0; }
  .safety { margin-top:1.4rem; font-size:0.85rem; color:var(--muted); border-top:1px solid var(--line); padding-top:0.8rem; }
</style>
</head>
<body>
${topbar("/water", lang)}
<main id="main">
  <h1>${esc(title)}</h1>
  <p class="intro">${T(lang, "Current water levels for the rivers and bayous that flood Crosby and northeast Harris County, with each gauge's National Weather Service flood stages. Readings and flood stages both come from the same NWS gauge, so they're directly comparable.", "Niveles de agua actuales de los ríos y arroyos que inundan Crosby y el noreste del condado de Harris, con las etapas de inundación del Servicio Meteorológico Nacional de cada medidor. Las lecturas y las etapas de inundación provienen del mismo medidor del NWS, por lo que son directamente comparables.")}${data.updated ? ` ${T(lang, "Updated", "Actualizado")} ${esc(fullTime(data.updated, lang))} CT.` : ""}</p>
  ${status}
  <div class="gauges">
${cards}
  </div>
  <p class="safety">${T(lang, "In a flood emergency call 911. Never drive or walk into floodwater &mdash; turn around, don't drown. This page mirrors official NWS data for convenience; the authoritative source for each gauge is linked in its title, and warnings appear on the <a href=\"/alerts\">alerts page</a>.", "En una emergencia por inundación llama al 911. Nunca conduzcas ni camines hacia el agua de inundación &mdash; da la vuelta, no te arriesgues. Esta página refleja datos oficiales del NWS por comodidad; la fuente autorizada de cada medidor está enlazada en su título, y los avisos aparecen en la <a href=\"/es/alerts\">página de alertas</a>.")}</p>
  <p class="intro"><a href="${lang === "es" ? "/es/weather" : "/weather"}">&larr; ${T(lang, "Back to the forecast", "Volver al pronóstico")}</a> &middot; <a href="${lang === "es" ? "/es/radar" : "/radar"}">Radar</a></p>
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
