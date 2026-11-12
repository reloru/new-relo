// /history — the National Weather Service events that covered Crosby, by type
// and year, computed from the record (D1 `nws_events`, `alerts`) at request
// time. Nothing here is hard-coded: every count, first and latest date is a
// query, so the page is right the day a new warning is filed.
//
// One page, deliberately: no page per alert and no page per back-filled year.
// How each scope was collected, and its limits, is in docs/ops/record.md and
// is printed on the page.

import { T, canonicalFor, hreflangTags, esPath } from "../i18n.js";
import { esc, fmt, timeTag } from "../lib/format.js";
import { BASE_CSS } from "../assets/base-css.js";
import { topbar, footer } from "../chrome.js";
import { JSONLD_SITE, sharedHead } from "../seo.js";
import { SITE } from "../config.js";
import { pageFor, gaugePagePath } from "../registry.js";
import { ctDay, RECORD_OBSERVED_FROM, RIVER_WARNINGS_OBSERVED_FROM } from "../record.js";
import { WATER_GAUGES } from "./water.js";

const PATH = "/history";
// The day storm-based (polygon) warnings became the official warned area.
export const POLYGONS_OFFICIAL_FROM = "2007-10-01";
// The current definition of zone TXZ213 ("Inland Harris") took effect then.
const ZONE_REDRAWN = "2026-04-16";
export const ZONE = "TXZ213";
// The polygon warnings counted year by year, in column order.
export const POINT_COLUMNS = ["TO.W", "SV.W", "FF.W", "FA.W", "FA.Y"];

// Hand-written Spanish names for the NWS products in the record, keyed by
// VTEC phenomena.significance. Anything missing falls back to NWS's English
// name, never to a machine translation.
const ES_EVENT = {
  "TO.W": "Aviso de tornado", "TO.A": "Vigilancia de tornado",
  "SV.W": "Aviso de tormenta eléctrica severa", "SV.A": "Vigilancia de tormenta eléctrica severa",
  "FF.W": "Aviso de inundación repentina", "FF.A": "Vigilancia de inundación repentina",
  "FA.W": "Aviso de inundación", "FA.A": "Vigilancia de inundación", "FA.Y": "Advertencia de inundación",
  "FL.W": "Aviso de inundación fluvial", "FL.A": "Vigilancia de inundación fluvial", "FL.Y": "Advertencia de inundación fluvial",
  "HU.W": "Aviso de huracán", "HU.A": "Vigilancia de huracán", "HU.S": "Comunicado de huracán",
  "TR.W": "Aviso de tormenta tropical", "TR.A": "Vigilancia de tormenta tropical", "TI.W": "Aviso de tormenta tropical tierra adentro",
  "SS.W": "Aviso de marejada ciclónica", "SS.A": "Vigilancia de marejada ciclónica",
  "FZ.W": "Aviso de congelación", "FZ.A": "Vigilancia de congelación",
  "HZ.W": "Aviso de congelación severa", "HZ.A": "Vigilancia de congelación severa",
  "WS.W": "Aviso de tormenta invernal", "WS.A": "Vigilancia de tormenta invernal", "WW.Y": "Advertencia de clima invernal",
  "IS.W": "Aviso de tormenta de hielo",
  "WC.W": "Aviso de sensación térmica", "WC.A": "Vigilancia de sensación térmica", "WC.Y": "Advertencia de sensación térmica",
  "EC.W": "Aviso de frío extremo", "EC.A": "Vigilancia de frío extremo", "CW.Y": "Advertencia de clima frío",
  "EH.W": "Aviso de calor excesivo", "EH.A": "Vigilancia de calor excesivo", "XH.W": "Aviso de calor extremo", "XH.A": "Vigilancia de calor extremo",
  "HT.Y": "Advertencia de calor",
  "FW.W": "Aviso de bandera roja", "FW.A": "Vigilancia de clima propicio para incendios",
  "FG.Y": "Advertencia de niebla densa", "WI.Y": "Advertencia de viento", "HW.W": "Aviso de vientos fuertes",
  "CF.W": "Aviso de inundación costera", "CF.A": "Vigilancia de inundación costera", "CF.Y": "Advertencia de inundación costera", "CF.S": "Comunicado de inundación costera",
  "BH.S": "Comunicado de peligros en la playa", "RP.S": "Comunicado de corrientes de resaca",
};
export const eventName = (r, lang) => (lang === "es" ? ES_EVENT[`${r.phenomena}.${r.significance}`] || r.name : r.name);

