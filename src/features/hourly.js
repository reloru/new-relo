// The full multi-day hourly table. Reuses the cached NWS hourly data — the
// only surface that shows all 48 periods; everything else slices to 12.

import { T, canonicalFor, hreflangTags, translateConditions,
         translateWind, translateDir, ES_NWS_NOTE } from "../i18n.js";
import { esc, fullTime, clockTime, hourLabel, dayLabel, capFirst, iconUrl, dateStamp } from "../lib/format.js";
import { BASE_CSS } from "../assets/base-css.js";
import { topbar, footer } from "../chrome.js";
import { JSONLD_SITE, sharedHead } from "../seo.js";
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
      return `  <section class="day" data-nosnippet>
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
<title>${T(lang, "Crosby, TX Hourly Forecast", "Pronóstico por hora de Crosby, TX")} &mdash; crosbynews.com</title>
<meta name="description" content="${T(lang, "Hour-by-hour forecast for Crosby, Texas for the next two days from the National Weather Service: temperature, conditions, rain chance, and wind.", "Pronóstico hora por hora para Crosby, Texas para los próximos dos días, del Servicio Meteorológico Nacional: temperatura, condiciones, lluvia y viento.")}">
<meta property="og:title" content="${T(lang, "Crosby, TX Hourly Forecast", "Pronóstico por hora de Crosby, TX")}">
<meta property="og:description" content="${T(lang, "Hour-by-hour forecast for Crosby, Texas from the National Weather Service.", "Pronóstico hora por hora para Crosby, Texas del Servicio Meteorológico Nacional.")}">
<meta property="og:type" content="website">
<meta property="og:url" content="${canonicalFor("/hourly", lang)}">
${sharedHead(lang)}
<link rel="canonical" href="${canonicalFor("/hourly", lang)}">
${hreflangTags("/hourly")}
${JSONLD_SITE}
<style>${BASE_CSS}
  .day { overflow-x:auto; }
  .day-sun { font-family:system-ui,sans-serif; font-weight:400; font-size:0.85rem; color:var(--muted); margin-left:0.5rem; white-space:nowrap; }
  /* Fixed layout and shared widths, so every day's table has the same
     columns and they line up down the page. Widths sum to 100%. */
  table { width:100%; border-collapse:collapse; font-size:0.95rem; table-layout:fixed; }
  .c-time { width:9%; } .c-cond { width:39%; } .c-temp { width:11%; } .c-feels { width:12%; } .c-rain { width:9%; } .c-wind { width:20%; }
  th, td { text-align:left; padding:0.4rem 0.5rem 0.4rem 0; border-bottom:1px solid var(--line); vertical-align:middle; }
  th { font-size:0.85rem; font-weight:400; color:var(--muted); }
  td img { vertical-align:middle; }
  /* The text stays beside the icon: as inline content, a wrapped second word
     drops under the icon on a narrow phone. */
  .cond { display:flex; align-items:center; gap:0.45rem; }
  .cond img { flex:none; }
  .num { text-align:right; white-space:nowrap; }
  .wet { color:var(--link); font-weight:700; }
  .wind { color:var(--muted); white-space:nowrap; padding-left:1rem; }
  th.c-wind { padding-left:1rem; }
  .feels-inline { display:none; }
  .feels-note { display:none; font-size:0.85rem; }
  tr:last-child td { border-bottom:none; }
  @media (max-width:600px) {
    table { font-size:0.84rem; }
    th, td { padding:0.35rem 0.2rem 0.35rem 0; }
    th { font-size:0.75rem; }
    .cond { gap:0.3rem; overflow-wrap:anywhere; }
    .cond img { width:22px; height:22px; }
    /* Phones fold the Feels column into Temp ("82° (88°)"): five roomy
       columns instead of six cramped ones. */
    .feels-col { display:none; }
    .feels-inline { display:inline; }
    .feels-note { display:block; }
    .tunit { display:none; }
    .c-time { width:11%; } .c-cond { width:37%; } .c-temp { width:19%; } .c-rain { width:11%; } .c-wind { width:22%; }
    th.c-wind, td.wind { padding-left:0.5rem; }
    td.num { padding-left:0.35rem; }
    .wind { white-space:normal; }
  }
</style>
</head>
<body>
${topbar("/hourly", lang)}
<main id="main">
  <h1>${T(lang, "Crosby, TX Hourly Forecast", "Pronóstico por hora de Crosby, TX")}</h1>
  <p class="intro">${T(lang, `Hour-by-hour forecast for Crosby, Texas from the U.S. National Weather Service, covering the next ${hours.length} hours. Updated ${dateStamp(data.updated, lang)}.`, `Pronóstico hora por hora para Crosby, Texas del Servicio Meteorológico Nacional de EE. UU., para las próximas ${hours.length} horas. Actualizado ${dateStamp(data.updated, lang)}.`)}</p>
  ${lang === "es" ? `<p class="intro nws-note">${ES_NWS_NOTE}</p>` : ""}
  <p class="intro feels-note">${T(lang, "Temp shows the “feels like” temperature in parentheses.", "La temperatura muestra la sensación térmica entre paréntesis.")}</p>
${body || `<p class="none">${T(lang, "Hourly forecast is temporarily unavailable.", "El pronóstico por hora no está disponible temporalmente.")}</p>`}
  <p class="intro">${T(lang, "Related:", "Relacionado:")} <a href="${lang === "es" ? "/es/weather" : "/weather"}">${T(lang, "seven-day forecast", "pronóstico de siete días")}</a>, <a href="${lang === "es" ? "/es/radar" : "/radar"}">${T(lang, "radar", "radar")}</a>.</p>
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
