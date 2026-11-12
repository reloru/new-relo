// One page per river gauge: the flood record for that gauge, with the current
// level as its newest entry.
//
// Everything on the page is something a source published or this site
// observed, read at request time:
//   * the current level and today's flood stages — the `water` KV snapshot
//     (NOAA/NWS NWPS), the same reading /water shows;
//   * historic crests and flood-impact statements — NOAA's own lists, filed in
//     D1 by the cron (gauge_crests, gauge_meta);
//   * river flood warnings for the gauge — filed by the cron from NWS's own
//     flood products since RIVER_WARNINGS_OBSERVED_FROM (recordRiverWarnings),
//     and before that from the Iowa Environmental Mesonet's archive
//     (scripts/backfill-nws-events.mjs);
//   * daily highs and lows — this site's own 15-minute readings (gauge_daily).
//
// Crests are compared with TODAY'S flood stages, and the page says so: NWS may
// have used different stages when a crest happened. Crests NOAA marks as on an
// older gauge datum are never compared at all.

import { T, canonicalFor, hreflangTags, esPath } from "../i18n.js";
import { esc, fmt, clockTime, timeTag, dateStamp } from "../lib/format.js";
import { BASE_CSS } from "../assets/base-css.js";
import { topbar, footer } from "../chrome.js";
import { JSONLD_SITE, sharedHead } from "../seo.js";
import { SITE } from "../config.js";
import { pageFor, gaugePagePath } from "../registry.js";
import { FLOOD_RANK_NAME, RIVER_WARNINGS_OBSERVED_FROM, ctDay } from "../record.js";
import { WATER_GAUGES, WATER_STATE_CSS, loadWater, waterState, waterContext, waterCatLabel, nwpsGaugeUrl } from "./water.js";

const STAGE_KEYS = ["action", "minor", "moderate", "major"];
const DAILY_ROWS = 31;
// NOAA dates some crests without a time; they arrive as midnight UTC. Built
// from a string: scripts/check-module-refs.mjs reads regex literals as code.
const DATE_ONLY = new RegExp("T00:00:00(\\.0+)?Z$");

const loc = (lang) => (lang === "es" ? "es-MX" : "en-US");
const ft = (x) => String(Math.round(x * 100) / 100);

function stageName(k, lang) {
  return {
    action: T(lang, "action stage", "etapa de acción"),
    minor: T(lang, "minor flood stage", "etapa de inundación menor"),
    moderate: T(lang, "moderate flood stage", "etapa de inundación moderada"),
    major: T(lang, "major flood stage", "etapa de inundación mayor"),
  }[k];
}

// A crest measured against the flood stages defined today: how far above the
// highest stage it reached, or how far below the lowest. null when the gauge
// defines no stages (or the current snapshot is unavailable).
export function crestVsStages(stage, thresholds, lang) {
  const defined = STAGE_KEYS.filter((k) => typeof thresholds?.[k] === "number").sort((a, b) => thresholds[a] - thresholds[b]);
  if (!defined.length || typeof stage !== "number") return null;
  const reached = defined.filter((k) => stage >= thresholds[k]).at(-1);
  if (reached) {
    const d = Math.round((stage - thresholds[reached]) * 100) / 100;
    return d === 0
      ? T(lang, `at ${stageName(reached, lang)}`, `en la ${stageName(reached, lang)}`)
      : T(lang, `${ft(d)} ft above ${stageName(reached, lang)}`, `${ft(d)} ft por encima de la ${stageName(reached, lang)}`);
  }
  const d = Math.round((thresholds[defined[0]] - stage) * 100) / 100;
  return T(lang, `${ft(d)} ft below ${stageName(defined[0], lang)}`, `${ft(d)} ft por debajo de la ${stageName(defined[0], lang)}`);
}

// A crest's date as NOAA gave it: a calendar date when it carries no time
// (never shifted into Central time, which would move it back a day), else the
// Central date and time.
export function crestWhen(iso, lang) {
  if (DATE_ONLY.test(iso)) {
    const text = new Date(iso).toLocaleDateString(loc(lang), { timeZone: "UTC", year: "numeric", month: "short", day: "numeric" });
    return { text, html: `<time datetime="${iso.slice(0, 10)}">${esc(text)}</time>` };
  }
  const text = `${fmt(iso, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }, lang)} CT`;
  return { text, html: timeTag(iso, text) };
}

