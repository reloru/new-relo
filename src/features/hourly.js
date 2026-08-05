// The full multi-day hourly table. Reuses the cached NWS hourly data — the
// only surface that shows all 48 periods; everything else slices to 12.

import { T, canonicalFor, hreflangTags, translateConditions,
         translateWind, translateDir, ES_NWS_NOTE } from "../i18n.js";
import { esc, fullTime, clockTime, hourLabel, dayLabel, capFirst, iconUrl } from "../lib/format.js";
import { BASE_CSS } from "../assets/base-css.js";
import { topbar, footer } from "../chrome.js";
import { JSONLD_SITE, OG_COMMON } from "../seo.js";
import { pop, feelsLikeRawF, sunTimesForCtDate } from "../lib/derived.js";

// Full multi-day hourly forecast (the cache holds 48h; the homepage shows 12).
// Rows are grouped by day. Reuses the NWS hourly data already in KV.
export function hourlyHtml(data, lang) {
  const hours = data.hourly ?? [];
  const groups = [];
  for (const h of hours) {
    const day = dayLabel(h.startTime, lang);
    let g = groups[groups.length - 1];
    if (!g || g.day !== day) {
      g = { day, rows: [] };
      groups.push(g);
    }
    g.rows.push(h);
  }
  const body = groups
    .map((g) => {
      const rows = g.rows
        .map((h) => {
          const feels = feelsLikeRawF(h);
          return `<tr>
        <td>${esc(hourLabel(h.startTime, lang))}</td>
        <td><span class="cond">${h.icon ? `<img src="${iconUrl(h.icon, "small")}" alt="${esc(translateConditions(h.shortForecast, lang))}" width="32" height="32" loading="lazy">` : ""}<span>${esc(translateConditions(h.shortForecast, lang))}</span></span></td>
        <td class="num">${esc(h.temperature)}&deg;<span class="tunit">${esc(h.temperatureUnit)}</span>${feels != null ? `<span class="feels-inline"> (${esc(feels)}°)</span>` : ""}</td>
        <td class="num feels-col">${feels != null ? esc(feels) + "°" : "–"}</td>
        <td class="num${pop(h) >= 30 ? " wet" : ""}">${pop(h)}%</td>
        <td class="wind">${esc(translateWind(h.windSpeed, lang))} ${esc(translateDir(h.windDirection, lang))}</td>
      </tr>`;
        })
        .join("\n");
      const sun = sunTimesForCtDate(Date.parse(g.rows[0].startTime));
      const sunLine = sun
        ? ` <span class="day-sun">${T(lang, "Sunrise", "Amanecer")} ${esc(clockTime(sun.sunrise, lang))} &middot; ${T(lang, "Sunset", "Atardecer")} ${esc(clockTime(sun.sunset, lang))}</span>`
        : "";
      return `  <section class="day">
    <h2>${esc(capFirst(g.day))}${sunLine}</h2>
    <table>
      <thead><tr><th scope="col" class="c-time">${T(lang, "Time", "Hora")}</th><th scope="col" class="c-cond">${T(lang, "Conditions", "Condiciones")}</th><th scope="col" class="num c-temp">${T(lang, "Temp", "Temp")}</th><th scope="col" class="num c-feels feels-col">${T(lang, "Feels", "Sensación")}</th><th scope="col" class="num c-rain">${T(lang, "Rain", "Lluvia")}</th><th scope="col" class="c-wind">${T(lang, "Wind", "Viento")}</th></tr></thead>
      <tbody>
${rows}
      </tbody>
    </table>
  </section>`;
    })
    .join("\n");
  return `<!DOCTYPE html>
<html lang="${T(lang, "en", "es-MX")}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${T(lang, "Crosby, TX Hourly Forecast", "Pronóstico por hora de Crosby, TX")} &mdash; crosbynews.com</title>
<meta name="description" content="${T(lang, "Hour-by-hour weather forecast for Crosby, Texas for the next two days, from the U.S. National Weather Service: temperature, conditions, precipitation chance, and wind.", "Pronóstico del tiempo hora por hora para Crosby, Texas para los próximos dos días, del Servicio Meteorológico Nacional de EE. UU.: temperatura, condiciones, probabilidad de lluvia y viento.")}">
<meta name="theme-color" content="#0b3d61">
<meta property="og:title" content="${T(lang, "Crosby, TX Hourly Forecast", "Pronóstico por hora de Crosby, TX")}">
<meta property="og:description" content="${T(lang, "Hour-by-hour forecast for Crosby, Texas from the National Weather Service.", "Pronóstico hora por hora para Crosby, Texas del Servicio Meteorológico Nacional.")}">
<meta property="og:type" content="website">
<meta property="og:url" content="${canonicalFor("/hourly", lang)}">
${OG_COMMON}
<link rel="canonical" href="${canonicalFor("/hourly", lang)}">
${hreflangTags("/hourly")}
${JSONLD_SITE}
<link rel="manifest" href="/manifest.json">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="alternate icon" href="/favicon.ico">
<style>${BASE_CSS}
  .day { margin-top:1rem; background:var(--card); border-radius:12px; padding:0.5rem 0.9rem 0.9rem; box-shadow:0 1px 3px rgba(0,0,0,0.07); overflow-x:auto; }
  .day h2 { font-size:1.05rem; }
  .day-sun { font-weight:400; font-size:0.78rem; color:var(--muted); margin-left:0.5rem; white-space:nowrap; }
  /* Fixed layout + shared column widths: every day's table gets IDENTICAL
     columns (they line up down the page), long condition names wrap whole at
     spaces inside their known-width column (no hyphenation needed), and wind
     stays on one line. Widths sum to 100%. */
  table { width:100%; border-collapse:collapse; font-size:0.9rem; table-layout:fixed; }
  .c-time { width:9%; } .c-cond { width:39%; } .c-temp { width:11%; } .c-feels { width:12%; } .c-rain { width:9%; } .c-wind { width:20%; }
  th, td { text-align:left; padding:0.4rem 0.5rem; border-bottom:1px solid var(--line); vertical-align:middle; }
  th { font-size:0.78rem; text-transform:uppercase; letter-spacing:0.03em; color:var(--muted); }
  td img { vertical-align:middle; border-radius:4px; }
  /* Keep conditions text beside the icon — as plain inline content, a wrapped
     second word drops UNDER the icon on narrow (portrait phone) screens. */
  .cond { display:flex; align-items:center; gap:0.45rem; }
  .cond img { flex:none; }
  .num { text-align:right; white-space:nowrap; }
  .wet { color:var(--accent); font-weight:700; }
  .wind { color:var(--muted); white-space:nowrap; }
  /* "(88°)" feels-like inline in the Temp cell is a phone-only rendering. */
  .feels-inline { display:none; }
  .feels-note { display:none; font-size:0.8rem; }
  tr:last-child td { border-bottom:none; }
  @media (max-width:600px) {
    .day { padding:0.5rem 0.6rem 0.7rem; }
    table { font-size:0.84rem; }
    th, td { padding:0.35rem 0.2rem; }
    th { letter-spacing:0.01em; font-size:0.66rem; }
    .cond { gap:0.3rem; }
    .cond img { width:22px; height:22px; }
    /* Phones: fold the Feels column into Temp ("82° (88°)") so five roomy
       columns replace six cramped ones — full-word headers, aligned days. */
    .feels-col { display:none; }
    .feels-inline { display:inline; }
    .feels-note { display:block; }
    .tunit { display:none; }
    .c-time { width:10%; } .c-cond { width:34%; } .c-temp { width:19%; } .c-rain { width:12%; } .c-wind { width:25%; }
    /* Gutters so adjacent headers/columns can't visually run together
       (HORA|CONDICIONES and the right-aligned Rain against Wind). */
    th.c-cond { padding-left:0.5rem; }
    th.c-wind, td.wind { padding-left:0.4rem; }
    td.num { padding-left:0.35rem; }
    .wind { white-space:normal; }
  }
  .intro { color:var(--muted); margin:0.6rem 0 0; }
</style>
</head>
<body>
${topbar("/hourly", lang)}
<main id="main">
  <h1>${T(lang, "Crosby, TX Hourly Forecast", "Pronóstico por hora de Crosby, TX")}</h1>
  <p class="intro">${T(lang, `Hour-by-hour forecast for Crosby, Texas from the U.S. National Weather Service, covering the next ${hours.length} hours. Updated ${esc(fullTime(data.updated))} CT.`, `Pronóstico hora por hora para Crosby, Texas del Servicio Meteorológico Nacional de EE. UU., para las próximas ${hours.length} horas. Actualizado ${esc(fullTime(data.updated, lang))} CT.`)}</p>
  ${lang === "es" ? `<p class="intro nws-note">${ES_NWS_NOTE}</p>` : ""}
  <p class="intro feels-note">${T(lang, "Temp shows the “feels like” temperature in parentheses.", "La temperatura muestra la sensación térmica entre paréntesis.")}</p>
${body || `<p class="none">${T(lang, "Hourly forecast is temporarily unavailable.", "El pronóstico por hora no está disponible temporalmente.")}</p>`}
  <p class="intro"><a href="${lang === "es" ? "/es/weather" : "/weather"}">&larr; ${T(lang, "Back to the forecast", "Volver al pronóstico")}</a> &middot; <a href="${lang === "es" ? "/es/radar" : "/radar"}">Radar</a></p>
</main>
${footer({ page: "/hourly", lang, source: T(lang, `Data from the U.S. National Weather Service (<a href="https://weather.gov">weather.gov</a>).`, `Datos del Servicio Meteorológico Nacional de EE. UU. (<a href="https://weather.gov">weather.gov</a>).`), data })}
</body>
</html>`;
}

