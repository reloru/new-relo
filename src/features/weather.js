// The weather vertical slice: the NWS fetch that everything else hangs off,
// the cached-weather loader, the /weather page in both representations, the
// /api/weather shape, and the hotlinkable badge.
//
// fetchWeather() is the fan-out point — NWS forecast + hourly + alerts in
// parallel with the EPA UV, AirNow/Open-Meteo AQI, and nearby-ozone calls from
// features/air.js. The three non-NWS calls are failure-tolerant: each degrades
// to null rather than blocking the NWS refresh.

import { LAT, LON, KV_KEY, NWS_HEADERS } from "../config.js";
import { T, canonicalFor, hreflangTags, translateConditions, translatePeriodName,
         translateWind, translateDir, ES_NWS_NOTE } from "../i18n.js";
import { esc, nl2br, iconUrl, fullTime, clockTime, hourLabel } from "../lib/format.js";
import { pop, feelsLikeRawF, feelsLikeF, currentHourly, sunTimesForCtDate } from "../lib/derived.js";
import { BASE_CSS } from "../assets/base-css.js";
import { HOME_SCRIPT } from "../assets/client-scripts.js";
import { topbar, footer } from "../chrome.js";
import { JSONLD_SITE, OG_COMMON } from "../seo.js";
import { fetchUv, uvCurrent, uvPeakToday, uvCategory, fetchAqi, fetchNearbyOzone,
         aqiCategory, aqiSourceTag, aqiApiObject } from "./air.js";

export async function getJson(url) {
  const res = await fetch(url, { headers: NWS_HEADERS });
  if (!res.ok) {
    throw new Error(`NWS request failed: ${res.status} ${res.statusText} (${url})`);
  }
  return res.json();
}

// Pull the daily + hourly forecast and active alerts for Crosby, TX.
export async function fetchWeather(env) {
  // 1. Resolve the point to its forecast endpoints.
  const points = await getJson(`https://api.weather.gov/points/${LAT},${LON}`);
  const { forecast: forecastUrl, forecastHourly: hourlyUrl } = points.properties;
  const place = points.properties.relativeLocation?.properties;

  // 2. Daily forecast, hourly forecast, active alerts, the EPA UV forecast,
  // and the air-quality index (AirNow measured, Open-Meteo modeled fallback)
  // are independent. UV and AQI are each failure-tolerant (null on error) so a
  // third-party hiccup can never block the NWS refresh.
  const [forecast, hourly, alertsData, uv, aqi, nearbyOzone] = await Promise.all([
    getJson(forecastUrl),
    getJson(hourlyUrl),
    getJson(`https://api.weather.gov/alerts/active?point=${LAT},${LON}`),
    fetchUv().catch((e) => {
      console.error("EPA UV fetch failed:", e && e.message);
      return null;
    }),
    fetchAqi(env).catch((e) => {
      console.error("AQI fetch failed:", e && e.message);
      return null;
    }),
    fetchNearbyOzone(env).catch((e) => {
      console.error("Nearby ozone monitor fetch failed:", e && e.message);
      return null;
    }),
  ]);
  // Cross-reference monitor rides along with the AQI object (both are air
  // quality, and the /air card + /api/air read it there). Kept even when the
  // headline falls back to modeled — a real nearby monitor reading is useful.
  if (aqi && nearbyOzone) aqi.nearby = nearbyOzone;

  return {
    updated: new Date().toISOString(),
    place: place ? `${place.city}, ${place.state}` : "Crosby, TX",
    periods: forecast.properties.periods ?? [],
    // Keep 48 hours: the homepage shows the first 12, /hourly shows them all.
    hourly: (hourly.properties.periods ?? []).slice(0, 48),
    alerts: (alertsData.features ?? []).map((f) => f.properties),
    uv,
    aqi,
  };
}

export function renderAlerts(alerts, lang) {
  if (!alerts.length) return "";
  const cards = alerts
    .map(
      (a) => `
      <article class="alert">
        <h3>&#9888; ${esc(a.event)}</h3>
        ${a.headline ? `<p class="headline">${esc(a.headline)}</p>` : ""}
        ${a.description ? `<p>${nl2br(a.description)}</p>` : ""}
        ${a.instruction ? `<p class="instruction"><strong>${T(lang, "What to do:", "Qué hacer:")}</strong> ${nl2br(a.instruction)}</p>` : ""}
        ${a.expires ? `<p class="meta">${T(lang, "In effect until", "Vigente hasta")} ${esc(fullTime(a.expires, lang))}</p>` : ""}
      </article>`
    )
    .join("");
  return `<section class="alerts" aria-label="${T(lang, "Active weather alerts", "Alertas meteorológicas activas")}">${cards}</section>`;
}