// The calendar date a crest belongs to: NOAA's own date for a date-only
// crest, the Central date for one with a time.
export const crestDay = (iso) => (DATE_ONLY.test(iso) ? iso.slice(0, 10) : ctDay(iso));

// NWS's crest statuses (Preliminary, Official, Record), by the letter NWPS
// sends in its `preliminary` field. An unexpected letter is shown as sent.
const CREST_STATUS = { P: ["Preliminary", "Preliminar"], O: ["Official", "Oficial"], R: ["Record", "Récord"] };
export const crestStatus = (code, lang) => (code ? (CREST_STATUS[code] ? CREST_STATUS[code][lang === "es" ? 1 : 0] : code) : "—");

const dayText = (day, lang) => new Date(`${day}T12:00:00Z`).toLocaleDateString(loc(lang), { timeZone: "UTC", weekday: "short", month: "short", day: "numeric", year: "numeric" });
const ctDate = (iso, lang) => fmt(iso, { year: "numeric", month: "short", day: "numeric" }, lang);

// The newest instant the page's content depends on: this gauge's latest
// reading, or a crest NOAA added since. The snapshot's own fetch time is not
// used — it moves every 15 minutes whether or not anything on the page did.
function newest(...isos) {
  const t = isos.map((x) => Date.parse(x ?? "")).filter(Number.isFinite);
  return t.length ? new Date(Math.max(...t)).toISOString() : null;
}

function rows(db, sql, ...args) {
  const st = db.prepare(sql);
  return (args.length ? st.bind(...args) : st).all().then((r) => r.results || []);
}

export async function loadGaugePage(env, lid) {
  const meta = WATER_GAUGES.find((g) => g.lid === lid);
  if (!meta) throw new Error(`unknown gauge ${lid}`);
  if (!env.DB) throw new Error("the flood record is not available");
  const [water, crests, gaugeMeta, warnings, archive, daily, dailyStats, peaks] = await Promise.all([
    loadWater(env),
    rows(env.DB, "SELECT occurred, stage, flow, quality, old_datum FROM gauge_crests WHERE lid = ? ORDER BY stage DESC, occurred DESC", lid),
    rows(env.DB, "SELECT impacts FROM gauge_meta WHERE lid = ?", lid),
    rows(env.DB, "SELECT year, etn, issued, expires FROM nws_events WHERE scope = 'gauge' AND nwsli = ? ORDER BY issued DESC", lid),
    rows(env.DB, "SELECT MIN(issued) AS first FROM nws_events WHERE scope = 'gauge'"),
    rows(env.DB, "SELECT day, max_stage, max_at, min_stage, max_rank, readings FROM gauge_daily WHERE lid = ? ORDER BY day DESC LIMIT ?", lid, DAILY_ROWS),
    rows(env.DB, "SELECT COUNT(*) AS days, MIN(day) AS since FROM gauge_daily WHERE lid = ?", lid),
    rows(env.DB, "SELECT day, flow FROM gauge_peaks WHERE lid = ? AND flow IS NOT NULL", lid),
  ]);
  const gauge = (water.gauges || []).find((g) => g.lid === lid) || null;
  let impacts = [];
  try {
    impacts = JSON.parse(gaugeMeta[0]?.impacts || "[]");
  } catch {}
  // USGS publishes one peak per water year; its flow belongs beside a crest
  // only when the two fall on the same date.
  const usgsFlow = new Map(peaks.map((p) => [p.day, p.flow]));
  const all = crests.map((c) => ({ occurred: c.occurred, stage: c.stage, flow: c.flow, usgsFlow: usgsFlow.get(crestDay(c.occurred)) ?? null, quality: c.quality, oldDatum: !!c.old_datum }));
  return {
    lid,
    page: gaugePagePath(lid),
    names: { en: meta.en, es: meta.es },
    noFlow: !!meta.noFlow,
    gauge,
    crests: all.filter((c) => !c.oldDatum),
    oldCrests: all.filter((c) => c.oldDatum).sort((a, b) => (a.occurred < b.occurred ? 1 : -1)),
    impacts: impacts.filter((i) => typeof i?.stage === "number" && typeof i.statement === "string").sort((a, b) => b.stage - a.stage),
    warnings,
    warningsArchiveFrom: archive[0]?.first ?? null,
    daily,
    dailyDays: dailyStats[0]?.days ?? 0,
    dailySince: dailyStats[0]?.since ?? null,
    updated: newest(gauge?.validTime, ...all.map((c) => c.occurred)),
  };
}

