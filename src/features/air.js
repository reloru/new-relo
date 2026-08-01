// Air quality and UV — the vertical slice: upstream fetch, derived helpers,
// the /air page, and the JSON shape, together.
//
// Neither number comes from NWS. UV is the EPA's hourly forecast for Crosby's
// ZIP; AQI is measured from EPA/AirNow monitors with an Open-Meteo modeled
// fallback. Both are folded into the `weather` KV entry by fetchWeather()
// rather than getting their own keys, and both are labeled by source wherever
// they appear.

import { LAT, LON, SITE, TZ } from "../config.js";
import { T, canonicalFor, hreflangTags } from "../i18n.js";
import { esc, capFirst, dayLabel, fullTime, fmt } from "../lib/format.js";
import { BASE_CSS } from "../assets/base-css.js";
import { topbar, footer } from "../chrome.js";
import { JSONLD_SITE, OG_COMMON } from "../seo.js";

// UV index — the EPA's hourly UV forecast for Crosby's ZIP (Envirofacts, no
// API key; Worker reachability canary-verified before shipping, like NHC).
// The one weather number on the site sourced from EPA rather than NWS. EPA
// publishes DATE_TIME in the ZIP's LOCAL wall-clock time (Central here) and
// the product only covers roughly 6 AM–8 PM — and its row list can wrap into
// the previous day's evening hours, so consumers always filter by CT date.
export const UV_ZIP = "77532"; // Crosby
export const UV_MONTHS = { JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06", JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12" };
export async function fetchUv() {
  const res = await fetch(`https://data.epa.gov/efservice/getEnvirofactsUVHOURLY/ZIP/${UV_ZIP}/JSON`, {
    headers: { "User-Agent": "crosbynews.com", Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`EPA UV request failed: ${res.status}`);
  const rows = await res.json();
  const hourly = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    // DATE_TIME like "Jul/04/2026 01 PM" (local Central wall time).
    const m = /^([A-Za-z]{3})\/(\d{2})\/(\d{4})\s+(\d{1,2})\s+(AM|PM)$/.exec(String(r.DATE_TIME || "").trim());
    const mon = m && UV_MONTHS[m[1].toUpperCase()];
    if (!mon) continue;
    let hour = Number(m[4]) % 12;
    if (m[5].toUpperCase() === "PM") hour += 12;
    hourly.push({ date: `${m[3]}-${mon}-${m[2]}`, hour, value: Number(r.UV_VALUE) || 0 });
  }
  if (!hourly.length) throw new Error("EPA UV: no parseable rows");
  return { hourly };
}

// Current-hour and peak-of-today UV from the stored entries, matched on the
// CT wall clock (the convention EPA publishes in). Null-safe: cache entries
// written before this feature have no `uv`, and hours outside the product's
// window simply don't match.
export const ctDateStr = (ms) => new Date(ms).toLocaleDateString("en-CA", { timeZone: TZ });
export function uvCurrent(data) {
  const entries = data?.uv?.hourly;
  if (!Array.isArray(entries)) return null;
  const now = Date.now();
  const date = ctDateStr(now);
  const hour = Number(new Date(now).toLocaleString("en-US", { timeZone: TZ, hour: "2-digit", hour12: false })) % 24;
  const hit = entries.find((e) => e.date === date && e.hour === hour);
  return hit ? hit.value : null;
}
export function uvPeakToday(data) {
  const entries = data?.uv?.hourly;
  if (!Array.isArray(entries)) return null;
  const date = ctDateStr(Date.now());
  const today = entries.filter((e) => e.date === date);
  return today.length ? Math.max(...today.map((e) => e.value)) : null;
}
// EPA/WHO UV index categories.
export function uvCategory(v, lang = "en") {
  if (v == null) return null;
  if (v >= 11) return T(lang, "Extreme", "Extremo");
  if (v >= 8) return T(lang, "Very High", "Muy alto");
  if (v >= 6) return T(lang, "High", "Alto");
  if (v >= 3) return T(lang, "Moderate", "Moderado");
  return T(lang, "Low", "Bajo");
}

// Air quality (US AQI). Two sources, in preference order:
//   1. AirNow (EPA/AirNow official MEASURED monitors) — the current observation
//      for the "Houston-Galveston-Brazoria" reporting area, the nearest official
//      area, which includes Crosby. A real monitor reading, not a model. Needs
//      the AIRNOW_API_KEY Worker secret; Worker reachability to airnowapi.org was
//      canary-verified from the deployed runtime before shipping.
//   2. Open-Meteo — a MODELED US AQI for Crosby's exact coordinates (CAMS-based,
//      no key). The fallback when AirNow is unavailable, the key is unset, or the
//      monitors report nothing (e.g. a station outage). Labeled "modeled".
// Either way it's a REGIONAL/estimated value (no EPA monitor sits in Crosby
// itself), so the source and its nature are labeled honestly everywhere it
// appears — measured metro-area vs modeled local. Folded into the `weather` KV
// entry as `aqi:{...}`, failure-tolerant (aqi:null on any error) so it can never
// block the NWS refresh. Unlike UV, AQI is meaningful day and night.
//
// Canonical pollutant tokens → bilingual labels, shared by both sources.
export const AQI_POLLUTANTS = {
  pm25: ["PM2.5", "PM2.5"],
  pm10: ["PM10", "PM10"],
  ozone: ["ozone", "ozono"],
  no2: ["nitrogen dioxide", "dióxido de nitrógeno"],
  so2: ["sulfur dioxide", "dióxido de azufre"],
  co: ["carbon monoxide", "monóxido de carbono"],
};
// Open-Meteo sub-AQI field → canonical token.
export const OPENMETEO_AQI_FIELDS = {
  us_aqi_pm2_5: "pm25",
  us_aqi_pm10: "pm10",
  us_aqi_ozone: "ozone",
  us_aqi_nitrogen_dioxide: "no2",
  us_aqi_sulphur_dioxide: "so2",
  us_aqi_carbon_monoxide: "co",
};
// AirNow parameterName → canonical token (the ziplatlong endpoint uses "OZONE";
// the legacy one used "O3" — accept both).
export const AIRNOW_PARAM = { OZONE: "ozone", O3: "ozone", "PM2.5": "pm25", PM10: "pm10", NO2: "no2", SO2: "so2", CO: "co" };

export async function fetchAqi(env) {
  if (env?.AIRNOW_API_KEY) {
    try {
      return await fetchAqiAirNow(env.AIRNOW_API_KEY);
    } catch (e) {
      console.error("AirNow AQI failed, falling back to Open-Meteo:", e && e.message);
    }
  }
  return await fetchAqiOpenMeteo();
}

// AirNow current observations for the area covering Crosby, via the NowCast
// endpoint that returns the CLOSEST reporting monitor for each pollutant (per
// AirNow) — so we can name the real nearby TCEQ monitors instead of a vague
// "metro" tag. Overall US AQI is the max of the pollutant NowCast sub-indices;
// the pollutant at that max is the dominant one (EPA's definition). Only the
// NowCast AQI per pollutant is available (not raw concentrations), so
// `subIndices` carries them and the raw pm/ozone fields stay null on this path.
// `sites` maps each pollutant token to the monitor site name that reported it.
//
// Endpoint: /aq/observation/current/ziplatlong/ — the June-2026 replacement for
// the legacy /aq/observation/latLong/current/, which AirNow RETIRES 2026-09-30
// (see the AirNow API Updates June 2026 notice). Same host (airnowapi.org),
// already Worker-egress-canaried; Open-Meteo remains the fallback.
export async function fetchAqiAirNow(key) {
  const res = await fetch(
    `https://www.airnowapi.org/aq/observation/current/ziplatlong/?format=application/json&latitude=${LAT}&longitude=${LON}&distance=50&API_KEY=${key}`,
    { headers: { "User-Agent": "crosbynews.com", Accept: "application/json" } }
  );
  if (!res.ok) throw new Error(`AirNow request failed: ${res.status}`);
  const rows = await res.json();
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("AirNow returned no observations");
  let usAqi = -1, dominant = null, reportingArea = null, observed = null, agency = null;
  const subIndices = {}, sites = {};
  for (const r of rows) {
    const tok = AIRNOW_PARAM[r.parameterName];
    const v = typeof r.nowcastAQI === "number" ? r.nowcastAQI : null;
    if (tok && v != null) {
      subIndices[tok] = v;
      if (r.siteName) sites[tok] = r.siteName;
      if (v > usAqi) { usAqi = v; dominant = tok; }
    }
    if (!reportingArea && r.reportingAreaName) reportingArea = `${r.reportingAreaName}${/,/.test(r.reportingAreaName) ? "" : ", TX"}`;
    if (!agency && r.reportingAgency) agency = r.reportingAgency;
    if (!observed && r.dateObserved) {
      observed = `${String(r.dateObserved).trim()}${r.hourObserved ? ` ${r.hourObserved}` : ""} ${r.localTimeZone || "CT"}`.trim();
    }
  }
  if (usAqi < 0) throw new Error("AirNow: no usable AQI value");
  return {
    usAqi,
    dominant,
    subIndices,
    sites,
    dominantSite: dominant ? sites[dominant] || null : null,
    agency,
    pm25: null, pm10: null, ozone: null, // raw concentrations unavailable from AirNow
    source: "airnow",
    measured: true,
    reportingArea,
    observed,
    time: new Date().toISOString(),
  };
}

// Open-Meteo modeled US AQI for Crosby's coordinates — the fallback.
export async function fetchAqiOpenMeteo() {
  const fields = ["us_aqi", ...Object.keys(OPENMETEO_AQI_FIELDS), "pm2_5", "pm10", "ozone"].join(",");
  const res = await fetch(
    `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${LAT}&longitude=${LON}&current=${fields}&timezone=America%2FChicago`,
    { headers: { "User-Agent": "crosbynews.com", Accept: "application/json" } }
  );
  if (!res.ok) throw new Error(`Open-Meteo AQI request failed: ${res.status}`);
  const j = await res.json();
  const c = j.current || {};
  const usAqi = typeof c.us_aqi === "number" ? Math.round(c.us_aqi) : null;
  if (usAqi == null) throw new Error("Open-Meteo AQI: no us_aqi value");
  // Dominant pollutant = the component whose sub-AQI drives the overall (the
  // max component AQI; overall US AQI is the max of the components).
  let dominant = null, best = -1;
  const subIndices = {};
  for (const [field, tok] of Object.entries(OPENMETEO_AQI_FIELDS)) {
    const v = c[field];
    if (typeof v === "number") {
      subIndices[tok] = Math.round(v);
      if (v > best) { best = v; dominant = tok; }
    }
  }
  return {
    usAqi,
    dominant, // canonical token, mapped to a label at render time
    subIndices,
    pm25: typeof c.pm2_5 === "number" ? c.pm2_5 : null,
    pm10: typeof c.pm10 === "number" ? c.pm10 : null,
    ozone: typeof c.ozone === "number" ? c.ozone : null,
    source: "openmeteo",
    measured: false,
    reportingArea: null,
    observed: null,
    time: c.time || null,
  };
}

// --- Nearest dedicated ozone monitor (cross-reference) -----------------------
// The headline AQI names the CLOSEST reporting monitor per pollutant, so a
// locally elevated reading at a slightly-farther monitor could hide behind it.
// Channelview C15 is the nearest dedicated ozone monitor to Crosby (~8.5 mi;
// Baytown Garth, ~7.7 mi, is marginally closer and usually drives the headline
// ozone), so we surface it as a cross-check. Source: AirNow "observations by
// monitoring site" (/aq/data/ — hourly, bounding box; an ACTIVE service, NOT one
// of the by-zip/lat-long endpoints AirNow retires in fall 2026). Ozone only (PM
// is already covered by the headline monitors). Failure-tolerant: any error or a
// gap in reporting → null, and the /air card just doesn't render. Reuses the
// AIRNOW_API_KEY Worker secret and the already-canaried airnowapi.org egress.
export const NEARBY_OZONE = { aqs: "482010026", site: "Channelview C15", distanceMi: 8.5 };
export async function fetchNearbyOzone(env) {
  if (!env?.AIRNOW_API_KEY) return null;
  const end = new Date();
  const start = new Date(end.getTime() - 3 * 3600 * 1000);
  const hourUTC = (d) => d.toISOString().slice(0, 13); // YYYY-MM-DDTHH (UTC)
  const res = await fetch(
    `https://www.airnowapi.org/aq/data/?startDate=${hourUTC(start)}&endDate=${hourUTC(end)}` +
      `&parameters=OZONE&BBOX=-95.25,29.68,-94.95,29.90&dataType=A&format=application/json` +
      `&verbose=1&monitorType=2&API_KEY=${env.AIRNOW_API_KEY}`,
    { headers: { "User-Agent": "crosbynews.com", Accept: "application/json" } }
  );
  if (!res.ok) throw new Error(`AirNow site data failed: ${res.status}`);
  const rows = await res.json();
  if (!Array.isArray(rows)) throw new Error("AirNow site data: unexpected shape");
  const mine = rows.filter(
    (r) => String(r.FullAQSCode) === NEARBY_OZONE.aqs || r.SiteName === NEARBY_OZONE.site
  );
  if (!mine.length) return null; // Channelview not in this window — hide the card
  const latest = mine.reduce((a, b) => ((b.UTC || "") > (a.UTC || "") ? b : a));
  const aqi = typeof latest.AQI === "number" && latest.AQI >= 0 ? latest.AQI : null;
  if (aqi == null) return null;
  const utc = latest.UTC || "";
  return {
    site: NEARBY_OZONE.site,
    distanceMi: NEARBY_OZONE.distanceMi,
    aqi,
    agency: latest.AgencyName || "TCEQ",
    // AirNow's UTC field is "YYYY-MM-DDTHH:MM" (no zone) — normalize to a real ISO.
    observedIso: /T\d{2}:\d{2}$/.test(utc) ? `${utc}:00Z` : utc ? `${utc}Z` : null,
  };
}
// EPA US AQI categories (the official 0–500 bands).
export function aqiCategory(v, lang = "en") {
  if (v == null) return null;
  if (v > 300) return T(lang, "Hazardous", "Peligroso");
  if (v > 200) return T(lang, "Very Unhealthy", "Muy insalubre");
  if (v > 150) return T(lang, "Unhealthy", "Insalubre");
  if (v > 100) return T(lang, "Unhealthy for Sensitive Groups", "Insalubre para grupos sensibles");
  if (v > 50) return T(lang, "Moderate", "Moderada");
  return T(lang, "Good", "Buena");
}
export function aqiDominantLabel(key, lang = "en") {
  const pair = AQI_POLLUTANTS[key];
  return pair ? T(lang, pair[0], pair[1]) : null;
}
// Drop AirNow's trailing monitor code ("Baytown Garth C1017" → "Baytown Garth")
// for a human-readable site label.
export function aqiSiteShort(name) {
  if (!name) return null;
  return String(name).replace(/\s+C\d+[A-Za-z]?$/i, "").trim() || String(name).trim();
}
// Short honest source tag for inline spots (hero, `Now` meta): the measured
// AirNow value names the dominant pollutant's monitor; the Open-Meteo fallback
// is modeled.
export function aqiSourceTag(aqi, lang = "en") {
  if (!aqi) return "";
  if (!aqi.measured) return T(lang, "modeled", "modelado");
  const site = aqiSiteShort(aqi.dominantSite);
  return site ? T(lang, `${site} monitor`, `monitor ${site}`) : T(lang, "Houston area", "área de Houston");
}
// One-sentence provenance line for explainers / API notes. For the measured
// path, name the closest reporting monitor for each pollutant.
export function aqiSourceNote(aqi, lang = "en") {
  if (aqi?.measured) {
    const area = aqi.reportingArea || "Houston-Galveston-Brazoria, TX";
    const agency = aqi.agency || "TCEQ/AirNow";
    const siteList =
      aqi.sites && Object.keys(aqi.sites).length
        ? Object.entries(aqi.sites)
            .map(([tok, name]) => `${aqiDominantLabel(tok, lang)} — ${aqiSiteShort(name)}`)
            .join("; ")
        : "";
    return T(
      lang,
      `Measured by the closest reporting ${agency} monitor for each pollutant (per AirNow) in the ${area} area — the nearest official monitors to Crosby, which has none of its own${siteList ? ` (${siteList})` : ""}. A real reading for the area, not a Crosby-pinpoint value.`,
      `Medido por el monitor de ${agency} más cercano que reporta cada contaminante (según AirNow) en el área ${area} — los monitores oficiales más cercanos a Crosby, que no tiene ninguno propio${siteList ? ` (${siteList})` : ""}. Una lectura real del área, no un valor exacto de Crosby.`
    );
  }
  return T(
    lang,
    "Modeled from Open-Meteo's CAMS-based forecast for Crosby's coordinates (used when the AirNow monitors aren't reporting) — a useful estimate, not an official monitor reading.",
    "Modelado a partir del pronóstico CAMS de Open-Meteo para las coordenadas de Crosby (se usa cuando los monitores de AirNow no reportan) — una estimación útil, no una lectura oficial de un monitor."
  );
}

// The public airQuality JSON object, shared by /api/weather and /api/air so the
// two can't drift. Null when no reading is available.
export function aqiApiObject(aqi) {
  if (aqi?.usAqi == null) return null;
  return {
    usAqi: aqi.usAqi,
    category: aqiCategory(aqi.usAqi),
    dominantPollutant: aqiDominantLabel(aqi.dominant),
    dominantMonitor: aqi.measured ? aqiSiteShort(aqi.dominantSite) : null,
    subIndices: aqi.subIndices ?? null,
    monitors: aqi.measured ? aqi.sites ?? null : null, // per-pollutant reporting monitor site names
    reportingAgency: aqi.measured ? aqi.agency ?? null : null,
    pm2_5: aqi.pm25,
    pm10: aqi.pm10,
    ozone: aqi.ozone,
    concentrationUnit: "µg/m³",
    measured: !!aqi.measured,
    modeled: !aqi.measured, // retained for back-compat with existing clients
    reportingArea: aqi.reportingArea ?? null,
    observed: aqi.observed ?? null,
    source: aqi.measured
      ? "EPA/AirNow measured monitors — closest reporting monitor per pollutant in the Houston-Galveston-Brazoria area (nearest official monitors to Crosby)"
      : "Open-Meteo (CAMS-based model); modeled forecast used when AirNow isn't reporting",
    nearbyMonitor: aqi.nearby
      ? {
          site: aqi.nearby.site,
          pollutant: "ozone",
          usAqi: aqi.nearby.aqi,
          category: aqiCategory(aqi.nearby.aqi),
          distanceMiles: aqi.nearby.distanceMi,
          observed: aqi.nearby.observedIso,
          reportingAgency: aqi.nearby.agency ?? null,
          note: "Nearest dedicated ozone monitor. A cross-reference so a locally elevated ozone reading isn't hidden by the closest-per-pollutant headline; hourly, EPA/AirNow.",
        }
      : null,
  };
}

// --- Air quality page (/air) -------------------------------------------------
// Renders the AQI already folded into the `weather` KV entry by fetchAqi()
// (AirNow measured, Open-Meteo modeled fallback) — no new KV key or cron write.
// The dedicated page gives the number room for a per-pollutant breakdown,
// category health guidance, and an evergreen AQI guide, and gives it a
// standalone URL for search ("Crosby / Houston air quality").
export const AQI_BANDS = [
  { max: 50, cls: "a-good", en: "Good", es: "Buena" },
  { max: 100, cls: "a-mod", en: "Moderate", es: "Moderada" },
  { max: 150, cls: "a-usg", en: "Unhealthy for Sensitive Groups", es: "Insalubre para grupos sensibles" },
  { max: 200, cls: "a-unh", en: "Unhealthy", es: "Insalubre" },
  { max: 300, cls: "a-vunh", en: "Very Unhealthy", es: "Muy insalubre" },
  { max: Infinity, cls: "a-haz", en: "Hazardous", es: "Peligroso" },
];
export const aqiBand = (v) => AQI_BANDS.find((b) => v <= b.max) || AQI_BANDS[AQI_BANDS.length - 1];
// Standard EPA category health guidance, condensed.
export function aqiHealth(v, lang) {
  if (v == null) return "";
  if (v <= 50) return T(lang, "Air quality is good — no precautions needed.", "La calidad del aire es buena — no se necesitan precauciones.");
  if (v <= 100) return T(lang, "Acceptable for most. Unusually sensitive people may consider limiting prolonged outdoor exertion.", "Aceptable para la mayoría. Las personas inusualmente sensibles pueden considerar limitar el esfuerzo prolongado al aire libre.");
  if (v <= 150) return T(lang, "Sensitive groups — people with heart or lung disease, older adults, children, and teens — should limit prolonged outdoor exertion.", "Los grupos sensibles — personas con enfermedades cardíacas o pulmonares, adultos mayores, niños y adolescentes — deben limitar el esfuerzo prolongado al aire libre.");
  if (v <= 200) return T(lang, "Everyone may begin to feel effects; sensitive groups should avoid prolonged outdoor exertion, and everyone else should limit it.", "Todos pueden empezar a sentir efectos; los grupos sensibles deben evitar el esfuerzo prolongado al aire libre, y los demás deben limitarlo.");
  if (v <= 300) return T(lang, "Health alert: everyone may experience more serious effects. Avoid outdoor exertion.", "Alerta de salud: todos pueden sufrir efectos más graves. Evita el esfuerzo al aire libre.");
  return T(lang, "Health warning of emergency conditions: everyone should avoid all outdoor exertion.", "Advertencia de salud por condiciones de emergencia: todos deben evitar toda actividad al aire libre.");
}

// A small cross-reference card for the nearest dedicated ozone monitor, with a
// timestamp and a native <details> "i" expander (no JS — CSP-safe). Rendered on
// /air only when a reading is present.
export function nearbyOzoneCard(n, lang) {
  if (!n || n.aqi == null) return "";
  const band = aqiBand(n.aqi);
  const when = n.observedIso
    ? fmt(n.observedIso, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }, lang)
    : null;
  const info = T(
    lang,
    `${n.site} is the nearest dedicated ozone monitor to Crosby (about ${n.distanceMi} mi). It measures ozone only — the headline number above already uses the closest reporting monitor for each pollutant. It's shown here as a cross-check, so a locally elevated ozone reading near the ship channel can't slip past. Hourly, measured by TCEQ via EPA/AirNow.`,
    `${n.site} es el monitor de ozono dedicado más cercano a Crosby (unas ${n.distanceMi} mi). Solo mide ozono — el número principal de arriba ya usa el monitor más cercano que reporta cada contaminante. Se muestra aquí como verificación, para que una lectura de ozono localmente elevada cerca del canal no pase desapercibida. Cada hora, medido por la TCEQ vía EPA/AirNow.`
  );
  return `<section class="nearby" data-nosnippet>
    <h2 class="nearby-head">${T(lang, "Nearby ozone monitor", "Monitor de ozono cercano")}<details class="infox"><summary title="${esc(T(lang, "About this monitor", "Acerca de este monitor"))}">i</summary><p>${esc(info)}</p></details></h2>
    <article class="pgroup ${band.cls} nearby-card">
      <h3>${esc(n.site)} <span class="dom">${T(lang, "· ozone", "· ozono")}</span></h3>
      <p class="pcat">${n.aqi}</p>
      <p class="pcount">${esc(T(lang, band.en, band.es))}${when ? `<br><span class="psite">${T(lang, "Updated", "Actualizado")} ${esc(when)}</span>` : ""}</p>
    </article>
  </section>`;
}

