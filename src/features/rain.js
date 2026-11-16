// Rain measured at the USGS weather station on the Lake Houston dam (site
// 08072000), about 5 miles west of Crosby: the site's measured-rain record.
//
// USGS publishes rain as the amount that fell in each 15-minute interval
// ("decumulated"), provisional until reviewed. The cron files every interval
// in D1 (`rain_readings`, written by recordRain() in src/record.js); every
// total on the page is a sum of those amounts taken at request time, and a day
// missing intervals is marked, so a gap in the feed never reads as a dry day.
// The history before the cron began was loaded by scripts/backfill-rain.mjs.

import { T, canonicalFor, hreflangTags, esPath } from "../i18n.js";
import { esc, fmt, dateStamp } from "../lib/format.js";
import { BASE_CSS } from "../assets/base-css.js";
import { topbar, footer } from "../chrome.js";
import { JSONLD_SITE, sharedHead } from "../seo.js";
import { SITE } from "../config.js";
import { pageFor } from "../registry.js";
import { rainDay } from "../record.js";
import { fetchUsgsOgc } from "./fishing.js";

export const RAIN_STATION = "08072000";
// The station's primary precipitation series ("Weather Station"); a second
// series began 2026-07-13 and is not used.
export const RAIN_SERIES = "c6f1f52bc09c4f81b4a3f99122eff49c";
export const RAIN_STATION_URL = "https://waterdata.usgs.gov/monitoring-location/USGS-08072000/";
const PATH = "/rain";
const MAX_PAGES = 20;
// A 15-minute amount above this is a sensor error, not rain: the station's
// provisional feed carries a 1,310.7 in reading on 2026-05-27. It is left out,
// so its day shows as incomplete rather than absurd.
export const RAIN_MAX_15MIN = 8;

// Every 15-minute reading between two instants, following the API's `next`
// links. Returns [{ at, inches, approval }] with null amounts left out.
export async function fetchRainReadings(env, startIso, endIso) {
  // An empty or backwards window costs a request and returns nothing.
  if (!(Date.parse(endIso) > Date.parse(startIso))) return [];
  let url =
    `https://api.waterdata.usgs.gov/ogcapi/v0/collections/continuous/items?monitoring_location_id=USGS-${RAIN_STATION}` +
    `&parameter_code=00045&time_series_id=${RAIN_SERIES}&datetime=${encodeURIComponent(`${startIso}/${endIso}`)}&f=json&limit=10000`;
  const out = [];
  for (let page = 0; url && page < MAX_PAGES; page++) {
    const d = await (await fetchUsgsOgc(url, env)).json();
    for (const f of d.features || []) {
      const p = f?.properties || {};
      const at = Date.parse(p.time || "");
      const v = p.value === null || p.value === undefined || p.value === "" ? NaN : Number(p.value);
      if (!Number.isFinite(at) || !Number.isFinite(v) || v < 0 || v > RAIN_MAX_15MIN) continue;
      out.push({ at: new Date(at).toISOString(), inches: v, approval: p.approval_status ?? null });
    }
    url = (d.links || []).find((l) => l.rel === "next")?.href || null;
  }
  return out;
}

// How many 15-minute readings a whole Central day holds: 96, except the
// spring-forward Sunday (92) and the fall-back Sunday (100), under the US rule
// in force since 2007 (second Sunday of March, first Sunday of November).
export function expectedReadings(day) {
  const [y, m, d] = day.split("-").map(Number);
  const sunday = (month, nth) => {
    const first = new Date(Date.UTC(y, month - 1, 1)).getUTCDay();
    return 1 + ((7 - first) % 7) + 7 * (nth - 1);
  };
  if (m === 3 && d === sunday(3, 2)) return 92;
  if (m === 11 && d === sunday(11, 1)) return 100;
  return 96;
}

const rows = (db, sql, ...args) => db.prepare(sql).bind(...args).all().then((r) => r.results || []);
const DAILY = `SELECT day, SUM(inches) AS total, COUNT(*) AS n, MAX(inches) AS peak FROM rain_readings WHERE station = ? GROUP BY day`;

