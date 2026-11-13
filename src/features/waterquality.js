// Water-quality samples near Crosby: E. coli, dissolved oxygen and clarity
// (Secchi depth) from the Texas Commission on Environmental Quality's
// monitoring stations, as the Water Quality Portal (waterqualitydata.us)
// publishes them. Stored in D1 (`water_samples`, written by
// recordWaterSamples() in src/record.js) and shown on /fishing and on the
// gauge page of the waterway each station samples.
//
// These are dated results published months after the sample, not live
// readings: every value is shown with its sample date, never as "now".
//
// Units are taken from the source. TCEQ's E. coli results since about 2007
// carry the unit "None" in the portal, with TCEQ's own unit in the result
// comment ("TCEQ Unit: MPN/100ml."); that comment is what labels them. Rows
// the portal files under the same names but that are not these measures
// (E. coli holding time in "hours", unitless oxygen counts) are left out.

import { T } from "../i18n.js";
import { esc } from "../lib/format.js";

// `lid` is the river gauge whose page shows the station; null shows it on
// /fishing only.
export const WQ_STATIONS = [
  { id: "TCEQMAIN-11212", en: "Lake Houston at FM 1960 East", es: "Lake Houston en FM 1960 Este", lid: "HSJT2" },
  { id: "TCEQMAIN-11123", en: "Cedar Bayou at FM 1960", es: "Cedar Bayou en FM 1960", lid: "HCDT2" },
  { id: "TCEQMAIN-11120", en: "Cedar Bayou at US 90", es: "Cedar Bayou en US 90", lid: "HCDT2" },
  { id: "TCEQMAIN-22429", en: "Luce Bayou at the Grand Parkway (SH-99)", es: "Luce Bayou en el Grand Parkway (SH-99)", lid: null },
];
export const WQ_STATION_IDS = WQ_STATIONS.map((s) => s.id);
export const wqStationUrl = (id) => `https://www.waterqualitydata.us/provider/STORET/TCEQMAIN/${id}/`;
// The stations that sample a gauge's waterway.
export const stationsForGauge = (lid) => WQ_STATIONS.filter((s) => s.lid === lid).map((s) => s.id);

const CHARACTERISTICS = { "Escherichia coli": "ecoli", Oxygen: "oxygen", "Depth, Secchi disk depth": "clarity" };
const COLUMNS = ["MonitoringLocationIdentifier", "ActivityIdentifier", "ActivityStartDate", "CharacteristicName", "ResultMeasureValue", "ResultMeasure/MeasureUnitCode", "ResultSampleFractionText", "ResultCommentText", "ProjectIdentifier"];

// RFC 4180 CSV: quoted fields may hold commas, quotes ("") and newlines. A row
// whose field count differs from the header's is dropped, so a cut-off
// response comes up short rather than misaligned.
export function parseCsv(text) {
  const rows = [];
  let row = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else q = false;
      } else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [head = [], ...body] = rows.filter((r) => r.length > 1 || r[0]);
  return body.filter((r) => r.length === head.length).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