// For /sitemap.xml: the same instant the page's Last-Modified carries, read
// without loading the whole page.
export async function gaugeLastmod(env, lid) {
  const [water, top] = await Promise.all([
    loadWater(env),
    env.DB ? rows(env.DB, "SELECT MAX(occurred) AS last FROM gauge_crests WHERE lid = ?", lid) : [],
  ]);
  return newest((water.gauges || []).find((g) => g.lid === lid)?.validTime, top[0]?.last);
}

// --- shared content ---------------------------------------------------------

function facts(d, lang) {
  const name = T(lang, d.names.en, d.names.es);
  const everything = [...d.crests, ...d.oldCrests];
  const top = d.crests[0];
  const since = everything.length ? Math.min(...everything.map((c) => new Date(c.occurred).getUTCFullYear())) : null;
  const th = d.gauge?.thresholds;
  return { name, everything, top, since, th, hasStages: STAGE_KEYS.some((k) => typeof th?.[k] === "number") };
}

function introText(d, lang) {
  const f = facts(d, lang);
  const parts = [T(lang, `${f.name} is National Weather Service river gauge ${d.lid}.`, `${f.name} es el medidor fluvial ${d.lid} del Servicio Meteorológico Nacional.`)];
  if (!f.everything.length) {
    parts.push(T(lang, "NOAA lists no historic crests for it yet.", "NOAA aún no registra crestas históricas para este medidor."));
    return parts.join(" ");
  }
  const old = d.oldCrests.length;
  parts.push(
    T(
      lang,
      `NOAA lists ${f.everything.length} historic crest${f.everything.length === 1 ? "" : "s"} for it since ${f.since}${old ? `, ${old} of them measured on an older gauge datum` : ""}.`,
      `NOAA registra ${f.everything.length} cresta${f.everything.length === 1 ? "" : "s"} histórica${f.everything.length === 1 ? "" : "s"} desde ${f.since}${old ? `, ${old} de ellas medidas con un datum anterior del medidor` : ""}.`,
    ),
  );
  if (f.top) {
    const vs = crestVsStages(f.top.stage, f.th, lang);
    parts.push(
      T(
        lang,
        `The highest is ${ft(f.top.stage)} ft on ${crestWhen(f.top.occurred, lang).text}${vs ? `, ${vs} as the stages are defined today` : ""}.`,
        `La más alta es de ${ft(f.top.stage)} ft el ${crestWhen(f.top.occurred, lang).text}${vs ? `, ${vs} según las etapas definidas hoy` : ""}.`,
      ),
    );
  }
  return parts.join(" ");
}

function stagesText(d, lang) {
  const th = d.gauge?.thresholds;
  const defined = STAGE_KEYS.filter((k) => typeof th?.[k] === "number");
  if (!d.gauge) return T(lang, "Flood stages are unavailable while the current reading is.", "Las etapas de inundación no están disponibles mientras la lectura actual no lo esté.");
  if (!defined.length) return T(lang, "The National Weather Service defines no flood stages for this gauge.", "El Servicio Meteorológico Nacional no define etapas de inundación para este medidor.");
  return defined.map((k) => `${waterCatLabel(k, lang)}: ${ft(th[k])} ft`).join(" · ");
}