export async function loadRain(env) {
  if (!env.DB) throw new Error("the rain record is not available");
  const s = RAIN_STATION;
  const [latest, daily, months, wettest, since] = await Promise.all([
    rows(env.DB, "SELECT at FROM rain_readings WHERE station = ? ORDER BY at DESC LIMIT 1", s),
    rows(env.DB, `${DAILY} ORDER BY day DESC LIMIT 31`, s),
    rows(env.DB, `WITH d AS (${DAILY}) SELECT substr(day, 1, 7) AS month, SUM(total) AS total, SUM(total >= 0.01) AS rainDays, MAX(total) AS wettest, COUNT(*) AS days, GROUP_CONCAT(day || ':' || n) AS counts FROM d GROUP BY month ORDER BY month DESC`, s),
    rows(env.DB, `${DAILY} ORDER BY total DESC, day DESC LIMIT 10`, s),
    rows(env.DB, "SELECT MIN(day) AS first FROM rain_readings WHERE station = ?", s),
  ]);
  const last = latest[0]?.at ?? null;
  let window = { hour: null, day: null, today: null, todayDay: null };
  if (last) {
    const t = Date.parse(last);
    const todayDay = rainDay(last);
    const [h, d, td] = await Promise.all([
      rows(env.DB, "SELECT SUM(inches) AS s, COUNT(*) AS n FROM rain_readings WHERE station = ? AND at > ? AND at <= ?", s, new Date(t - 3600e3).toISOString(), last),
      rows(env.DB, "SELECT SUM(inches) AS s, COUNT(*) AS n FROM rain_readings WHERE station = ? AND at > ? AND at <= ?", s, new Date(t - 86400e3).toISOString(), last),
      rows(env.DB, "SELECT SUM(inches) AS s, COUNT(*) AS n FROM rain_readings WHERE station = ? AND day = ?", s, todayDay),
    ]);
    window = { hour: h[0], day: d[0], today: td[0], todayDay };
  }
  const incomplete = (day, n) => n < expectedReadings(day);
  return {
    last,
    window,
    since: since[0]?.first ?? null,
    daily: daily.map((r) => ({ ...r, incomplete: incomplete(r.day, r.n) })),
    months: months.map((m) => {
      const missing = String(m.counts || "").split(",").filter(Boolean).filter((x) => { const [day, n] = x.split(":"); return incomplete(day, Number(n)); }).length;
      return { month: m.month, total: m.total, rainDays: m.rainDays, wettest: m.wettest, days: m.days, missing };
    }),
    wettest: wettest.filter((r) => r.total > 0).map((r) => ({ ...r, incomplete: incomplete(r.day, r.n) })),
    updated: last,
  };
}

export async function rainLastmod(env) {
  if (!env.DB) return null;
  return (await rows(env.DB, "SELECT MAX(at) AS last FROM rain_readings WHERE station = ?", RAIN_STATION))[0]?.last ?? null;
}

// --- shared content ---------------------------------------------------------