export function renderHero(data, lang) {
  const now = currentHourly(data);
  const lead = data.periods?.[0];
  // Degenerate NWS response (zero hourly periods): suppress the hero panel but
  // still emit the page's single <h1> so it never renders heading-less.
  if (!now) return `<h1>${T(lang, `${esc(data.place)} Weather`, `Clima en ${esc(data.place)}`)}</h1>`;
  const feels = feelsLikeF(now);
  const sun = sunTimesForCtDate(Date.now());
  const uvNow = uvCurrent(data);
  const aqi = data.aqi;
  return `
    <section class="hero">
      ${now.icon ? `<img class="hero-icon" src="${iconUrl(now.icon, "large")}" alt="${esc(translateConditions(now.shortForecast, lang))}" width="128" height="128" fetchpriority="high">` : ""}
      <div class="hero-now">
        <h1 class="hero-h1">${T(lang, `${esc(data.place)} Weather`, `Clima en ${esc(data.place)}`)}</h1>
        <p class="hero-temp">${esc(now.temperature)}&deg;<span>${esc(now.temperatureUnit)}</span></p>
        <p class="hero-cond">${esc(translateConditions(now.shortForecast, lang))}</p>
        ${feels != null ? `<p class="hero-feels">${T(lang, "Feels like", "Sensación térmica de")} ${esc(feels)}&deg;</p>` : ""}
        <p class="hero-meta">${esc(data.place)} &middot; ${T(lang, "as of", "a las")} ${esc(clockTime(now.startTime, lang))} CT${pop(now) ? ` &middot; ${pop(now)}% ${T(lang, "precip", "prob. lluvia")}` : ""}${uvNow ? ` &middot; ${T(lang, "UV", "UV")} ${esc(uvNow)} (${esc(uvCategory(uvNow, lang))})` : ""}${aqi?.usAqi != null ? ` &middot; ${T(lang, "Air", "Aire")} ${esc(aqi.usAqi)} (${esc(aqiCategory(aqi.usAqi, lang))}, ${esc(aqiSourceTag(aqi, lang))})` : ""}</p>
        ${sun ? `<p class="hero-meta">${T(lang, "Sunrise", "Amanecer")} ${esc(clockTime(sun.sunrise, lang))} &middot; ${T(lang, "Sunset", "Atardecer")} ${esc(clockTime(sun.sunset, lang))}</p>` : ""}
      </div>
    </section>
    ${lead ? `<p class="lead"><strong>${esc(translatePeriodName(lead.name, lang))}:</strong> ${esc(lead.detailedForecast)}</p>` : ""}`;
}

export function renderHourly(hourly, lang) {
  if (!hourly?.length) return "";
  const cells = hourly
    .map(
      (h) => `
      <div class="hour">
        <span class="hour-time">${esc(hourLabel(h.startTime, lang))}</span>
        ${h.icon ? `<img src="${iconUrl(h.icon, "small")}" alt="${esc(translateConditions(h.shortForecast, lang))}" width="44" height="44" loading="lazy">` : ""}
        <span class="hour-temp">${esc(h.temperature)}&deg;</span>
        <span class="hour-pop${pop(h) >= 30 ? " wet" : ""}">${pop(h)}%</span>
      </div>`
    )
    .join("");
  return `<section class="card">
    <h2>${T(lang, "Next 12 hours", "Próximas 12 horas")}</h2>
    <div class="hourly">${cells}</div>
  </section>`;
}

export function renderDaily(periods, lang) {
  if (!periods.length) return `<p class="none">${T(lang, "No forecast available.", "Pronóstico no disponible.")}</p>`;
  const cards = periods
    .map(
      (p) => `
      <article class="period ${p.isDaytime ? "day" : "night"}">
        <div class="period-head">
          <h3>${esc(translatePeriodName(p.name, lang))}</h3>
          ${p.icon ? `<img src="${iconUrl(p.icon, "medium")}" alt="${esc(translateConditions(p.shortForecast, lang))}" width="52" height="52" loading="lazy">` : ""}
        </div>
        <p class="temp">${p.isDaytime ? T(lang, "High", "Máx.") : T(lang, "Low", "Mín.")} ${esc(p.temperature)}&deg;${esc(p.temperatureUnit)}</p>
        <p class="short">${esc(translateConditions(p.shortForecast, lang))}</p>
        <p class="meta">${pop(p) ? `${pop(p)}% ${T(lang, "precip", "prob. lluvia")} &middot; ` : ""}${T(lang, "Wind", "Viento")} ${esc(translateWind(p.windSpeed, lang))} ${esc(translateDir(p.windDirection, lang))}</p>
        <p class="detail">${esc(p.detailedForecast)}</p>
      </article>`
    )
    .join("");
  return `<section class="daily-sec">
    <h2>${T(lang, "7-Day Forecast", "Pronóstico a 7 días")}</h2>
    <div class="periods">${cards}</div>
  </section>`;
}