// A portal row → { station, activity, day, measure, value, unit, project }, or
// null when it is not one of the three measures in a unit we can label.
export function sampleFromRow(r) {
  const measure = CHARACTERISTICS[r.CharacteristicName];
  const value = Number(r.ResultMeasureValue);
  if (!measure || r.ResultMeasureValue === "" || !Number.isFinite(value) || value < 0) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.ActivityStartDate || "") || !r.ActivityIdentifier) return null;
  let unit = (r["ResultMeasure/MeasureUnitCode"] || "").trim();
  if (measure === "ecoli") {
    if (unit === "None" && /TCEQ Unit:\s*MPN\/100ml/i.test(r.ResultCommentText || "")) unit = "MPN/100mL";
    if (!/^(MPN|#)\/100mL$/i.test(unit)) return null;
  } else if (measure === "oxygen") {
    if (unit !== "mg/L" || (r.ResultSampleFractionText && r.ResultSampleFractionText !== "Dissolved")) return null;
  } else if (measure === "clarity") {
    if (unit !== "m" && unit !== "in") return null;
  }
  return {
    station: r.MonitoringLocationIdentifier,
    activity: r.ActivityIdentifier,
    day: r.ActivityStartDate,
    measure,
    value,
    unit,
    project: r.ProjectIdentifier || null,
  };
}

// A sampling activity that carries the same measure more than once, with no
// statistic named, cannot say which value is which. TCEQ's 24-hour oxygen
// deployments publish three such values per activity, on a day whose other
// activities hold single readings, E. coli and clarity. That measure is left
// out for the whole station-day, so a 24-hour value is never set beside a
// single daytime reading; the day's other measures are kept.
export function dropAmbiguous(samples) {
  const perActivity = new Map();
  for (const x of samples) {
    const k = `${x.station}|${x.activity}|${x.measure}`;
    perActivity.set(k, (perActivity.get(k) || 0) + 1);
  }
  const ambiguous = new Set(samples.filter((x) => perActivity.get(`${x.station}|${x.activity}|${x.measure}`) > 1).map((x) => `${x.station}|${x.day}|${x.measure}`));
  return samples.filter((x) => !ambiguous.has(`${x.station}|${x.day}|${x.measure}`));
}

const portalDate = (iso) => `${iso.slice(5, 7)}-${iso.slice(8, 10)}-${iso.slice(0, 4)}`;

// Every sample of the three measures at the given stations since a date. The
// portal states how many results it is sending (Total-Result-Count); a
// response that parses to any other number throws rather than file a partial
// set.
export async function fetchWaterSamples(stationIds = WQ_STATION_IDS, sinceIso = "1960-01-01") {
  const p = new URLSearchParams();
  for (const id of stationIds) p.append("siteid", id);
  for (const c of Object.keys(CHARACTERISTICS)) p.append("characteristicName", c);
  p.set("startDateLo", portalDate(sinceIso));
  p.set("mimeType", "csv");
  p.set("dataProfile", "resultPhysChem");
  const res = await fetch(`https://www.waterqualitydata.us/data/Result/search?${p}`, { headers: { "User-Agent": "crosbynews.com", Accept: "text/csv" } });
  if (!res.ok) throw new Error(`Water Quality Portal: HTTP ${res.status}`);
  const text = await res.text();
  const rows = parseCsv(text);
  const header = (text.split("\n", 1)[0] || "").trim().replaceAll('"', "").split(",");
  const missing = COLUMNS.filter((c) => !header.includes(c));
  if (missing.length) throw new Error(`Water Quality Portal: missing columns ${missing.join(", ")}`);
  const stated = res.headers.get("total-result-count");
  if (stated != null && Number(stated) !== rows.length) throw new Error(`Water Quality Portal: ${rows.length} of ${stated} results parsed`);
  return dropAmbiguous(rows.map(sampleFromRow).filter(Boolean));
}

// --- reading the record -----------------------------------------------------

export const RECENT = 12;
const isCount = (unit) => unit.startsWith("#");
const inches = (value, unit) => (unit === "in" ? value : value * 39.3701);

// One station's rows → the latest sampling days (each measure's values that
// day), a per-year summary, and how far back it goes. E. coli is kept apart by
// unit: an MPN and a count are not the same number.
export function summarizeStation(rows) {
  const days = new Map();
  const years = new Map();
  for (const r of rows) {
    const d = days.get(r.day) || { day: r.day, ecoliMpn: [], ecoliCount: [], oxygen: [], clarityIn: [] };
    days.set(r.day, d);
    const y = years.get(r.day.slice(0, 4)) || { year: r.day.slice(0, 4), days: new Set(), ecoliDays: new Set(), ecoliMpnMax: null, ecoliCountMax: null, oxygenMin: null };
    years.set(y.year, y);
    y.days.add(r.day);
    if (r.measure === "ecoli") {
      y.ecoliDays.add(r.day);
      if (isCount(r.unit)) { d.ecoliCount.push(r.value); y.ecoliCountMax = Math.max(y.ecoliCountMax ?? r.value, r.value); }
      else { d.ecoliMpn.push(r.value); y.ecoliMpnMax = Math.max(y.ecoliMpnMax ?? r.value, r.value); }
    } else if (r.measure === "oxygen") {
      d.oxygen.push(r.value);
      y.oxygenMin = Math.min(y.oxygenMin ?? r.value, r.value);
    } else if (r.measure === "clarity") d.clarityIn.push(inches(r.value, r.unit));
  }
  const sorted = [...days.keys()].sort();
  return {
    first: sorted[0] ?? null,
    last: sorted.at(-1) ?? null,
    visits: sorted.length,
    recent: sorted.slice(-RECENT).reverse().map((k) => days.get(k)),
    years: [...years.values()].sort((a, b) => (a.year < b.year ? 1 : -1)).map((y) => ({ year: y.year, visits: y.days.size, ecoliDays: y.ecoliDays.size, ecoliMpnMax: y.ecoliMpnMax, ecoliCountMax: y.ecoliCountMax, oxygenMin: y.oxygenMin })),
  };
}

// The stations' summaries, in the order asked. Throws on a database failure;
// /fishing catches it, the gauge pages do not.
export async function loadWaterSamples(env, stationIds = WQ_STATION_IDS) {
  if (!env.DB) throw new Error("the sample record is not available");
  return Promise.all(
    stationIds.map(async (id) => {
      const st = WQ_STATIONS.find((s) => s.id === id);
      const rows = (await env.DB.prepare("SELECT day, measure, value, unit FROM water_samples WHERE station = ?").bind(id).all()).results || [];
      return { ...st, ...summarizeStation(rows) };
    }),
  );
}

// --- rendering ----------------------------------------------------------------

const loc = (lang) => (lang === "es" ? "es-MX" : "en-US");
const dayText = (day, lang) => new Date(`${day}T12:00:00Z`).toLocaleDateString(loc(lang), { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
const n0 = (lang) => (v) => Math.round(v).toLocaleString(loc(lang));
const n1 = (v) => (Math.round(v * 10) / 10).toFixed(1);
// The values one day holds for a measure: one figure, or low–high when TCEQ
// published several that differ.
const span = (vals, f) => {
  if (!vals.length) return "";
  const lo = f(Math.min(...vals)), hi = f(Math.max(...vals));
  return lo === hi ? lo : `${lo}–${hi}`;
};
const dash = (s) => s || "—";
const ecoliCell = (mpn, count, lang) => dash([span(mpn, n0(lang)), count.length ? `${span(count, n0(lang))} (#)` : ""].filter(Boolean).join(" · "));
const ecoliMaxCell = (y, lang) => dash([y.ecoliMpnMax != null ? n0(lang)(y.ecoliMpnMax) : "", y.ecoliCountMax != null ? `${n0(lang)(y.ecoliCountMax)} (#)` : ""].filter(Boolean).join(" · "));
const recentCells = (r, lang) => [ecoliCell(r.ecoliMpn, r.ecoliCount, lang), dash(span(r.oxygen, n1)), dash(span(r.clarityIn, n0(lang)))];
const yearCells = (y, lang) => [String(y.visits), String(y.ecoliDays), ecoliMaxCell(y, lang), y.oxygenMin == null ? "—" : n1(y.oxygenMin)];

const heads = (lang) => ({
  recent: [T(lang, "Sampled", "Muestreo"), T(lang, "E. coli (MPN/100 mL)", "E. coli (NMP/100 mL)"), T(lang, "Oxygen (mg/L)", "Oxígeno (mg/L)"), T(lang, "Clarity (in)", "Claridad (pulg.)")],
  years: [T(lang, "Year", "Año"), T(lang, "Sampling days", "Días de muestreo"), T(lang, "Days with E. coli", "Días con E. coli"), T(lang, "Highest E. coli", "E. coli más alto"), T(lang, "Lowest oxygen", "Oxígeno más bajo")],
});

const intro = (lang) =>
  T(
    lang,
    "Water samples taken by the Texas Commission on Environmental Quality's monitoring program and published in the Water Quality Portal: bacteria (E. coli), dissolved oxygen, and clarity measured as Secchi depth (how deep a black-and-white disk stays visible). These are dated results, not live readings.",
    "Muestras de agua tomadas por el programa de monitoreo de la Comisión de Calidad Ambiental de Texas y publicadas en el Water Quality Portal: bacterias (E. coli), oxígeno disuelto y claridad medida como profundidad Secchi (hasta qué profundidad se ve un disco blanco y negro). Son resultados fechados, no lecturas en vivo.",
  );

// What the numbers cannot tell you. Printed wherever the samples are shown.
export function waterSampleLimits(lang) {
  return [
    T(lang, "Each value is one result from one day, published by TCEQ months after the sample was taken, so the newest result here can be half a year old.", "Cada valor es un resultado de un día, publicado por la TCEQ meses después de tomar la muestra, así que el resultado más reciente aquí puede tener medio año."),
    T(lang, "Bacteria counts swing widely from day to day and after rain; a single result is a snapshot, not a verdict on the water. This site does not compare results with Texas water-quality standards.", "Los conteos de bacterias varían mucho de un día a otro y después de la lluvia; un solo resultado es una instantánea, no un veredicto sobre el agua. Este sitio no compara los resultados con las normas de calidad del agua de Texas."),
    T(lang, "Where TCEQ published more than one result for a measure on the same day without saying what separates them, the range is shown (low–high). Oxygen can differ with depth, and the portal does not say at what depth each reading was taken.", "Cuando la TCEQ publicó más de un resultado de una medida el mismo día sin decir qué los distingue, se muestra el rango (bajo–alto). El oxígeno puede variar con la profundidad, y el portal no dice a qué profundidad se tomó cada lectura."),
    T(lang, "On some days TCEQ published several oxygen values from one sampling activity, with a count of readings (96 or 144) that suggests a meter left in the water for a day, and nothing naming which value is which. That day's oxygen is left out here; its E. coli and clarity are kept, and a day with nothing else measured is not listed.", "Algunos días la TCEQ publicó varios valores de oxígeno de una misma actividad de muestreo, con un conteo de lecturas (96 o 144) que sugiere un medidor dejado en el agua un día, sin indicar cuál valor es cuál. El oxígeno de ese día se omite aquí; se conservan su E. coli y su claridad, y un día sin otra medida no aparece."),
    T(lang, "The portal publishes these results as plain numbers, without less-than or greater-than flags, so a value at the edge of a lab method's range is shown as published.", "El portal publica estos resultados como números simples, sin indicadores de menor que o mayor que, así que un valor en el límite del rango de un método de laboratorio se muestra tal como se publicó."),
    T(lang, "E. coli is in MPN (most probable number) per 100 mL; values marked (#) were published as a count per 100 mL instead, and are kept apart. A dash means the measure was not taken that day.", "El E. coli está en NMP (número más probable) por 100 mL; los valores marcados (#) se publicaron como un conteo por 100 mL y se muestran aparte. Un guion significa que la medida no se tomó ese día."),
  ];
}

const span1 = (s, lang) => T(lang, `${s.visits.toLocaleString("en-US")} sampling days from ${dayText(s.first, lang)} to ${dayText(s.last, lang)}.`, `${s.visits.toLocaleString("es-MX")} días de muestreo del ${dayText(s.first, lang)} al ${dayText(s.last, lang)}.`);
const hasAny = (stations) => Array.isArray(stations) && stations.some((s) => s.visits);

// One station's block. `years` adds the per-year summary (gauge pages);
// `recent` caps the latest-days table.
function stationHtml(s, lang, { years = false, recent = RECENT } = {}) {
  const name = T(lang, s.en, s.es);
  if (!s.visits) return `<h3>${esc(name)}</h3>\n    <p class="note">${T(lang, "No samples in the record yet.", "Aún no hay muestras en el registro.")}</p>`;
  const h = heads(lang);
  const yearTable =
    years && s.years.length
      ? `
    <details class="years"><summary>${T(lang, "Every year on record", "Cada año del registro")}</summary>
    <div class="tbl-wrap"><table class="tbl">
      <thead><tr>${h.years.map((x) => `<th>${esc(x)}</th>`).join("")}</tr></thead>
      <tbody>
${s.years.map((y) => `        <tr><td>${esc(y.year)}</td>${yearCells(y, lang).map((c) => `<td class="num">${esc(c)}</td>`).join("")}</tr>`).join("\n")}
      </tbody>
    </table></div></details>`
      : "";
  return `<h3><a href="${wqStationUrl(s.id)}">${esc(name)}</a></h3>
    <p class="note">${esc(span1(s, lang))}</p>
    <div class="tbl-wrap"><table class="tbl">
      <thead><tr>${h.recent.map((x) => `<th>${esc(x)}</th>`).join("")}</tr></thead>
      <tbody>
${s.recent.slice(0, recent).map((r) => `        <tr><td><time datetime="${esc(r.day)}">${esc(dayText(r.day, lang))}</time></td>${recentCells(r, lang).map((c) => `<td class="num">${esc(c)}</td>`).join("")}</tr>`).join("\n")}
      </tbody>
    </table></div>${yearTable}`;
}

export const WQ_CSS = `
  .wq { margin-top:1.6rem; }
  .wq h3 { font-size:0.98rem; margin:1rem 0 0.2rem; }
  .wq .note { font-size:0.85rem; color:var(--muted); margin:0.3rem 0 0; }
  .wq .tbl-wrap { overflow-x:auto; margin-top:0.4rem; }
  .wq .tbl { border-collapse:collapse; font-size:0.88rem; width:100%; }
  .wq .tbl th, .wq .tbl td { border:1px solid var(--line); padding:0.35rem 0.55rem; text-align:left; }
  .wq .tbl th { background:var(--card); }
  .wq .num { white-space:nowrap; }
  .wq details.years { margin-top:0.4rem; font-size:0.9rem; }
  .wq .limits { font-size:0.85rem; color:var(--muted); padding-left:1.2rem; margin:0.5rem 0 0; }
  .wq .limits li { margin:0.3rem 0; }
`;

const headingOf = (lang, opts) => (opts.heading ? T(lang, opts.heading[0], opts.heading[1]) : T(lang, "Water samples", "Muestras de agua"));

// The section, or "" while no station has a sample on record.
export function waterSamplesHtml(stations, lang, opts = {}) {
  if (!hasAny(stations)) return "";
  return `<section class="wq">
    <h2>${esc(headingOf(lang, opts))}</h2>
    <p class="note">${esc(intro(lang))}</p>
    ${stations.map((s) => stationHtml(s, lang, opts)).join("\n    ")}
    <h3>${T(lang, "About these samples", "Sobre estas muestras")}</h3>
    <ul class="limits">
${waterSampleLimits(lang).map((n) => `      <li>${esc(n)}</li>`).join("\n")}
    </ul>
  </section>`;
}

const mdRow = (cells) => `| ${cells.join(" | ")} |`;

export function waterSamplesMarkdown(stations, lang, opts = {}) {
  if (!hasAny(stations)) return [];
  const { years = false, recent = RECENT } = opts;
  const h = heads(lang);
  const out = [`## ${headingOf(lang, opts)}`, "", intro(lang), ""];
  for (const s of stations) {
    out.push(`### ${T(lang, s.en, s.es)}`, "");
    if (!s.visits) { out.push(T(lang, "No samples in the record yet.", "Aún no hay muestras en el registro."), ""); continue; }
    out.push(span1(s, lang), "", mdRow(h.recent), mdRow(h.recent.map(() => "---")));
    for (const r of s.recent.slice(0, recent)) out.push(mdRow([dayText(r.day, lang), ...recentCells(r, lang)]));
    out.push("");
    if (years && s.years.length) {
      out.push(`${T(lang, "Every year on record", "Cada año del registro")}:`, "", mdRow(h.years), mdRow(h.years.map(() => "---")));
      for (const y of s.years) out.push(mdRow([y.year, ...yearCells(y, lang)]));
      out.push("");
    }
    out.push(`${T(lang, "Station", "Estación")}: ${wqStationUrl(s.id)}`, "");
  }
  out.push(`### ${T(lang, "About these samples", "Sobre estas muestras")}`, "", ...waterSampleLimits(lang).map((n) => `- ${n}`), "");
  return out;
}