const SIG_ORDER = ["W", "A", "Y", "S"];
const sigHeading = (sig, lang) =>
  ({
    W: T(lang, "Warnings", "Avisos"),
    A: T(lang, "Watches", "Vigilancias"),
    Y: T(lang, "Advisories", "Advertencias"),
    S: T(lang, "Statements", "Comunicados"),
  })[sig];

// The tags NWS put on a warning when it issued it (IEM's issue_* fields).
const TAG_WORD = {
  "RADAR INDICATED": ["radar indicated", "indicado por radar"],
  OBSERVED: ["observed", "observado"],
  POSSIBLE: ["possible", "posible"],
  CONSIDERABLE: ["considerable", "considerable"],
  DESTRUCTIVE: ["destructive", "destructivo"],
  CATASTROPHIC: ["catastrophic", "catastrófico"],
};
const tagWord = (v, lang) => (TAG_WORD[v] ? TAG_WORD[v][lang === "es" ? 1 : 0] : String(v).toLowerCase());
function tagText(tags, lang) {
  let t = {};
  try {
    t = JSON.parse(tags || "{}") || {};
  } catch {}
  const parts = [];
  if (t.tornado) parts.push(T(lang, `tornado ${tagWord(t.tornado, lang)}`, `tornado ${tagWord(t.tornado, lang)}`));
  if (t.damage) parts.push(T(lang, `${tagWord(t.damage, lang)} damage threat`, `amenaza de daños ${tagWord(t.damage, lang)}`));
  if (typeof t.windMph === "number" && t.windMph > 0) parts.push(T(lang, `winds to ${t.windMph} mph`, `vientos de hasta ${t.windMph} mph`));
  if (typeof t.hailInches === "number" && t.hailInches > 0) parts.push(T(lang, `hail to ${t.hailInches} in`, `granizo de hasta ${t.hailInches} in`));
  return parts.join(", ");
}

const yearOf = (iso) => Number(ctDay(iso).slice(0, 4));
const dateText = (iso, lang) => fmt(iso, { year: "numeric", month: "short", day: "numeric" }, lang);
const dateTime = (iso, lang) => `${fmt(iso, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }, lang)} CT`;
const dayOnly = (day, lang) => new Date(`${day}T12:00:00Z`).toLocaleDateString(lang === "es" ? "es-MX" : "en-US", { timeZone: "UTC", year: "numeric", month: "short", day: "numeric" });
const n = (x, lang) => Number(x).toLocaleString(lang === "es" ? "es-MX" : "en-US");

const rows = (db, sql) => db.prepare(sql).all().then((r) => r.results || []);