export function renderHtml(data, lang, burnban) {
  const hasAlerts = (data.alerts ?? []).length > 0;
  return `<!DOCTYPE html>
<html lang="${T(lang, "en", "es-MX")}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${T(lang, "Crosby, TX Weather", "Clima de Crosby, TX")} &mdash; crosbynews.com</title>
<meta name="description" content="${T(lang, "Live weather forecast and active alerts for Crosby, Texas, refreshed every 15 minutes from the U.S. National Weather Service.", "Pronóstico del tiempo y alertas activas para Crosby, Texas, actualizado cada 15 minutos del Servicio Meteorológico Nacional de EE. UU.")}">
<meta name="theme-color" content="#0b3d61">
<meta property="og:title" content="${T(lang, "Crosby, TX Weather", "Clima de Crosby, TX")}">
<meta property="og:description" content="${T(lang, "Live forecast and active alerts for Crosby, Texas.", "Pronóstico del tiempo y alertas activas para Crosby, Texas.")}">
<meta property="og:type" content="website">
<meta property="og:url" content="${canonicalFor("/weather", lang)}">
${OG_COMMON}
<link rel="canonical" href="${canonicalFor("/weather", lang)}">
${hreflangTags("/weather")}
${JSONLD_SITE}
<link rel="manifest" href="/manifest.json">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="alternate icon" href="/favicon.ico">
<style>${BASE_CSS}
  .hero { display:flex; align-items:center; gap:1rem; background:linear-gradient(135deg,var(--blue),var(--accent)); color:#fff; border-radius:16px; padding:1.1rem 1.3rem; margin-top:0.5rem; }
  .hero-h1 { margin:0 0 0.15rem; font-size:1rem; font-weight:600; opacity:0.9; letter-spacing:0.01em; }
  .hero-icon { border-radius:12px; background:rgba(255,255,255,0.12); flex:none; }
  .hero-temp { margin:0; font-size:3.4rem; font-weight:800; line-height:1; }
  .hero-temp span { font-size:1.2rem; font-weight:600; vertical-align:super; opacity:0.85; }
  .hero-cond { margin:0.2rem 0 0; font-size:1.2rem; font-weight:600; }
  .hero-feels { margin:0.15rem 0 0; font-size:0.95rem; opacity:0.9; }
  .hero-meta { margin:0.35rem 0 0; font-size:0.85rem; opacity:0.85; }
  .lead { margin:0.8rem 0 0; color:var(--muted); }

  .card { background:var(--card); border-radius:12px; padding:0.8rem 1rem; margin-top:1rem; box-shadow:0 1px 3px rgba(0,0,0,0.07); }
  .card h2 { margin:0 0 0.6rem; }
  .hourly { display:flex; gap:0.4rem; overflow-x:auto; padding-bottom:0.3rem; }
  .hour { flex:0 0 auto; width:62px; display:flex; flex-direction:column; align-items:center; gap:0.15rem; text-align:center; }
  .hour-time { font-size:0.8rem; color:var(--muted); }
  .hour-temp { font-weight:700; }
  .hour-pop { font-size:0.75rem; color:var(--muted); }
  .hour-pop.wet { color:var(--link); font-weight:700; }

  .periods { display:grid; gap:0.75rem; grid-template-columns:repeat(auto-fill,minmax(220px,1fr)); }
  .period { background:var(--card); border-radius:12px; padding:0.85rem 1rem; box-shadow:0 1px 3px rgba(0,0,0,0.07); }
  .period.night { background:color-mix(in srgb,var(--card) 92%, var(--blue)); }
  .period-head { display:flex; justify-content:space-between; align-items:center; gap:0.5rem; }
  .period-head h3 { margin:0; font-size:1.02rem; }
  .period .temp { margin:0.2rem 0; font-size:1.5rem; font-weight:800; color:var(--accent); }
  .period .short { margin:0.2rem 0; font-weight:600; }
  .period .meta { margin:0.2rem 0; font-size:0.82rem; color:var(--muted); }
  .period .detail { margin:0.5rem 0 0; font-size:0.9rem; }

  .alerts { display:grid; gap:0.6rem; margin-top:0.5rem; }
  .alert { background:#fff4f3; border-left:5px solid #c0392b; border-radius:10px; padding:0.8rem 1rem; }
  .alert h3 { margin:0 0 0.3rem; color:#a3271b; }
  .alert .headline { font-weight:700; }
  .alert .instruction { background:rgba(255,255,255,0.65); border-radius:6px; padding:0.5rem 0.7rem; }
  .alert .meta { font-size:0.8rem; color:var(--muted); }
  @media (prefers-color-scheme: dark) { .alert { background:#2a1715; } .alert .instruction { background:rgba(0,0,0,0.25); } }
</style>
</head>
<body>
${topbar("/weather", lang)}
<main id="main">
  ${renderAlerts(data.alerts ?? [], lang)}
  ${renderHero(data, lang)}
  ${lang === "es" ? `<p class="lead nws-note">${ES_NWS_NOTE}</p>` : ""}
  ${renderHourly((data.hourly ?? []).slice(0, 12), lang)}
  ${renderDaily(data.periods ?? [], lang)}
  <p class="lead"><a href="${lang === "es" ? "/es/hourly" : "/hourly"}">${T(lang, "Full 48-hour hourly forecast", "Pronóstico por hora de 48 horas")}</a> &middot; <a href="${lang === "es" ? "/es/radar" : "/radar"}">${T(lang, "Radar", "Radar")}</a> &middot; <a href="${lang === "es" ? "/es/water" : "/water"}">${T(lang, "Water levels", "Niveles de agua")}</a></p>
  ${burnban?.status === "Yes" ? `<p class="lead">&#128293; ${T(lang, "Harris County burn ban in effect.", "Prohibición de quemas vigente en el condado de Harris.")} <a href="${lang === "es" ? "/es/burn-ban" : "/burn-ban"}">${T(lang, "Details", "Detalles")} &rarr;</a></p>` : ""}
</main>
${footer({ page: "/weather", lang, source: T(lang, `Data from the U.S. National Weather Service (<a href="https://weather.gov">weather.gov</a>).`, `Datos del Servicio Meteorológico Nacional de EE. UU. (<a href="https://weather.gov">weather.gov</a>).`), data })}
<script>${HOME_SCRIPT}</script>
</body>
</html>`;
}

// Markdown rendering of the same data, served when an agent sends
// `Accept: text/markdown` (or ?format=md).
export function renderMarkdown(data, lang, burnban) {
  const cell = (s) => String(s ?? "").replace(/\|/g, "/").replace(/\s*\n\s*/g, " ");
  const now = currentHourly(data);
  const lead = data.periods?.[0];
  const out = [];
  out.push(`# ${T(lang, `${data.place || "Crosby, TX"} Weather`, `Clima en ${data.place || "Crosby, TX"}`)}`, "");
  out.push(`_${T(lang, "Updated", "Actualizado")} ${fullTime(data.updated, lang)} CT — ${T(lang, "source: U.S. National Weather Service (weather.gov)", "fuente: Servicio Meteorológico Nacional de EE. UU. (weather.gov)")}_`, "");
  if (lang === "es") out.push("_Las condiciones se traducen al español; las descripciones detalladas y las alertas se muestran en inglés oficial del NWS._", "");
  if (burnban?.status === "Yes") out.push(`**🔥 ${T(lang, "Harris County burn ban in effect.", "Prohibición de quemas vigente en el condado de Harris.")}** [${T(lang, "Details", "Detalles")}](${canonicalFor("/burn-ban", lang)})`, "");

  if (now) {
    const feels = feelsLikeF(now);
    const sun = sunTimesForCtDate(Date.now());
    const uvNow = uvCurrent(data);
    const aqi = data.aqi;
    out.push(T(lang, "## Now", "## Ahora"));
    out.push(`**${now.temperature}°${now.temperatureUnit}** — ${translateConditions(now.shortForecast, lang)} (${T(lang, "as of", "a las")} ${clockTime(now.startTime, lang)} CT)${feels != null ? ` · ${T(lang, "feels like", "sensación térmica de")} ${feels}°` : ""}${pop(now) ? ` · ${pop(now)}% ${T(lang, "precip", "prob. lluvia")}` : ""}${uvNow ? ` · ${T(lang, "UV", "UV")} ${uvNow} (${uvCategory(uvNow, lang)})` : ""}${aqi?.usAqi != null ? ` · ${T(lang, "Air", "Aire")} ${aqi.usAqi} (${aqiCategory(aqi.usAqi, lang)}, ${T(lang, "modeled", "modelado")})` : ""}`, "");
    if (sun) out.push(`${T(lang, "Sunrise", "Amanecer")} ${clockTime(sun.sunrise, lang)} · ${T(lang, "Sunset", "Atardecer")} ${clockTime(sun.sunset, lang)} CT`, "");
  }
  if (lead) out.push(`**${translatePeriodName(lead.name, lang)}:** ${lead.detailedForecast}`, "");

  out.push(T(lang, "## Active alerts", "## Alertas activas"));
  const alerts = data.alerts ?? [];
  if (alerts.length) {
    for (const a of alerts) {
      out.push(`- **${a.event}**${a.headline ? ` — ${a.headline}` : ""}${a.expires ? ` (${T(lang, "until", "hasta")} ${fullTime(a.expires, lang)} CT)` : ""}`);
      if (a.instruction) out.push(`  - ${T(lang, "What to do:", "Qué hacer:")} ${cell(a.instruction)}`);
    }
  } else {
    out.push(T(lang, "None.", "Ninguna."));
  }
  out.push("");

  const hourly = (data.hourly ?? []).slice(0, 12);
  if (hourly.length) {
    out.push(T(lang, "## Next 12 hours", "## Próximas 12 horas"), T(lang, "| Time | Temp | Conditions | Precip |", "| Hora | Temp | Condiciones | Prob. |"), "| --- | --- | --- | --- |");
    for (const h of hourly) {
      out.push(`| ${cell(hourLabel(h.startTime, lang))} | ${h.temperature}°${h.temperatureUnit} | ${cell(translateConditions(h.shortForecast, lang))} | ${pop(h)}% |`);
    }
    out.push("");
  }

  out.push(T(lang, "## 7-day forecast", "## Pronóstico a 7 días"));
  for (const p of data.periods ?? []) {
    out.push(`### ${translatePeriodName(p.name, lang)}`);
    out.push(`${p.isDaytime ? T(lang, "High", "Máx.") : T(lang, "Low", "Mín.")} ${p.temperature}°${p.temperatureUnit} — ${translateConditions(p.shortForecast, lang)}. ${T(lang, "Wind", "Viento")} ${translateWind(p.windSpeed, lang)} ${translateDir(p.windDirection, lang)}.${pop(p) ? ` ${pop(p)}% ${T(lang, "precip.", "prob. lluvia.")}` : ""}`, "");
    out.push(p.detailedForecast, "");
  }

  out.push("---", `[crosbynews.com](${canonicalFor("/", lang)}) · ${T(lang, "data from the National Weather Service", "datos del Servicio Meteorológico Nacional")}`);
  return out.join("\n");
}