function notes(d, lang) {
  const out = [
    T(
      lang,
      "Crests are compared with the flood stages the National Weather Service defines today. The stages in force when a crest happened may have been different.",
      "Las crestas se comparan con las etapas de inundación que el Servicio Meteorológico Nacional define hoy. Las etapas vigentes cuando ocurrió una cresta pudieron ser distintas.",
    ),
    T(
      lang,
      "A crest shown with a date and no time is one NOAA dates without a time.",
      "Una cresta que aparece con fecha y sin hora es una que NOAA fecha sin hora.",
    ),
    d.noFlow
      ? T(
          lang,
          "NOAA's crest flow is not shown for this gauge: its level is real, but NOAA's flow figure here does not match what USGS measures.",
          "No se muestra el caudal de cresta de NOAA para este medidor: su nivel es real, pero la cifra de caudal de NOAA aquí no coincide con lo que mide el USGS.",
        )
      : T(
          lang,
          "NOAA flow is in cubic feet per second as NOAA publishes it with each crest; a dash means it published none, or zero, which this site treats as unknown.",
          "El caudal NOAA está en pies cúbicos por segundo, como NOAA lo publica con cada cresta; un guion significa que no publicó ninguno, o publicó cero, que este sitio trata como desconocido.",
        ),
    T(
      lang,
      "USGS flow is the annual peak flow USGS publishes for a gauge, shown when that year's peak falls on the crest's date; a dash means it does not.",
      "El caudal USGS es el caudal máximo anual que publica el USGS para un medidor, mostrado cuando el máximo de ese año cae en la fecha de la cresta; un guion significa que no.",
    ),
  ];
  if (d.oldCrests.length) {
    out.push(
      T(
        lang,
        "NOAA marks some crests as measured on an older datum (the reference level the gauge's readings start from). Their numbers cannot be compared with today's readings or flood stages, so they are listed separately and never compared.",
        "NOAA marca algunas crestas como medidas con un datum anterior (el nivel de referencia desde el que parten las lecturas del medidor). Sus cifras no se pueden comparar con las lecturas ni con las etapas de hoy, así que se listan aparte y nunca se comparan.",
      ),
    );
  }
  return out;
}

function warningsText(d, lang) {
  const live = dayText(RIVER_WARNINGS_OBSERVED_FROM, lang);
  const from = d.warningsArchiveFrom ? ctDate(d.warningsArchiveFrom, lang) : null;
  return T(
    lang,
    `Since ${live} this site records river flood warnings itself, from the National Weather Service's own flood products; earlier ones come from the Iowa Environmental Mesonet's archive of NWS products.${from ? ` The earliest river flood warning in the record for any gauge this site tracks is dated ${from}, so no entry before then is not evidence of no flooding.` : ""}`,
    `Desde el ${live} este sitio registra los avisos de inundación fluvial por su cuenta, a partir de los productos de inundación del Servicio Meteorológico Nacional; los anteriores provienen del archivo de productos del NWS del Iowa Environmental Mesonet.${from ? ` El aviso de inundación fluvial más antiguo del registro para los medidores que sigue este sitio es del ${from}, así que la falta de registros antes de esa fecha no prueba que no hubo inundaciones.` : ""}`,
  );
}

function dailyText(d, lang) {
  if (!d.dailyDays) return T(lang, "This site has not recorded a daily reading for this gauge yet.", "Este sitio aún no ha registrado una lectura diaria para este medidor.");
  return T(
    lang,
    `This site's own record: the highest and lowest of the readings it fetches every 15 minutes, by Central day. It began on ${dayText(d.dailySince, lang)} and holds ${d.dailyDays} day${d.dailyDays === 1 ? "" : "s"}${d.dailyDays > DAILY_ROWS ? `; the latest ${DAILY_ROWS} are shown` : ""}.`,
    `El registro propio de este sitio: la lectura más alta y la más baja de las que obtiene cada 15 minutos, por día (hora del centro). Comenzó el ${dayText(d.dailySince, lang)} y tiene ${d.dailyDays} día${d.dailyDays === 1 ? "" : "s"}${d.dailyDays > DAILY_ROWS ? `; se muestran los ${DAILY_ROWS} más recientes` : ""}.`,
  );
}

function rankText(rank, hasStages, lang) {
  if (rank > 0) return waterCatLabel(FLOOD_RANK_NAME[rank], lang);
  return hasStages ? T(lang, "Below action stage", "Debajo de la etapa de acción") : "—";
}

const cfs = (v, lang) => (typeof v === "number" ? v.toLocaleString(loc(lang)) : "—");
const warningId = (w, lang) => T(lang, `No. ${w.etn} of ${w.year}`, `Núm. ${w.etn} de ${w.year}`);

// --- HTML ---------------------------------------------------------------------