export async function loadHistory(env) {
  if (!env.DB) throw new Error("the record is not available");
  const [point, grouped, zoneWarnings, gauges, alerts, newest] = await Promise.all([
    rows(env.DB, "SELECT phenomena, significance, name, issued, tags FROM nws_events WHERE scope = 'point' ORDER BY issued"),
    rows(env.DB, "SELECT scope, phenomena, significance, MAX(name) AS name, COUNT(*) AS n, MIN(issued) AS first, MAX(issued) AS last FROM nws_events WHERE scope IN ('zone', 'county') GROUP BY scope, phenomena, significance ORDER BY n DESC, name"),
    rows(env.DB, "SELECT phenomena, significance, issued FROM nws_events WHERE scope = 'zone' AND significance = 'W' ORDER BY issued"),
    rows(env.DB, "SELECT nwsli, COUNT(*) AS n, MIN(issued) AS first, MAX(issued) AS last FROM nws_events WHERE scope = 'gauge' GROUP BY nwsli ORDER BY n DESC, nwsli"),
    rows(env.DB, "SELECT COUNT(*) AS n, MIN(first_seen) AS first FROM alerts"),
    rows(env.DB, "SELECT MAX(issued) AS last FROM nws_events"),
  ]);
  const scopeFirst = (scope) => grouped.filter((g) => g.scope === scope).map((g) => g.first).sort()[0] || null;
  return {
    point,
    zone: grouped.filter((g) => g.scope === "zone"),
    county: grouped.filter((g) => g.scope === "county"),
    zoneWarnings,
    gauges,
    alertsReceived: alerts[0]?.n ?? 0,
    zoneFirst: scopeFirst("zone"),
    countyFirst: scopeFirst("county"),
    updated: newest[0]?.last ?? null,
  };
}

// For /sitemap.xml: the newest event in the record, the same instant the
// page's Last-Modified carries.
export async function historyLastmod(env) {
  if (!env.DB) return null;
  return (await rows(env.DB, "SELECT MAX(issued) AS last FROM nws_events"))[0]?.last ?? null;
}

// --- content ----------------------------------------------------------------

export function pointBy(d, key) {
  return d.point.filter((r) => `${r.phenomena}.${r.significance}` === key);
}

// "in 2009 (2), 2012 (2), 2017 and 2021 (2)"
function yearList(list, lang) {
  const counts = new Map();
  for (const r of list) counts.set(yearOf(r.issued), (counts.get(yearOf(r.issued)) || 0) + 1);
  const parts = [...counts].map(([y, c]) => (c > 1 ? `${y} (${c})` : String(y)));
  if (parts.length < 2) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} ${T(lang, "and", "y")} ${parts.at(-1)}`;
}

function lede(d, lang) {
  if (!d.point.length && !d.zone.length) return [T(lang, "The record holds no events yet.", "El registro aún no tiene eventos.")];
  const out = [];
  const since = dayOnly(POLYGONS_OFFICIAL_FROM, lang);
  const tor = pointBy(d, "TO.W");
  out.push(
    tor.length
      ? T(
          lang,
          `Since ${since}, the National Weather Service has issued ${tor.length} tornado warning${tor.length === 1 ? "" : "s"} whose warned area included Crosby: in ${yearList(tor, lang)}.`,
          `Desde el ${since}, el Servicio Meteorológico Nacional ha emitido ${tor.length} aviso${tor.length === 1 ? "" : "s"} de tornado cuya zona de aviso incluyó a Crosby: en ${yearList(tor, lang)}.`,
        )
      : T(lang, `Since ${since}, no tornado warning's warned area has included Crosby.`, `Desde el ${since}, ninguna zona de aviso de tornado ha incluido a Crosby.`),
  );
  const sv = pointBy(d, "SV.W").length, ff = pointBy(d, "FF.W").length;
  out.push(
    T(
      lang,
      `In the same period, ${n(sv, lang)} severe thunderstorm warning${sv === 1 ? "" : "s"} and ${n(ff, lang)} flash flood warning${ff === 1 ? "" : "s"} covered Crosby.`,
      `En el mismo periodo, ${n(sv, lang)} aviso${sv === 1 ? "" : "s"} de tormenta eléctrica severa y ${n(ff, lang)} aviso${ff === 1 ? "" : "s"} de inundación repentina cubrieron a Crosby.`,
    ),
  );
  const zw = d.zone.filter((z) => z.significance === "W");
  if (zw.length) {
    // Rare ones (two or fewer) carry their dates: those are the events.
    const items = zw.map((z) => {
      if (z.n > 2) return `${eventName(z, lang)}: ${n(z.n, lang)}`;
      const dates = [...new Set(d.zoneWarnings.filter((w) => w.phenomena === z.phenomena && w.significance === z.significance).map((w) => dateText(w.issued, lang)))];
      return `${eventName(z, lang)}: ${n(z.n, lang)} (${dates.join(T(lang, " and ", " y "))})`;
    });
    out.push(
      T(
        lang,
        `Warnings for forecast zone ${ZONE}, which contains Crosby, since ${dateText(d.zoneFirst, lang)}: ${items.join("; ")}.`,
        `Avisos para la zona de pronóstico ${ZONE}, que contiene a Crosby, desde el ${dateText(d.zoneFirst, lang)}: ${items.join("; ")}.`,
      ),
    );
  }
  return out;
}