// Shared loader: cached weather, refreshing on a missing or stale-shaped entry.
export async function loadWeather(env) {
  let cache = "hit";
  let data = null;
  try {
    data = await env.WEATHER.get(KV_KEY, "json");
  } catch (e) {
    // Corrupt / non-JSON value in KV: treat as a miss and refetch below, the
    // same self-heal path as a stale-shaped entry. Writers always
    // JSON.stringify, so this is largely theoretical.
    console.error("KV weather parse failed:", e && e.stack);
  }
  if (!data || !Array.isArray(data.hourly)) {
    data = await fetchWeather(env);
    try {
      await env.WEATHER.put(KV_KEY, JSON.stringify(data));
      cache = "miss-warmed";
    } catch (e) {
      console.error("KV warm failed:", e && e.stack);
      cache = "miss-warmfail";
    }
  }
  return { data, cache };
}

// JSON shape served at /api/weather. `feelsLike` (heat index / wind chill)
// and `sun` (sunrise/sunset) are computed in-Worker, not NWS fields — added
// alongside the NWS data rather than replacing it, so they're additive and
// clearly derived.
export function apiWeather(data) {
  const withFeels = (h) => ({ ...h, feelsLike: feelsLikeRawF(h) });
  const sun = sunTimesForCtDate(Date.now());
  return {
    location: data.place || "Crosby, TX",
    coordinates: { lat: LAT, lon: LON },
    source: "U.S. National Weather Service (api.weather.gov)",
    updated: data.updated ?? null,
    sun: sun ? { sunrise: new Date(sun.sunrise).toISOString(), sunset: new Date(sun.sunset).toISOString() } : null,
    // UV is EPA-sourced (not NWS), so it's a separate object — clearly labeled,
    // not folded into `current`. Null when the EPA fetch failed or the current
    // hour is outside the product's ~6am–8pm window.
    uv: (() => {
      const cur = uvCurrent(data), peak = uvPeakToday(data);
      return cur != null || peak != null
        ? { current: cur, currentCategory: uvCategory(cur), peakToday: peak, peakCategory: uvCategory(peak), source: "U.S. EPA (Envirofacts UV, ZIP 77532)" }
        : null;
    })(),
    // Air quality: MEASURED (EPA/AirNow monitors, `measured: true`) for the
    // Houston-Galveston-Brazoria reporting area that includes Crosby, or MODELED
    // (Open-Meteo, `measured: false`) as the fallback when AirNow isn't
    // reporting. Either way it's regional/estimated (no monitor in Crosby
    // itself), never a Crosby-pinpoint official reading. Null when both failed.
    airQuality: aqiApiObject(data.aqi),
    current: currentHourly(data) ? withFeels(currentHourly(data)) : null,
    hourly: (data.hourly ?? []).slice(0, 12).map(withFeels),
    forecast: data.periods ?? [],
    alerts: data.alerts ?? [],
  };
}