export function airHtml(weather, lang) {
  const aqi = weather.aqi;
  const has = aqi?.usAqi != null;
  const band = has ? aqiBand(aqi.usAqi) : null;
  const title = T(lang, "Air Quality", "Calidad del aire");
  const desc = T(
    lang,
    "Current air quality (AQI) for the Houston / Crosby, TX area — measured by EPA/AirNow monitors, with a per-pollutant breakdown and what the number means for your health.",
    "Calidad del aire (AQI) actual para la zona de Houston / Crosby, TX — medida por monitores de EPA/AirNow, con desglose por contaminante y qué significa el número para tu salud."
  );
  const subCards = has && aqi.subIndices
    ? Object.entries(aqi.subIndices)
        .sort((a, b) => b[1] - a[1])
        .map(([tok, v]) => {
          const b = aqiBand(v);
          const site = aqi.sites ? aqiSiteShort(aqi.sites[tok]) : null;
          return `      <article class="pgroup ${b.cls}">
        <h2>${esc(aqiDominantLabel(tok, lang) || tok)}${tok === aqi.dominant ? ` <span class="dom">${T(lang, "· main", "· principal")}</span>` : ""}</h2>
        <p class="pcat">${v}</p>
        <p class="pcount">${esc(T(lang, b.en, b.es))}${site ? `<br><span class="psite">${esc(site)}</span>` : ""}</p>
      </article>`;
        })
        .join("\n")
    : "";
  return `<!DOCTYPE html>
<html lang="${T(lang, "en", "es-MX")}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} &mdash; Crosby, TX &mdash; crosbynews.com</title>
<meta name="description" content="${esc(desc)}">
<meta name="theme-color" content="#0b3d61">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${canonicalFor("/air", lang)}">
${OG_COMMON}
<link rel="canonical" href="${canonicalFor("/air", lang)}">
${hreflangTags("/air")}
${JSONLD_SITE}
<link rel="manifest" href="/manifest.json">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="alternate icon" href="/favicon.ico">
<style>${BASE_CSS}
  .stamp { color:var(--muted); margin:0.6rem 0 0; }
  .aqi-hero { display:flex; align-items:center; gap:1.1rem; border-radius:16px; padding:1.2rem 1.4rem; margin-top:1rem; color:#fff; }
  .aqi-num { font-size:3rem; font-weight:800; line-height:1; flex:none; }
  .aqi-cat { margin:0; font-size:1.4rem; font-weight:800; line-height:1.15; }
  .aqi-sub { margin:0.3rem 0 0; font-size:0.95rem; opacity:0.95; }
  .a-good { background:linear-gradient(135deg,#1f8b4c,#2eb86a); --pg:#1f8b4c; }
  .a-mod { background:linear-gradient(135deg,#b58900,#d4a716); --pg:#b58900; }
  .a-usg { background:linear-gradient(135deg,#d9480f,#f06a2e); --pg:#d9480f; }
  .a-unh { background:linear-gradient(135deg,#c92a2a,#e63e3e); --pg:#c92a2a; }
  .a-vunh { background:linear-gradient(135deg,#7b2ff7,#9a55ff); --pg:#7b2ff7; }
  .a-haz { background:linear-gradient(135deg,#7a1020,#a11a2f); --pg:#7a1020; }
  .pgrid { display:grid; gap:0.7rem; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); margin-top:1rem; }
  .pgroup { border-radius:12px; padding:0.8rem 1rem; background:var(--card); box-shadow:0 1px 3px rgba(0,0,0,0.07); border-left:5px solid var(--pg,#9aa4af); }
  .pgroup h2 { margin:0; font-size:0.95rem; }
  .dom { color:var(--muted); font-weight:600; font-size:0.8rem; }
  .pcat { margin:0.2rem 0 0; font-size:1.7rem; font-weight:800; line-height:1; }
  .pcount { margin:0.15rem 0 0; font-size:0.9rem; color:var(--muted); }
  .psite { font-size:0.78rem; opacity:0.85; }
  .health { margin-top:1rem; background:var(--card); border-radius:12px; padding:0.9rem 1.1rem; box-shadow:0 1px 3px rgba(0,0,0,0.07); }
  .health h2 { margin:0 0 0.3rem; font-size:1.05rem; }
  .guide { margin-top:1.6rem; }
  .guide h2 { font-size:1.15rem; }
  .guide p { font-size:0.95rem; line-height:1.55; }
  .guide .links { margin:0.5rem 0 0; padding-left:1.1rem; }
  .guide .links li { margin:0.3rem 0; font-size:0.92rem; }
  .scale-wrap { overflow-x:auto; }
  .scale { border-collapse:collapse; margin-top:0.5rem; font-size:0.88rem; min-width:420px; }
  .scale th, .scale td { border:1px solid var(--line); padding:0.35rem 0.6rem; text-align:left; }
  .scale th { background:var(--card); }
  .sw { display:inline-block; width:0.8rem; height:0.8rem; border-radius:3px; vertical-align:middle; margin-right:0.35rem; }
  .nearby { margin-top:1.2rem; }
  .nearby-head { display:flex; align-items:center; gap:0.45rem; font-size:1.05rem; font-weight:800; margin:0 0 0.5rem; }
  .nearby-card { max-width:230px; }
  .nearby-card h3 { margin:0; font-size:0.95rem; }
  .infox { font-weight:400; }
  .infox > summary { list-style:none; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; width:1.15rem; height:1.15rem; border:1px solid var(--muted); border-radius:50%; font-size:0.72rem; font-style:italic; font-weight:700; line-height:1; color:var(--muted); }
  .infox > summary::-webkit-details-marker { display:none; }
  .infox[open] > summary { color:inherit; border-color:currentColor; }
  .infox > p { margin:0.5rem 0 0; font-size:0.85rem; font-weight:400; color:var(--muted); line-height:1.5; max-width:56ch; }
</style>
</head>
<body>
${topbar("/air", lang)}
<main id="main">
  <h1>${esc(title)}</h1>
  <p class="intro">${T(
    lang,
    "Measured air quality for the Houston metro area, which includes Crosby. The U.S. Air Quality Index (AQI) runs 0–500; the number below is the highest of the reported pollutants, which sets the overall level.",
    "Calidad del aire medida para el área metropolitana de Houston, que incluye a Crosby. El Índice de Calidad del Aire de EE. UU. (AQI) va de 0 a 500; el número de abajo es el más alto de los contaminantes reportados, que define el nivel general."
  )}</p>
  ${
    has
      ? `<div class="aqi-hero ${band.cls}">
    <span class="aqi-num">${aqi.usAqi}</span>
    <div>
      <p class="aqi-cat">${esc(T(lang, band.en, band.es))}</p>
      <p class="aqi-sub">${aqi.dominant ? `${T(lang, "Main pollutant", "Contaminante principal")}: ${esc(aqiDominantLabel(aqi.dominant, lang))} &middot; ` : ""}${esc(aqiSourceTag(aqi, lang))}${aqi.observed ? ` &middot; ${esc(aqi.observed)}` : ""}</p>
    </div>
  </div>
  <p class="stamp">${aqiSourceNote(aqi, lang)}</p>
  ${subCards ? `<div class="pgrid">\n${subCards}\n  </div>` : ""}
  ${nearbyOzoneCard(aqi.nearby, lang)}
  <section class="health">
    <h2>${T(lang, "What this means", "Qué significa")}</h2>
    <p>${aqiHealth(aqi.usAqi, lang)}</p>
  </section>`
      : `<p class="stamp">${T(lang, "The air quality reading is temporarily unavailable — try again shortly.", "La lectura de calidad del aire no está disponible temporalmente — inténtalo de nuevo en un momento.")}</p>`
  }
  <section class="guide" data-nosnippet>
    <h2>${T(lang, "How to read the AQI", "Cómo leer el AQI")}</h2>
    <div class="scale-wrap"><table class="scale">
      <tr><th>${T(lang, "AQI", "AQI")}</th><th>${T(lang, "Level", "Nivel")}</th><th>${T(lang, "What to do", "Qué hacer")}</th></tr>
      <tr><td><span class="sw" style="background:#1f8b4c"></span>0&ndash;50</td><td>${T(lang, "Good", "Buena")}</td><td>${T(lang, "Air is clean — enjoy outdoor activity.", "Aire limpio — disfruta actividades al aire libre.")}</td></tr>
      <tr><td><span class="sw" style="background:#b58900"></span>51&ndash;100</td><td>${T(lang, "Moderate", "Moderada")}</td><td>${T(lang, "Unusually sensitive people: ease up on hard outdoor exertion.", "Personas muy sensibles: bajen el ritmo del esfuerzo intenso al aire libre.")}</td></tr>
      <tr><td><span class="sw" style="background:#d9480f"></span>101&ndash;150</td><td>${T(lang, "Sensitive groups", "Grupos sensibles")}</td><td>${T(lang, "Heart/lung conditions, kids, older adults: limit prolonged exertion.", "Condiciones cardíacas/pulmonares, niños, adultos mayores: limiten el esfuerzo prolongado.")}</td></tr>
      <tr><td><span class="sw" style="background:#c92a2a"></span>151&ndash;200</td><td>${T(lang, "Unhealthy", "Insalubre")}</td><td>${T(lang, "Everyone limits prolonged exertion; sensitive groups avoid it.", "Todos limitan el esfuerzo prolongado; los grupos sensibles lo evitan.")}</td></tr>
      <tr><td><span class="sw" style="background:#7b2ff7"></span>201&ndash;300</td><td>${T(lang, "Very Unhealthy", "Muy insalubre")}</td><td>${T(lang, "Avoid outdoor exertion.", "Evita el esfuerzo al aire libre.")}</td></tr>
      <tr><td><span class="sw" style="background:#7a1020"></span>301+</td><td>${T(lang, "Hazardous", "Peligroso")}</td><td>${T(lang, "Stay indoors; avoid all outdoor exertion.", "Quédate adentro; evita toda actividad al aire libre.")}</td></tr>
    </table></div>
    <h2>${T(lang, "Air quality on the Gulf Coast", "La calidad del aire en la costa del Golfo")}</h2>
    <p>${T(
      lang,
      "Ground-level ozone is the Houston area's signature summer pollutant — it forms on hot, sunny, stagnant afternoons when sunlight cooks emissions from traffic and the ship-channel industry, so ozone AQI usually peaks mid-afternoon and eases overnight. Fine particles (PM2.5) matter year-round and spike with wildfire smoke, Saharan dust in summer, and still winter mornings. When TCEQ calls an Ozone Action Day, sensitive groups should plan outdoor activity for the morning.",
      "El ozono a nivel del suelo es el contaminante veraniego característico del área de Houston — se forma en las tardes calurosas, soleadas y sin viento cuando la luz solar cocina las emisiones del tráfico y la industria del canal, así que el AQI de ozono suele alcanzar su pico a media tarde y baja de noche. Las partículas finas (PM2.5) importan todo el año y suben con el humo de incendios, el polvo del Sahara en verano y las mañanas frías y quietas. Cuando la TCEQ declara un Día de Acción por Ozono, los grupos sensibles deben planear la actividad al aire libre para la mañana."
    )}</p>
    <ul class="links">
      <li><a href="https://www.airnow.gov/?city=Houston&state=TX&country=USA">${T(lang, "AirNow (EPA)", "AirNow (EPA)")}</a> &mdash; ${T(lang, "the EPA's official measured air-quality data — the source behind this page", "los datos oficiales de calidad del aire medidos por la EPA — la fuente detrás de esta página")}</li>
      <li><a href="https://www.tceq.texas.gov/airquality/monops">${T(lang, "TCEQ air monitoring", "Monitoreo del aire de la TCEQ")}</a> &mdash; ${T(lang, "the Texas agency that runs the monitors", "la agencia de Texas que opera los monitores")}</li>
      <li><a href="${lang === "es" ? "/es/pollen" : "/pollen"}">${T(lang, "Pollen &amp; mold", "Polen y moho")}</a> &mdash; ${T(lang, "the daily measured pollen and mold count for the Crosby area", "el conteo diario medido de polen y moho para la zona de Crosby")}</li>
      <li><a href="${lang === "es" ? "/es/weather" : "/weather"}">${T(lang, "Crosby forecast", "Pronóstico de Crosby")}</a> &mdash; ${T(lang, "how heat and stagnant air drive ozone days", "cómo el calor y el aire estancado provocan los días de ozono")}</li>
    </ul>
  </section>
</main>
${footer({ page: "/air", lang, source: aqi?.measured ? T(lang, `Air quality measured by <a href="https://www.airnow.gov/">EPA/AirNow</a>.`, `Calidad del aire medida por <a href="https://www.airnow.gov/">EPA/AirNow</a>.`) : T(lang, `Modeled air quality from <a href="https://open-meteo.com/">Open-Meteo</a> (AirNow fallback).`, `Calidad del aire modelada por <a href="https://open-meteo.com/">Open-Meteo</a> (respaldo de AirNow).`), data: weather })}
</body>
</html>`;
}