export function yearTable(d) {
  const counts = new Map();
  for (const r of d.point) {
    const key = `${r.phenomena}.${r.significance}`;
    if (!POINT_COLUMNS.includes(key)) continue;
    const y = yearOf(r.issued);
    if (!counts.has(y)) counts.set(y, Object.fromEntries(POINT_COLUMNS.map((c) => [c, 0])));
    counts.get(y)[key]++;
  }
  const first = Number(POLYGONS_OFFICIAL_FROM.slice(0, 4));
  const last = Math.max(yearOf(new Date().toISOString()), ...counts.keys());
  const years = [];
  for (let y = last; y >= first; y--) years.push([y, counts.get(y) || Object.fromEntries(POINT_COLUMNS.map((c) => [c, 0]))]);
  const totals = Object.fromEntries(POINT_COLUMNS.map((c) => [c, d.point.filter((r) => `${r.phenomena}.${r.significance}` === c).length]));
  return { years, totals };
}

const columnName = (key, lang) =>
  ({
    "TO.W": T(lang, "Tornado", "Tornado"),
    "SV.W": T(lang, "Severe thunderstorm", "Tormenta severa"),
    "FF.W": T(lang, "Flash flood", "Inundación repentina"),
    "FA.W": T(lang, "Flood warning", "Aviso de inundación"),
    "FA.Y": T(lang, "Flood advisory", "Advertencia de inundación"),
  })[key];

function tagged(d) {
  return d.point.filter((r) => r.phenomena === "SV" && r.significance === "W" && /"damage"/.test(r.tags || ""));
}

const gaugeName = (lid, lang) => {
  const g = WATER_GAUGES.find((x) => x.lid === lid);
  return g ? T(lang, g.en, g.es) : lid;
};