export function gaugeHtml(d, lang) {
  const f = facts(d, lang);
  const page = pageFor(d.page);
  const href = (p) => (lang === "es" ? esPath(p) : p);
  const title = T(lang, `${f.name}: Flood History and Current Level`, `${f.name}: historial de inundaciones y nivel actual`);
  const desc = T(lang, page.desc.en, page.desc.es);
  const g = d.gauge;
  const st = g ? waterState(g, lang) : { cls: "w-unknown", label: T(lang, "Unavailable", "No disponible") };
  const ctx = g ? waterContext(g, lang) : "";

  const crestTable = (list, compare) => {
    const usgs = list.some((c) => c.usgsFlow != null);
    return `<div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>#</th><th>${T(lang, "Crest", "Cresta")}</th><th>${T(lang, "Date", "Fecha")}</th>${compare ? `<th>${T(lang, "Against today's flood stages", "Frente a las etapas de hoy")}</th>` : ""}${d.noFlow ? "" : `<th>${T(lang, "NOAA flow (cfs)", "Caudal NOAA (pie³/s)")}</th>`}${usgs ? `<th>${T(lang, "USGS flow (cfs)", "Caudal USGS (pie³/s)")}</th>` : ""}<th>${T(lang, "Status", "Estado")}</th></tr></thead>
      <tbody>
${list
  .map(
    (c, i) =>
      `        <tr><td>${i + 1}</td><td class="num">${esc(ft(c.stage))} ft</td><td>${crestWhen(c.occurred, lang).html}</td>${compare ? `<td>${esc(crestVsStages(c.stage, f.th, lang) ?? "—")}</td>` : ""}${d.noFlow ? "" : `<td class="num">${esc(cfs(c.flow, lang))}</td>`}${usgs ? `<td class="num">${esc(cfs(c.usgsFlow, lang))}</td>` : ""}<td>${esc(crestStatus(c.quality, lang))}</td></tr>`,
  )
  .join("\n")}
      </tbody>
    </table></div>`;
  };

  const crestsSection = d.crests.length
    ? `<h2>${T(lang, "Highest recorded crests", "Crestas más altas registradas")}</h2>
    <p class="intro">${T(lang, `Every crest NOAA lists for this gauge, highest first.`, `Cada cresta que NOAA registra para este medidor, de la más alta a la más baja.`)}</p>
    ${crestTable(d.crests, f.hasStages)}`
    : `<h2>${T(lang, "Recorded crests", "Crestas registradas")}</h2>
    <p class="none">${T(lang, "NOAA lists no historic crests on the gauge's current datum.", "NOAA no registra crestas históricas con el datum actual del medidor.")}</p>`;

  const oldSection = d.oldCrests.length
    ? `<h2>${T(lang, "Crests on an older gauge datum", "Crestas con un datum anterior")}</h2>
    <p class="intro">${T(lang, "Measured against an older reference level, so not comparable with today's readings or flood stages. Newest first.", "Medidas con un nivel de referencia anterior, así que no se pueden comparar con las lecturas ni las etapas de hoy. De la más reciente a la más antigua.")}</p>
    ${crestTable(d.oldCrests, false)}`
    : "";

  const impactsSection = d.impacts.length
    ? `<h2>${T(lang, "What NOAA says happens at each level", "Lo que NOAA indica que ocurre en cada nivel")}</h2>
    ${lang === "es" ? `<p class="intro nws-note">${"Las descripciones de impacto son de NOAA y se muestran en su idioma oficial (inglés)."}</p>` : ""}
    <ul class="impacts">
${d.impacts.map((i) => `      <li><strong>${esc(ft(i.stage))} ft</strong> &mdash; <span lang="en">${esc(i.statement)}</span></li>`).join("\n")}
    </ul>`
    : "";

  const warningsSection = `<h2>${T(lang, "River flood warnings for this gauge", "Avisos de inundación fluvial para este medidor")}</h2>
    ${
      d.warnings.length
        ? `<p class="intro">${T(lang, `${d.warnings.length} in the record, newest first.`, `${d.warnings.length} en el registro, del más reciente al más antiguo.`)}</p>
    <div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>${T(lang, "Issued", "Emitido")}</th><th>${T(lang, "Until", "Hasta")}</th><th>${T(lang, "NWS event", "Evento del NWS")}</th></tr></thead>
      <tbody>
${d.warnings.map((w) => `        <tr><td>${timeTag(w.issued, ctDate(w.issued, lang))}</td><td>${w.expires ? timeTag(w.expires, ctDate(w.expires, lang)) : "—"}</td><td>${esc(warningId(w, lang))}</td></tr>`).join("\n")}
      </tbody>
    </table></div>`
        : `<p class="none">${T(lang, "The record holds no river flood warnings for this gauge.", "El registro no tiene avisos de inundación fluvial para este medidor.")}</p>`
    }
    <p class="note">${esc(warningsText(d, lang))} <a href="${lang === "es" ? "/es/history" : "/history"}">${T(lang, "Every NWS warning for Crosby &rarr;", "Todos los avisos del NWS para Crosby &rarr;")}</a></p>`;

  const dailySection = `<h2>${T(lang, "Daily readings recorded by this site", "Lecturas diarias registradas por este sitio")}</h2>
    <p class="note">${esc(dailyText(d, lang))}</p>
    ${
      d.daily.length
        ? `<div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>${T(lang, "Day", "Día")}</th><th>${T(lang, "High", "Máximo")}</th><th>${T(lang, "Low", "Mínimo")}</th><th>${T(lang, "Highest category", "Categoría más alta")}</th><th>${T(lang, "Readings", "Lecturas")}</th></tr></thead>
      <tbody>
${d.daily
  .map(
    (r) =>
      `        <tr><td><time datetime="${esc(r.day)}">${esc(dayText(r.day, lang))}</time></td><td class="num">${typeof r.max_stage === "number" ? `${esc(ft(r.max_stage))} ft${r.max_at ? ` <span class="at">(${timeTag(r.max_at, clockTime(r.max_at, lang))})</span>` : ""}` : "—"}</td><td class="num">${typeof r.min_stage === "number" ? `${esc(ft(r.min_stage))} ft` : "—"}</td><td>${esc(rankText(r.max_rank, f.hasStages, lang))}</td><td class="num">${esc(r.readings)}</td></tr>`,
  )
  .join("\n")}
      </tbody>
    </table></div>`
        : ""
    }`;

  const breadcrumb = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: T(lang, "Water Levels", "Niveles de agua"), item: canonicalFor("/water", lang) },
      { "@type": "ListItem", position: 2, name: f.name, item: canonicalFor(d.page, lang) },
    ],
  });

  return `<!DOCTYPE html>
<html lang="${T(lang, "en", "es-MX")}">
<head>
<meta charset="utf-8">
<title>${esc(title)} &mdash; crosbynews.com</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${canonicalFor(d.page, lang)}">
${sharedHead(lang)}
<link rel="canonical" href="${canonicalFor(d.page, lang)}">
${hreflangTags(d.page)}
${JSONLD_SITE}
<script type="application/ld+json">${breadcrumb}</script>
<style>${BASE_CSS}
  .crumbs { font-size:0.85rem; color:var(--muted); margin:0; }
  .intro { color:var(--muted); margin:0.6rem 0 0; }
  .lede { margin:0.7rem 0 0; font-size:1.02rem; }
  .now { background:var(--card); border-radius:12px; padding:0.85rem 1rem; box-shadow:0 1px 3px rgba(0,0,0,0.07); border-left:5px solid var(--muted); margin-top:1rem; }
  .now-head { display:flex; justify-content:space-between; align-items:flex-start; gap:0.5rem; }
  .now-head h2 { margin:0; font-size:1rem; }
  .now-stage { margin:0.5rem 0 0; font-size:1.9rem; font-weight:800; line-height:1; }
  .now-stage .u { font-size:0.9rem; font-weight:600; opacity:0.7; }
  .now-meta { margin:0.3rem 0 0; font-size:0.82rem; color:var(--muted); }
  .stages { margin:0.6rem 0 0; font-size:0.9rem; }
${WATER_STATE_CSS}
  .tbl-wrap { overflow-x:auto; margin-top:0.5rem; }
  .tbl { border-collapse:collapse; font-size:0.88rem; width:100%; }
  .tbl th, .tbl td { border:1px solid var(--line); padding:0.35rem 0.55rem; text-align:left; vertical-align:top; }
  .tbl th { background:var(--card); }
  .tbl .num { white-space:nowrap; }
  .tbl .at { color:var(--muted); font-size:0.8rem; }
  .impacts { padding-left:1.2rem; }
  .impacts li { margin:0.35rem 0; }
  .note { font-size:0.85rem; color:var(--muted); margin:0.5rem 0 0; }
  .notes { font-size:0.88rem; padding-left:1.2rem; }
  .notes li { margin:0.3rem 0; }
  .safety { margin-top:1.4rem; font-size:0.85rem; color:var(--muted); border-top:1px solid var(--line); padding-top:0.8rem; }
</style>
</head>
<body>
${topbar(d.page, lang)}
<main id="main">
  <p class="crumbs"><a href="${href("/water")}">${T(lang, "Water Levels", "Niveles de agua")}</a> &rsaquo; ${esc(f.name)}</p>
  <h1>${esc(f.name)}</h1>
  <p class="lede">${esc(introText(d, lang))}</p>

  <section class="now ${st.cls}">
    <div class="now-head">
      <h2>${T(lang, "Current level", "Nivel actual")}</h2>
      <span class="gauge-badge" data-nosnippet>${esc(st.label)}</span>
    </div>
    <div data-nosnippet>
    <p class="now-stage">${g && g.stage != null ? `${esc(ft(g.stage))}<span class="u"> ft</span>` : "&ndash;"}</p>
    <p class="now-meta">${ctx ? `${esc(ctx)} &middot; ` : ""}${g?.validTime ? `${T(lang, "reading of", "lectura de")} ${dateStamp(g.validTime, lang)}` : T(lang, "Current reading unavailable.", "Lectura actual no disponible.")}</p>
    </div>
    <p class="stages">${esc(stagesText(d, lang))}</p>
  </section>

  ${crestsSection}
  ${oldSection}
  ${impactsSection}
  ${warningsSection}
  ${dailySection}

  <h2>${T(lang, "About these numbers", "Sobre estas cifras")}</h2>
  <ul class="notes">
${notes(d, lang).map((n) => `    <li>${esc(n)}</li>`).join("\n")}
  </ul>
  <p class="safety">${T(lang, `In a flood emergency call 911. Never drive or walk into floodwater. The official source for this gauge is <a href="${nwpsGaugeUrl(d.lid)}">NOAA's gauge page</a>; active warnings appear on the <a href="/alerts">alerts page</a>.`, `En una emergencia por inundación llama al 911. Nunca conduzcas ni camines hacia el agua de inundación. La fuente oficial de este medidor es <a href="${nwpsGaugeUrl(d.lid)}">la página del medidor de NOAA</a>; los avisos activos aparecen en la <a href="/es/alerts">página de alertas</a>.`)}</p>
  <p class="intro"><a href="${href("/water")}">&larr; ${T(lang, "All water levels", "Todos los niveles de agua")}</a></p>