export function airMarkdown(weather, lang) {
  const aqi = weather.aqi;
  const out = [`# ${T(lang, "Air Quality", "Calidad del aire")}`, ""];
  if (aqi?.usAqi != null) {
    const band = aqiBand(aqi.usAqi);
    out.push(
      `**${T(lang, "US AQI", "AQI de EE. UU.")}: ${aqi.usAqi} — ${T(lang, band.en, band.es)}**${aqi.dominant ? ` (${T(lang, "main pollutant", "contaminante principal")}: ${aqiDominantLabel(aqi.dominant, lang)})` : ""}`,
      "",
      `_${aqiSourceNote(aqi, lang)}${aqi.observed ? ` ${T(lang, "Observed", "Observado")} ${aqi.observed}.` : ""}_`,
      ""
    );
    if (aqi.subIndices && Object.keys(aqi.subIndices).length) {
      out.push(`## ${T(lang, "By pollutant", "Por contaminante")}`, "");
      for (const [tok, v] of Object.entries(aqi.subIndices).sort((a, b) => b[1] - a[1])) {
        const site = aqi.sites ? aqiSiteShort(aqi.sites[tok]) : null;
        out.push(`- ${aqiDominantLabel(tok, lang) || tok}: ${v} (${T(lang, aqiBand(v).en, aqiBand(v).es)})${site ? ` — ${site}` : ""}`);
      }
      out.push("");
    }
    if (aqi.nearby && aqi.nearby.aqi != null) {
      const nb = aqi.nearby;
      const nbWhen = nb.observedIso ? fmt(nb.observedIso, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }, lang) : null;
      out.push(
        `## ${T(lang, "Nearby ozone monitor", "Monitor de ozono cercano")}`,
        "",
        `- ${nb.site} (${T(lang, "ozone", "ozono")}): ${nb.aqi} (${T(lang, aqiBand(nb.aqi).en, aqiBand(nb.aqi).es)})${nbWhen ? ` — ${T(lang, "updated", "actualizado")} ${nbWhen}` : ""}`,
        `  ${T(lang, `Nearest dedicated ozone monitor (~${nb.distanceMi} mi); a cross-check so a locally elevated reading isn't hidden by the closest-per-pollutant headline.`, `El monitor de ozono dedicado más cercano (~${nb.distanceMi} mi); una verificación para que una lectura localmente elevada no quede oculta por el titular del monitor más cercano por contaminante.`)}`,
        ""
      );
    }
    out.push(`## ${T(lang, "What this means", "Qué significa")}`, "", aqiHealth(aqi.usAqi, lang), "");
  } else {
    out.push(T(lang, "The air quality reading is temporarily unavailable.", "La lectura de calidad del aire no está disponible temporalmente."), "");
  }
  out.push(
    "---",
    `${aqi?.measured ? T(lang, "Source: EPA/AirNow measured monitors (Houston metro reporting area).", "Fuente: monitores medidos de EPA/AirNow (área de reporte del área metropolitana de Houston).") : T(lang, "Source: Open-Meteo modeled forecast (AirNow fallback).", "Fuente: pronóstico modelado de Open-Meteo (respaldo de AirNow).")} · [${T(lang, "Pollen", "Polen")}](${canonicalFor("/pollen", lang)}) · [crosbynews.com](${canonicalFor("/", lang)})`
  );
  return out.join("\n");
}
// JSON shape served at /api/air — the same AQI data behind /air (and /api/weather).
export function apiAir(data) {
  return {
    location: "Houston metro area (Houston-Galveston-Brazoria reporting area, which includes Crosby, TX)",
    updated: data.updated ?? null,
    airQuality: aqiApiObject(data.aqi),
  };
}
// --- end Air quality ----------------------------------------------------------