function notes(d, lang) {
  return [
    T(
      lang,
      `Each row is one NWS event as NWS identifies it (office, type and event number), so a warning that was extended or updated counts once. Years are the calendar year, in Central time, the event was issued.`,
      `Cada fila es un evento del NWS tal como el NWS lo identifica (oficina, tipo y número de evento), así que un aviso extendido o actualizado cuenta una vez. Los años son el año calendario, en hora del centro, en que se emitió el evento.`,
    ),
    T(
      lang,
      `Tornado, severe thunderstorm, flash flood and flood warnings are counted when the warning's polygon (the area NWS draws around the threat) contained Crosby's coordinates, from ${dayOnly(POLYGONS_OFFICIAL_FROM, lang)}, the day polygons became the official warned area. Before that a warning covered whole counties, so it would say nothing about Crosby.`,
      `Los avisos de tornado, tormenta severa, inundación repentina e inundación se cuentan cuando el polígono del aviso (el área que el NWS dibuja alrededor de la amenaza) contenía las coordenadas de Crosby, desde el ${dayOnly(POLYGONS_OFFICIAL_FROM, lang)}, el día en que los polígonos se volvieron el área oficial del aviso. Antes, un aviso cubría condados enteros, así que no diría nada sobre Crosby.`,
    ),
    T(
      lang,
      `Zone products (tropical, winter, heat, fire weather, fog) are those issued for forecast zone ${ZONE}. The zone has been redrawn over the years; its current definition, "Inland Harris", took effect ${dayOnly(ZONE_REDRAWN, lang)}, so an older entry covers whatever the zone covered then. The record of them starts ${d.zoneFirst ? dateText(d.zoneFirst, lang) : "—"}.`,
      `Los productos por zona (tropicales, invernales, de calor, de clima propicio para incendios, de niebla) son los emitidos para la zona de pronóstico ${ZONE}. La zona se ha redibujado con los años; su definición actual, "Inland Harris", entró en vigor el ${dayOnly(ZONE_REDRAWN, lang)}, así que un registro anterior cubre lo que la zona cubría entonces. Su registro comienza el ${d.zoneFirst ? dateText(d.zoneFirst, lang) : "—"}.`,
    ),
    T(
      lang,
      `Tornado and severe thunderstorm watches are issued for Harris County as a whole, a very large county; a watch there did not necessarily concern Crosby. Polygon warnings coded to the county are not counted, because most were for another part of it.`,
      `Las vigilancias de tornado y de tormenta severa se emiten para todo el condado de Harris, un condado muy grande; una vigilancia ahí no necesariamente concernía a Crosby. Los avisos de polígono codificados al condado no se cuentan, porque la mayoría eran para otra parte del condado.`,
    ),
    T(
      lang,
      `Tags (tornado radar indicated or observed, damage threat, wind, hail) are what NWS stated when it issued the warning, not what happened.`,
      `Las etiquetas (tornado indicado por radar u observado, amenaza de daños, viento, granizo) son lo que el NWS indicó al emitir el aviso, no lo que ocurrió.`,
    ),
    T(
      lang,
      `Events before this site began recording (${dayOnly(RECORD_OBSERVED_FROM, lang)}; river flood warnings ${dayOnly(RIVER_WARNINGS_OBSERVED_FROM, lang)}) come from the Iowa Environmental Mesonet's archive of NWS products, Iowa State University. Since then this site files what it receives itself${d.alertsReceived ? `: ${n(d.alertsReceived, lang)} alert messages so far` : ""}.`,
      `Los eventos anteriores al inicio del registro de este sitio (${dayOnly(RECORD_OBSERVED_FROM, lang)}; avisos de inundación fluvial ${dayOnly(RIVER_WARNINGS_OBSERVED_FROM, lang)}) provienen del archivo de productos del NWS del Iowa Environmental Mesonet, Universidad Estatal de Iowa. Desde entonces este sitio registra lo que recibe${d.alertsReceived ? `: ${n(d.alertsReceived, lang)} mensajes de alerta hasta ahora` : ""}.`,
    ),
  ];
}

// --- HTML -------------------------------------------------------------------