// /badge.svg — a small, hotlinkable live-weather badge other local sites can
// embed with a plain <img>. Hand-built SVG string in the brand style (the
// favicon's sun-and-cloud at left), system fonts only (an <img> context can't
// fetch webfonts anyway). Text rows use tspan flow so variable-width values
// (temp, condition) never need manual collision math; the condition is
// truncated to fit the card. Pass `data` = null to render the neutral
// "unavailable" badge (no alert flag — we don't know, so we don't claim).
// English-only like the other non-page endpoints.
export function badgeSvg(data) {
  const cur = data ? currentHourly(data) : null;
  const temp = typeof cur?.temperature === "number" ? `${cur.temperature}°${cur.temperatureUnit || "F"}` : "–";
  const feels = feelsLikeF(cur);
  let cond = cur?.shortForecast || "Data unavailable";
  if (cond.length > 20) cond = cond.slice(0, 19).trimEnd() + "…";
  const alerts = (data?.alerts ?? []).length;
  // Top-right status flag: end-anchored text (no pill rect, so no width math).
  // "No alerts" is worth stating — same philosophy as the hub's status card.
  const flag = !data
    ? ""
    : alerts
      ? `<text x="288" y="24" text-anchor="end" font-size="12" font-weight="800" fill="#ffa294">&#9888; ${alerts} ALERT${alerts === 1 ? "" : "S"}</text>`
      : `<text x="288" y="24" text-anchor="end" font-size="11" font-weight="700" fill="#7fd39b">&#10004; NO ALERTS</text>`;
  const title = data
    ? `Crosby, TX weather: ${temp} ${cur?.shortForecast || "unavailable"}${feels != null ? `, feels like ${feels}°` : ""}${alerts ? ` — ${alerts} active alert${alerts === 1 ? "" : "s"}` : " — no active alerts"} — crosbynews.com`
    : "Crosby, TX weather — data temporarily unavailable — crosbynews.com";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="80" viewBox="0 0 300 80" role="img" aria-labelledby="bt">
<title id="bt">${esc(title)}</title>
<rect width="300" height="80" rx="12" fill="#0b3d61"/>
<circle cx="30" cy="34" r="12" fill="#f5b301"/>
<ellipse cx="39" cy="43" rx="16" ry="9" fill="#dfe7ee"/>
<g font-family="system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<text x="64" y="24" font-size="11" font-weight="700" letter-spacing="1.5" fill="#9fc1d9">CROSBY, TX</text>
<text x="64" y="52"><tspan font-size="25" font-weight="800" fill="#ffffff">${esc(temp)}</tspan><tspan dx="8" font-size="13" fill="#dfe7ee">${esc(cond)}</tspan></text>
<text x="64" y="70" font-size="11" fill="#9fc1d9">${feels != null ? esc(`Feels like ${feels}° · `) : ""}crosbynews.com</text>
${flag}
</g>
</svg>
`;
}