export function hourlyMarkdown(data, lang) {
  const hours = data.hourly ?? [];
  const out = [
    `# ${T(lang, "Crosby, TX Hourly Forecast", "Pronóstico por hora de Crosby, TX")}`,
    "",
    `_${T(lang, `Hour-by-hour forecast for Crosby, Texas (next ${hours.length} hours) — source: U.S. National Weather Service. Updated ${fullTime(data.updated)} CT.`, `Pronóstico hora por hora para Crosby, Texas (próximas ${hours.length} horas) — fuente: Servicio Meteorológico Nacional de EE. UU. Actualizado ${fullTime(data.updated, lang)} CT.`)}_`,
    "",
  ];
  let curDay = "";
  for (const h of hours) {
    const day = dayLabel(h.startTime, lang);
    if (day !== curDay) {
      curDay = day;
      const sun = sunTimesForCtDate(Date.parse(h.startTime));
      out.push(`## ${capFirst(day)}`, "");
      if (sun) out.push(`_${T(lang, "Sunrise", "Amanecer")} ${clockTime(sun.sunrise, lang)} · ${T(lang, "Sunset", "Atardecer")} ${clockTime(sun.sunset, lang)}_`, "");
      out.push(T(lang, "| Time | Conditions | Temp | Feels | Rain | Wind |", "| Hora | Condiciones | Temp | Sensación | Lluvia | Viento |"), "| --- | --- | --- | --- | --- | --- |");
    }
    const cell = (s) => String(s ?? "").replace(/\|/g, "/");
    const feels = feelsLikeRawF(h);
    out.push(`| ${hourLabel(h.startTime, lang)} | ${cell(translateConditions(h.shortForecast, lang))} | ${h.temperature}°${h.temperatureUnit} | ${feels != null ? feels + "°" : "–"} | ${pop(h)}% | ${cell(translateWind(h.windSpeed, lang))} ${cell(translateDir(h.windDirection, lang))} |`);
  }
  out.push("", "---", `[crosbynews.com](${canonicalFor("/", lang)}) · [${T(lang, "forecast", "pronóstico")}](${canonicalFor("/weather", lang)}) · [radar](${canonicalFor("/radar", lang)})`);
  return out.join("\n");
}