export function historyHtml(d, lang) {
  const page = pageFor(PATH);
  const href = (p) => (lang === "es" ? esPath(p) : p);
  const title = T(lang, "Crosby, TX Weather Warning History", "Historial de avisos meteorológicos de Crosby, TX");
  const desc = T(lang, page.desc.en, page.desc.es);
  const { years, totals } = yearTable(d);
  const tor = pointBy(d, "TO.W");
  const dmg = tagged(d);

  const groupTable = (list) => `<div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>${T(lang, "Product", "Producto")}</th><th>${T(lang, "Count", "Total")}</th><th>${T(lang, "First", "Primero")}</th><th>${T(lang, "Latest", "Más reciente")}</th></tr></thead>
      <tbody>
${list.map((g) => `        <tr><td>${esc(eventName(g, lang))}</td><td class="num">${esc(n(g.n, lang))}</td><td>${timeTag(g.first, dateText(g.first, lang))}</td><td>${timeTag(g.last, dateText(g.last, lang))}</td></tr>`).join("\n")}
      </tbody>
    </table></div>`;

  const zoneSections = SIG_ORDER.map((sig) => {
    const list = d.zone.filter((z) => z.significance === sig);
    return list.length ? `<h3>${sigHeading(sig, lang)}</h3>\n    ${groupTable(list)}` : "";
  }).join("\n    ");

  const eventList = (list) => `<ul class="events">
${list.map((r) => `      <li>${timeTag(r.issued, dateTime(r.issued, lang))}${tagText(r.tags, lang) ? ` &mdash; ${esc(tagText(r.tags, lang))}` : ""}</li>`).join("\n")}
    </ul>`;

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
  .lede p { margin:0.6rem 0 0; font-size:1.02rem; }
  h3 { font-size:0.98rem; margin:1rem 0 0.3rem; }
  .intro { color:var(--muted); margin:0.6rem 0 0; }
  .tbl-wrap { overflow-x:auto; margin-top:0.5rem; }
  .tbl { border-collapse:collapse; font-size:0.88rem; width:100%; }
  .tbl th, .tbl td { border:1px solid var(--line); padding:0.35rem 0.55rem; text-align:left; vertical-align:top; }
  .tbl th { background:var(--card); }
  .tbl .num { white-space:nowrap; text-align:right; }
  .tbl tfoot td { font-weight:700; }
  .events { padding-left:1.2rem; font-size:0.92rem; }
  .events li { margin:0.25rem 0; }
  .notes { font-size:0.88rem; padding-left:1.2rem; }
  .notes li { margin:0.3rem 0; }
</style>
</head>
<body>
${topbar(PATH, lang)}
<main id="main">
  <h1>${esc(title)}</h1>
  <div class="lede">
${lede(d, lang).map((p) => `    <p>${esc(p)}</p>`).join("\n")}
  </div>

  <h2>${T(lang, "Warnings drawn around Crosby, by year", "Avisos trazados alrededor de Crosby, por año")}</h2>
  <p class="intro">${T(lang, `Warnings whose polygon contained Crosby. A zero is a year with none; ${POLYGONS_OFFICIAL_FROM.slice(0, 4)} counts from ${dayOnly(POLYGONS_OFFICIAL_FROM, lang)}.`, `Avisos cuyo polígono contenía a Crosby. Un cero es un año sin avisos; ${POLYGONS_OFFICIAL_FROM.slice(0, 4)} cuenta desde el ${dayOnly(POLYGONS_OFFICIAL_FROM, lang)}.`)}</p>
  <div class="tbl-wrap"><table class="tbl">
    <thead><tr><th>${T(lang, "Year", "Año")}</th>${POINT_COLUMNS.map((c) => `<th>${columnName(c, lang)}</th>`).join("")}</tr></thead>
    <tbody>
${years.map(([y, c]) => `      <tr><td>${y}</td>${POINT_COLUMNS.map((k) => `<td class="num">${c[k]}</td>`).join("")}</tr>`).join("\n")}
    </tbody>
    <tfoot><tr><td>${T(lang, "Total", "Total")}</td>${POINT_COLUMNS.map((k) => `<td class="num">${esc(n(totals[k], lang))}</td>`).join("")}</tr></tfoot>
  </table></div>

  <h2>${T(lang, "Every tornado warning that included Crosby", "Cada aviso de tornado que incluyó a Crosby")}</h2>
  ${tor.length ? eventList(tor) : `<p class="none">${T(lang, "None in the record.", "Ninguno en el registro.")}</p>`}

  ${
    dmg.length
      ? `<h2>${T(lang, "Severe thunderstorm warnings with a damage threat", "Avisos de tormenta severa con amenaza de daños")}</h2>
  <p class="intro">${T(lang, "Warnings NWS issued with a considerable or destructive damage-threat tag.", "Avisos que el NWS emitió con una etiqueta de amenaza de daños considerable o destructiva.")}</p>
  ${eventList(dmg)}`
      : ""
  }

  <h2>${T(lang, `Zone products for ${ZONE}`, `Productos por zona para ${ZONE}`)}</h2>
  <p class="intro">${T(lang, "Tropical, winter, heat, fire-weather and fog products issued for the forecast zone that contains Crosby.", "Productos tropicales, invernales, de calor, de clima propicio para incendios y de niebla emitidos para la zona de pronóstico que contiene a Crosby.")}</p>
  ${d.zone.length ? zoneSections : `<p class="none">${T(lang, "None in the record.", "Ninguno en el registro.")}</p>`}

  <h2>${T(lang, "Harris County watches", "Vigilancias del condado de Harris")}</h2>
  ${d.county.length ? groupTable(d.county) : `<p class="none">${T(lang, "None in the record.", "Ninguna en el registro.")}</p>`}

  <h2>${T(lang, "River flood warnings for nearby gauges", "Avisos de inundación fluvial para medidores cercanos")}</h2>
  ${
    d.gauges.length
      ? `<div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>${T(lang, "Gauge", "Medidor")}</th><th>${T(lang, "Count", "Total")}</th><th>${T(lang, "First", "Primero")}</th><th>${T(lang, "Latest", "Más reciente")}</th></tr></thead>
      <tbody>
${d.gauges.map((g) => { const p = gaugePagePath(g.nwsli); return `        <tr><td>${p ? `<a href="${href(p)}">${esc(gaugeName(g.nwsli, lang))}</a>` : esc(gaugeName(g.nwsli, lang))}</td><td class="num">${esc(n(g.n, lang))}</td><td>${timeTag(g.first, dateText(g.first, lang))}</td><td>${timeTag(g.last, dateText(g.last, lang))}</td></tr>`; }).join("\n")}
      </tbody>
    </table></div>`
      : `<p class="none">${T(lang, "None in the record.", "Ninguno en el registro.")}</p>`
  }

  <h2>${T(lang, "How this is counted", "Cómo se cuenta")}</h2>
  <ul class="notes">
${notes(d, lang).map((x) => `    <li>${esc(x)}</li>`).join("\n")}
  </ul>
  <p class="intro">${T(lang, `Active alerts are on the <a href="${href("/alerts")}">alerts page</a>; river levels and each gauge's crests on <a href="${href("/water")}">water levels</a>.`, `Las alertas activas están en la <a href="${href("/alerts")}">página de alertas</a>; los niveles de los ríos y las crestas de cada medidor en <a href="${href("/water")}">niveles de agua</a>.`)}</p>
</main>
${footer({ page: PATH, lang, source: T(lang, `Events from the U.S. National Weather Service, as received by this site and, before that, from the <a href="https://mesonet.agron.iastate.edu/">Iowa Environmental Mesonet</a> archive, Iowa State University.`, `Eventos del Servicio Meteorológico Nacional de EE. UU., tal como los recibe este sitio y, antes, del archivo del <a href="https://mesonet.agron.iastate.edu/">Iowa Environmental Mesonet</a>, Universidad Estatal de Iowa.`) })}
</body>
</html>`;
}

// --- Markdown ---------------------------------------------------------------

export function historyMarkdown(d, lang) {
  const { years, totals } = yearTable(d);
  const tor = pointBy(d, "TO.W");
  const dmg = tagged(d);
  const out = [`# ${T(lang, "Crosby, TX Weather Warning History", "Historial de avisos meteorológicos de Crosby, TX")}`, "", ...lede(d, lang).flatMap((p) => [p, ""])];
  out.push(`## ${T(lang, "Warnings drawn around Crosby, by year", "Avisos trazados alrededor de Crosby, por año")}`, "", T(lang, `${POLYGONS_OFFICIAL_FROM.slice(0, 4)} counts from ${dayOnly(POLYGONS_OFFICIAL_FROM, lang)}.`, `${POLYGONS_OFFICIAL_FROM.slice(0, 4)} cuenta desde el ${dayOnly(POLYGONS_OFFICIAL_FROM, lang)}.`), "");
  out.push(`| ${T(lang, "Year", "Año")} | ${POINT_COLUMNS.map((c) => columnName(c, lang)).join(" | ")} |`, `|---|${POINT_COLUMNS.map(() => "---").join("|")}|`);
  for (const [y, c] of years) out.push(`| ${y} | ${POINT_COLUMNS.map((k) => c[k]).join(" | ")} |`);
  out.push(`| ${T(lang, "Total", "Total")} | ${POINT_COLUMNS.map((k) => n(totals[k], lang)).join(" | ")} |`, "");
  const list = (rs) => rs.map((r) => `- ${dateTime(r.issued, lang)}${tagText(r.tags, lang) ? ` — ${tagText(r.tags, lang)}` : ""}`);
  out.push(`## ${T(lang, "Every tornado warning that included Crosby", "Cada aviso de tornado que incluyó a Crosby")}`, "", ...(tor.length ? list(tor) : [T(lang, "None in the record.", "Ninguno en el registro.")]), "");
  if (dmg.length) out.push(`## ${T(lang, "Severe thunderstorm warnings with a damage threat", "Avisos de tormenta severa con amenaza de daños")}`, "", ...list(dmg), "");
  const table = (rs) => [`| ${T(lang, "Product", "Producto")} | ${T(lang, "Count", "Total")} | ${T(lang, "First", "Primero")} | ${T(lang, "Latest", "Más reciente")} |`, "|---|---|---|---|", ...rs.map((g) => `| ${eventName(g, lang)} | ${n(g.n, lang)} | ${dateText(g.first, lang)} | ${dateText(g.last, lang)} |`)];
  out.push(`## ${T(lang, `Zone products for ${ZONE}`, `Productos por zona para ${ZONE}`)}`, "");
  for (const sig of SIG_ORDER) {
    const rs = d.zone.filter((z) => z.significance === sig);
    if (rs.length) out.push(`### ${sigHeading(sig, lang)}`, "", ...table(rs), "");
  }
  if (!d.zone.length) out.push(T(lang, "None in the record.", "Ninguno en el registro."), "");
  out.push(`## ${T(lang, "Harris County watches", "Vigilancias del condado de Harris")}`, "", ...(d.county.length ? table(d.county) : [T(lang, "None in the record.", "Ninguna en el registro.")]), "");
  out.push(`## ${T(lang, "River flood warnings for nearby gauges", "Avisos de inundación fluvial para medidores cercanos")}`, "");
  if (d.gauges.length) {
    out.push(`| ${T(lang, "Gauge", "Medidor")} | ${T(lang, "Count", "Total")} | ${T(lang, "First", "Primero")} | ${T(lang, "Latest", "Más reciente")} |`, "|---|---|---|---|");
    for (const g of d.gauges) {
      const p = gaugePagePath(g.nwsli);
      out.push(`| ${p ? `[${gaugeName(g.nwsli, lang)}](${canonicalFor(p, lang)})` : gaugeName(g.nwsli, lang)} | ${n(g.n, lang)} | ${dateText(g.first, lang)} | ${dateText(g.last, lang)} |`);
    }
  } else out.push(T(lang, "None in the record.", "Ninguno en el registro."));
  out.push("", `## ${T(lang, "How this is counted", "Cómo se cuenta")}`, "", ...notes(d, lang).map((x) => `- ${x}`), "");
  out.push("---", `${T(lang, "Events from the U.S. National Weather Service; archive from the Iowa Environmental Mesonet, Iowa State University.", "Eventos del Servicio Meteorológico Nacional de EE. UU.; archivo del Iowa Environmental Mesonet, Universidad Estatal de Iowa.")} · [crosbynews.com](${SITE}${lang === "es" ? "/es" : "/"})`);
  return out.join("\n");
}