const inch = (x) => `${(Math.round((x ?? 0) * 100) / 100).toFixed(2)} in`;
const loc = (lang) => (lang === "es" ? "es-MX" : "en-US");
const dayText = (day, lang) => new Date(`${day}T12:00:00Z`).toLocaleDateString(loc(lang), { timeZone: "UTC", weekday: "short", month: "short", day: "numeric", year: "numeric" });
const monthText = (m, lang) => {
  const s = new Date(`${m}-15T12:00:00Z`).toLocaleDateString(loc(lang), { timeZone: "UTC", month: "long", year: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const daysInMonth = (m) => { const [y, mo] = m.split("-").map(Number); return new Date(Date.UTC(y, mo, 0)).getUTCDate(); };

function intro(d, lang) {
  return T(
    lang,
    `Rain measured by the U.S. Geological Survey's weather station at the Lake Houston dam, about 5 miles west of Crosby, every 15 minutes since ${d.since ? dayText(d.since, lang) : "it began"}.`,
    `Lluvia medida por la estación meteorológica del Servicio Geológico de EE. UU. en la presa de Lake Houston, a unos 8 km al oeste de Crosby, cada 15 minutos desde el ${d.since ? dayText(d.since, lang) : "inicio"}.`,
  );
}

function notes(lang) {
  return [
    T(lang, "Every total here is the sum of the 15-minute amounts USGS publishes. USGS marks recent readings provisional; they can be revised after review, and the site re-reads the last 35 days each day.", "Cada total aquí es la suma de las cantidades de 15 minutos que publica el USGS. El USGS marca las lecturas recientes como provisionales; pueden revisarse, y el sitio vuelve a leer los últimos 35 días cada día."),
    T(lang, "A day marked incomplete is missing some of its 15-minute readings, so its total may be low; it is not evidence that no rain fell.", "Un día marcado como incompleto carece de algunas lecturas de 15 minutos, así que su total puede ser bajo; no prueba que no haya llovido."),
    T(lang, "A 15-minute amount over 8 inches is treated as a sensor error and left out, which marks its day incomplete.", "Una cantidad de más de 8 pulgadas en 15 minutos se trata como error del sensor y se omite, lo que marca su día como incompleto."),
    T(lang, "Rain varies over short distances: a storm can drop far more or less in Crosby than at the dam.", "La lluvia varía en distancias cortas: una tormenta puede dejar mucho más o mucho menos en Crosby que en la presa."),
    T(lang, "A rain day is a day with at least 0.01 in.", "Un día de lluvia es un día con al menos 0.01 in."),
  ];
}

const windowRow = (label, w) => (w && w.n ? { label, value: inch(w.s) } : { label, value: "—" });

// --- HTML ---------------------------------------------------------------------

export function rainHtml(d, lang) {
  const page = pageFor(PATH);
  const href = (p) => (lang === "es" ? esPath(p) : p);
  const title = T(lang, "Crosby, TX Rainfall Record", "Registro de lluvia de Crosby, TX");
  const desc = T(lang, page.desc.en, page.desc.es);
  const w = d.window;
  const live = d.last
    ? [
        windowRow(T(lang, "Last hour", "Última hora"), w.hour),
        windowRow(T(lang, "Last 24 hours", "Últimas 24 horas"), w.day),
        windowRow(T(lang, `${dayText(w.todayDay, lang)} so far`, `${dayText(w.todayDay, lang)} hasta ahora`), w.today),
      ]
    : [];
  const flag = (r) => (r.incomplete ? ` <span class="inc">${T(lang, "(incomplete)", "(incompleto)")}</span>` : "");

  return `<!DOCTYPE html>
<html lang="${T(lang, "en", "es-MX")}">
<head>
<meta charset="utf-8">
<title>${esc(title)} &mdash; crosbynews.com</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${canonicalFor(PATH, lang)}">
${sharedHead(lang)}
<link rel="canonical" href="${canonicalFor(PATH, lang)}">
${hreflangTags(PATH)}
${JSONLD_SITE}
<style>${BASE_CSS}
  .lede { margin:0.7rem 0 0; font-size:1.02rem; }
  .intro { color:var(--muted); margin:0.6rem 0 0; }
  .now { background:var(--card); border-radius:12px; padding:0.85rem 1rem; box-shadow:0 1px 3px rgba(0,0,0,0.07); margin-top:1rem; }
  .now h2 { margin:0 0 0.4rem; font-size:1rem; }
  .now dl { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:0.5rem 1rem; margin:0; }
  .now dt { font-size:0.82rem; color:var(--muted); }
  .now dd { margin:0; font-size:1.5rem; font-weight:800; }
  .now .meta { margin:0.5rem 0 0; font-size:0.82rem; color:var(--muted); }
  .tbl-wrap { overflow-x:auto; margin-top:0.5rem; }
  .tbl { border-collapse:collapse; font-size:0.88rem; width:100%; }
  .tbl th, .tbl td { border:1px solid var(--line); padding:0.35rem 0.55rem; text-align:left; vertical-align:top; }
  .tbl th { background:var(--card); }
  .tbl .num { white-space:nowrap; }
  .inc { color:var(--muted); font-size:0.8rem; }
  .notes { font-size:0.88rem; padding-left:1.2rem; }
  .notes li { margin:0.3rem 0; }
</style>
</head>
<body>
${topbar(PATH, lang)}
<main id="main">
  <h1>${esc(title)}</h1>
  <p class="lede">${esc(intro(d, lang))}</p>

  <section class="now" data-nosnippet>
    <h2>${T(lang, "Latest", "Lo más reciente")}</h2>
    ${
      d.last
        ? `<dl>
${live.map((x) => `      <div><dt>${esc(x.label)}</dt><dd>${esc(x.value)}</dd></div>`).join("\n")}
    </dl>
    <p class="meta">${T(lang, "Through the reading of", "Hasta la lectura de")} ${dateStamp(d.last, lang)}. ${T(lang, "Provisional USGS data.", "Datos provisionales del USGS.")}</p>`
        : `<p class="none">${T(lang, "No readings recorded yet.", "Aún no hay lecturas registradas.")}</p>`
    }
  </section>

  <h2>${T(lang, "Rain by month", "Lluvia por mes")}</h2>
  ${
    d.months.length
      ? `<div class="tbl-wrap"><table class="tbl">
    <thead><tr><th>${T(lang, "Month", "Mes")}</th><th>${T(lang, "Total", "Total")}</th><th>${T(lang, "Rain days", "Días de lluvia")}</th><th>${T(lang, "Wettest day", "Día más lluvioso")}</th><th>${T(lang, "Days recorded", "Días registrados")}</th></tr></thead>
    <tbody>
${d.months.map((m) => `      <tr><td>${esc(monthText(m.month, lang))}</td><td class="num">${esc(inch(m.total))}</td><td class="num">${esc(m.rainDays)}</td><td class="num">${esc(inch(m.wettest))}</td><td class="num">${esc(`${m.days} / ${daysInMonth(m.month)}`)}${m.missing ? ` <span class="inc">${esc(T(lang, `(${m.missing} incomplete)`, `(${m.missing} incompletos)`))}</span>` : ""}</td></tr>`).join("\n")}
    </tbody>
  </table></div>`
      : `<p class="none">${T(lang, "No readings recorded yet.", "Aún no hay lecturas registradas.")}</p>`
  }

  ${
    d.wettest.length
      ? `<h2>${T(lang, "Wettest days on record", "Días más lluviosos del registro")}</h2>
  <div class="tbl-wrap"><table class="tbl">
    <thead><tr><th>#</th><th>${T(lang, "Day", "Día")}</th><th>${T(lang, "Total", "Total")}</th><th>${T(lang, "Heaviest 15 minutes", "15 minutos más intensos")}</th></tr></thead>
    <tbody>
${d.wettest.map((r, i) => `      <tr><td>${i + 1}</td><td><time datetime="${esc(r.day)}">${esc(dayText(r.day, lang))}</time>${flag(r)}</td><td class="num">${esc(inch(r.total))}</td><td class="num">${esc(inch(r.peak))}</td></tr>`).join("\n")}
    </tbody>
  </table></div>`
      : ""
  }

  ${
    d.daily.length
      ? `<h2>${T(lang, "The last 31 days", "Los últimos 31 días")}</h2>
  <div class="tbl-wrap"><table class="tbl">
    <thead><tr><th>${T(lang, "Day", "Día")}</th><th>${T(lang, "Total", "Total")}</th><th>${T(lang, "Readings", "Lecturas")}</th></tr></thead>
    <tbody>
${d.daily.map((r) => `      <tr><td><time datetime="${esc(r.day)}">${esc(dayText(r.day, lang))}</time>${flag(r)}</td><td class="num">${esc(inch(r.total))}</td><td class="num">${esc(`${r.n} / ${expectedReadings(r.day)}`)}</td></tr>`).join("\n")}
    </tbody>
  </table></div>`
      : ""
  }

  <h2>${T(lang, "About these numbers", "Sobre estas cifras")}</h2>
  <ul class="notes">
${notes(lang).map((n) => `    <li>${esc(n)}</li>`).join("\n")}
  </ul>
  <p class="intro"><a href="${href("/weather")}">${T(lang, "Forecast", "Pronóstico")}</a> &middot; <a href="${href("/water")}">${T(lang, "Water levels", "Niveles de agua")}</a> &middot; <a href="${RAIN_STATION_URL}">${T(lang, "The USGS station", "La estación del USGS")}</a></p>
</main>
${footer({ page: PATH, lang, source: T(lang, `Rain data from the U.S. Geological Survey, station 08072000 (<a href="${RAIN_STATION_URL}">Lake Houston near Sheldon</a>).`, `Datos de lluvia del Servicio Geológico de EE. UU., estación 08072000 (<a href="${RAIN_STATION_URL}">Lake Houston cerca de Sheldon</a>).`) })}
</body>
</html>`;
}

// --- Markdown -----------------------------------------------------------------

export function rainMarkdown(d, lang) {
  const out = [`# ${T(lang, "Crosby, TX Rainfall Record", "Registro de lluvia de Crosby, TX")}`, "", intro(d, lang), ""];
  out.push(`## ${T(lang, "Latest", "Lo más reciente")}`, "");
  if (d.last) {
    const w = d.window;
    for (const x of [windowRow(T(lang, "Last hour", "Última hora"), w.hour), windowRow(T(lang, "Last 24 hours", "Últimas 24 horas"), w.day), windowRow(T(lang, `${dayText(w.todayDay, lang)} so far`, `${dayText(w.todayDay, lang)} hasta ahora`), w.today)]) out.push(`- ${x.label}: ${x.value}`);
    out.push(`- ${T(lang, "Through the reading of", "Hasta la lectura de")} ${fmt(d.last, { dateStyle: "medium", timeStyle: "short" }, lang)} CT (${T(lang, "provisional", "provisional")})`, "");
  } else out.push(T(lang, "No readings recorded yet.", "Aún no hay lecturas registradas."), "");
  const inc = (r) => (r.incomplete ? ` ${T(lang, "(incomplete)", "(incompleto)")}` : "");
  if (d.months.length) {
    out.push(`## ${T(lang, "Rain by month", "Lluvia por mes")}`, "", `| ${T(lang, "Month", "Mes")} | ${T(lang, "Total", "Total")} | ${T(lang, "Rain days", "Días de lluvia")} | ${T(lang, "Wettest day", "Día más lluvioso")} | ${T(lang, "Days recorded", "Días registrados")} |`, "|---|---|---|---|---|");
    for (const m of d.months) out.push(`| ${monthText(m.month, lang)} | ${inch(m.total)} | ${m.rainDays} | ${inch(m.wettest)} | ${m.days} / ${daysInMonth(m.month)}${m.missing ? ` (${m.missing} ${T(lang, "incomplete", "incompletos")})` : ""} |`);
    out.push("");
  }
  if (d.wettest.length) {
    out.push(`## ${T(lang, "Wettest days on record", "Días más lluviosos del registro")}`, "", `| # | ${T(lang, "Day", "Día")} | ${T(lang, "Total", "Total")} | ${T(lang, "Heaviest 15 minutes", "15 minutos más intensos")} |`, "|---|---|---|---|");
    d.wettest.forEach((r, i) => out.push(`| ${i + 1} | ${dayText(r.day, lang)}${inc(r)} | ${inch(r.total)} | ${inch(r.peak)} |`));
    out.push("");
  }
  if (d.daily.length) {
    out.push(`## ${T(lang, "The last 31 days", "Los últimos 31 días")}`, "", `| ${T(lang, "Day", "Día")} | ${T(lang, "Total", "Total")} | ${T(lang, "Readings", "Lecturas")} |`, "|---|---|---|");
    for (const r of d.daily) out.push(`| ${dayText(r.day, lang)}${inc(r)} | ${inch(r.total)} | ${r.n} / ${expectedReadings(r.day)} |`);
    out.push("");
  }
  out.push(`## ${T(lang, "About these numbers", "Sobre estas cifras")}`, "", ...notes(lang).map((n) => `- ${n}`), "");
  out.push("---", `${T(lang, "Rain data from the U.S. Geological Survey, station 08072000 (Lake Houston near Sheldon)", "Datos de lluvia del Servicio Geológico de EE. UU., estación 08072000 (Lake Houston cerca de Sheldon)")}: ${RAIN_STATION_URL} · [crosbynews.com](${SITE}${lang === "es" ? "/es" : "/"})`);
  return out.join("\n");
}