</main>
${footer({ page: d.page, lang, source: T(lang, `Levels, flood stages and crests from the NOAA/NWS <a href="https://water.noaa.gov">National Water Prediction Service</a>; river flood warnings from the National Weather Service and, before 2026-11-12, the <a href="https://mesonet.agron.iastate.edu/">Iowa Environmental Mesonet</a>, Iowa State University.`, `Niveles, etapas y crestas del <a href="https://water.noaa.gov">Servicio Nacional de Predicción de Agua</a> de NOAA/NWS; avisos anteriores del <a href="https://mesonet.agron.iastate.edu/">Iowa Environmental Mesonet</a>, Universidad Estatal de Iowa.`) })}
</body>
</html>`;
}

// --- Markdown -----------------------------------------------------------------

export function gaugeMarkdown(d, lang) {
  const f = facts(d, lang);
  const g = d.gauge;
  const out = [`# ${f.name}`, "", `_${T(lang, "Flood history and current level", "Historial de inundaciones y nivel actual")}_`, "", introText(d, lang), ""];
  out.push(`## ${T(lang, "Current level", "Nivel actual")}`, "");
  if (g && g.stage != null) {
    const ctx = waterContext(g, lang);
    out.push(`- **${waterState(g, lang).label}** — ${ft(g.stage)} ft${ctx ? ` (${ctx})` : ""}${g.validTime ? `, ${T(lang, "reading of", "lectura de")} ${fmt(g.validTime, { dateStyle: "medium", timeStyle: "short" }, lang)} CT` : ""}`);
  } else {
    out.push(`- ${T(lang, "Current reading unavailable.", "Lectura actual no disponible.")}`);
  }
  out.push(`- ${stagesText(d, lang)}`, "");

  const crestRows = (list, compare) => {
    const usgs = list.some((c) => c.usgsFlow != null);
    const head = ["#", T(lang, "Crest", "Cresta"), T(lang, "Date", "Fecha"), ...(compare ? [T(lang, "Against today's flood stages", "Frente a las etapas de hoy")] : []), ...(d.noFlow ? [] : [T(lang, "NOAA flow (cfs)", "Caudal NOAA (pie³/s)")]), ...(usgs ? [T(lang, "USGS flow (cfs)", "Caudal USGS (pie³/s)")] : []), T(lang, "Status", "Estado")];
    return [
      `| ${head.join(" | ")} |`,
      `|${head.map(() => "---").join("|")}|`,
      ...list.map((c, i) => `| ${[i + 1, `${ft(c.stage)} ft`, crestWhen(c.occurred, lang).text, ...(compare ? [crestVsStages(c.stage, f.th, lang) ?? "—"] : []), ...(d.noFlow ? [] : [cfs(c.flow, lang)]), ...(usgs ? [cfs(c.usgsFlow, lang)] : []), crestStatus(c.quality, lang)].join(" | ")} |`),
    ];
  };
  if (d.crests.length) {
    out.push(`## ${T(lang, "Highest recorded crests", "Crestas más altas registradas")}`, "", ...crestRows(d.crests, f.hasStages), "");
  } else {
    out.push(`## ${T(lang, "Recorded crests", "Crestas registradas")}`, "", T(lang, "NOAA lists no historic crests on the gauge's current datum.", "NOAA no registra crestas históricas con el datum actual del medidor."), "");
  }
  if (d.oldCrests.length) {
    out.push(`## ${T(lang, "Crests on an older gauge datum", "Crestas con un datum anterior")}`, "", T(lang, "Not comparable with today's readings or flood stages.", "No comparables con las lecturas ni las etapas de hoy."), "", ...crestRows(d.oldCrests, false), "");
  }
  if (d.impacts.length) {
    out.push(`## ${T(lang, "What NOAA says happens at each level", "Lo que NOAA indica que ocurre en cada nivel")}`, "");
    if (lang === "es") out.push("_Las descripciones de impacto son de NOAA y se muestran en su idioma oficial (inglés)._", "");
    for (const i of d.impacts) out.push(`- **${ft(i.stage)} ft** — ${i.statement}`);
    out.push("");
  }
  out.push(`## ${T(lang, "River flood warnings for this gauge", "Avisos de inundación fluvial para este medidor")}`, "");
  if (d.warnings.length) {
    out.push(`| ${T(lang, "Issued", "Emitido")} | ${T(lang, "Until", "Hasta")} | ${T(lang, "NWS event", "Evento del NWS")} |`, "|---|---|---|");
    for (const w of d.warnings) out.push(`| ${ctDate(w.issued, lang)} | ${w.expires ? ctDate(w.expires, lang) : "—"} | ${warningId(w, lang)} |`);
  } else {
    out.push(T(lang, "The record holds no river flood warnings for this gauge.", "El registro no tiene avisos de inundación fluvial para este medidor."));
  }
  out.push("", warningsText(d, lang), "");
  out.push(`## ${T(lang, "Daily readings recorded by this site", "Lecturas diarias registradas por este sitio")}`, "", dailyText(d, lang), "");
  if (d.daily.length) {
    out.push(`| ${T(lang, "Day", "Día")} | ${T(lang, "High", "Máximo")} | ${T(lang, "Low", "Mínimo")} | ${T(lang, "Highest category", "Categoría más alta")} | ${T(lang, "Readings", "Lecturas")} |`, "|---|---|---|---|---|");
    for (const r of d.daily) {
      out.push(`| ${dayText(r.day, lang)} | ${typeof r.max_stage === "number" ? `${ft(r.max_stage)} ft${r.max_at ? ` (${clockTime(r.max_at, lang)})` : ""}` : "—"} | ${typeof r.min_stage === "number" ? `${ft(r.min_stage)} ft` : "—"} | ${rankText(r.max_rank, f.hasStages, lang)} | ${r.readings} |`);
    }
    out.push("");
  }
  out.push(`## ${T(lang, "About these numbers", "Sobre estas cifras")}`, "", ...notes(d, lang).map((n) => `- ${n}`), "");
  out.push(
    "---",
    `${T(lang, "In a flood emergency call 911. Never drive into floodwater.", "En una emergencia por inundación llama al 911. Nunca conduzcas hacia el agua de inundación.")} ${T(lang, "Official gauge", "Medidor oficial")}: ${nwpsGaugeUrl(d.lid)} · ${T(lang, "Data: NOAA/NWS National Water Prediction Service; past warnings from the Iowa Environmental Mesonet, Iowa State University.", "Datos: Servicio Nacional de Predicción de Agua de NOAA/NWS; avisos anteriores del Iowa Environmental Mesonet, Universidad Estatal de Iowa.")} · [${T(lang, "All water levels", "Todos los niveles de agua")}](${SITE}${lang === "es" ? esPath("/water") : "/water"})`,
  );
  return out.join("\n");
}
