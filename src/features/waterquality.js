// Water-quality lab samples near Crosby: E. coli, dissolved oxygen and
// clarity (Secchi depth) from the Texas Commission on Environmental Quality's
// monitoring stations, as the Water Quality Portal (waterqualitydata.us)
// publishes them. Shown on /fishing and on the gauge page of the waterway
// each station samples.
//
// These are dated lab results published months after the sample, not live
// readings: every value is shown with its sample date, never as "now".
//
// Units are taken from the source. TCEQ's E. coli results since about 2007
// carry the unit "None" in the portal, with TCEQ's own unit in the result
// comment ("TCEQ Unit: MPN/100ml."); that comment is what labels them. Rows
// the portal files under the same names but that are not these measures
// (E. coli holding time in "hours", unitless oxygen counts) are left out.

import { T } from "../i18n.js";
import { esc } from "../lib/format.js";

export const WQ_STATIONS = [
  { id: "TCEQMAIN-11212", en: "Lake Houston at FM 1960 East", es: "Lake Houston en FM 1960 Este", lid: "HSJT2" },
  { id: "TCEQMAIN-11123", en: "Cedar Bayou at FM 1960", es: "Cedar Bayou en FM 1960", lid: "HCDT2" },
  { id: "TCEQMAIN-11120", en: "Cedar Bayou at US 90", es: "Cedar Bayou en US 90", lid: "HCDT2" },
  { id: "TCEQMAIN-22429", en: "Luce Bayou at the Grand Parkway (SH-99)", es: "Luce Bayou en el Grand Parkway (SH-99)", lid: "HFFT2" },
];
export const wqStationUrl = (id) => `https://www.waterqualitydata.us/provider/STORET/TCEQMAIN/${id}/`;
const CHARACTERISTICS = { "Escherichia coli": "ecoli", Oxygen: "oxygen", "Depth, Secchi disk depth": "clarity" };

// RFC 4180 CSV: quoted fields may hold commas, quotes ("") and newlines.
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
  const [head, ...body] = rows.filter((r) => r.length > 1 || r[0]);
  return (body || []).map((r) => Object.fromEntries((head || []).map((h, i) => [h, r[i] ?? ""])));
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

const portalDate = (iso) => `${iso.slice(5, 7)}-${iso.slice(8, 10)}-${iso.slice(0, 4)}`;

// Every sample of the three measures at the given stations since a date.
export async function fetchWaterSamples(stationIds, sinceIso = "1960-01-01") {
  const p = new URLSearchParams();
  for (const id of stationIds) p.append("siteid", id);
  for (const c of Object.keys(CHARACTERISTICS)) p.append("characteristicName", c);
  p.set("startDateLo", portalDate(sinceIso));
  p.set("mimeType", "csv");
  p.set("dataProfile", "resultPhysChem");
  const res = await fetch(`https://www.waterqualitydata.us/data/Result/search?${p}`, { headers: { "User-Agent": "crosbynews.com", Accept: "text/csv" } });
  if (!res.ok) throw new Error(`Water Quality Portal: HTTP ${res.status}`);
  return dropAmbiguous(parseCsv(await res.text()).map(sampleFromRow).filter(Boolean));
}

// A visit that carries the same measure more than once, with no statistic
// named (TCEQ's 24-hour oxygen deployments publish three unlabeled values per
// visit), cannot say which value is which: that measure is left out for that
// visit rather than one value picked.
export function dropAmbiguous(samples) {
  const n = new Map();
  for (const x of samples) n.set(`${x.station}|${x.activity}|${x.measure}`, (n.get(`${x.station}|${x.activity}|${x.measure}`) || 0) + 1);
  return samples.filter((x) => n.get(`${x.station}|${x.activity}|${x.measure}`) === 1);
}

// --- reading the record -----------------------------------------------------

const RECENT = 12;

// For each station: the latest samples (one row per visit with whichever
// measures were taken), a per-year summary, and how far back it goes.
export async function loadWaterSamples(env, stationIds) {
  if (!env.DB) throw new Error("the sample record is not available");
  const out = [];
  for (const id of stationIds) {
    const st = WQ_STATIONS.find((s) => s.id === id);
    const [visits, years, span] = await Promise.all([
      env.DB.prepare(
        `SELECT day, MAX(CASE WHEN measure = 'ecoli' THEN value END) AS ecoli, MAX(CASE WHEN measure = 'oxygen' THEN value END) AS oxygen,
                MAX(CASE WHEN measure = 'clarity' THEN (CASE unit WHEN 'in' THEN value ELSE value * 39.3701 END) END) AS clarityIn
         FROM water_samples WHERE station = ? GROUP BY day ORDER BY day DESC LIMIT ?`,
      ).bind(id, RECENT).all(),
      env.DB.prepare(
        `SELECT substr(day, 1, 4) AS year, COUNT(DISTINCT day) AS visits,
                SUM(measure = 'ecoli') AS ecoliN, MAX(CASE WHEN measure = 'ecoli' THEN value END) AS ecoliMax,
                MIN(CASE WHEN measure = 'oxygen' THEN value END) AS oxygenMin
         FROM water_samples WHERE station = ? GROUP BY year ORDER BY year DESC`,
      ).bind(id).all(),
      env.DB.prepare("SELECT MIN(day) AS first, MAX(day) AS last, COUNT(DISTINCT day) AS visits FROM water_samples WHERE station = ?").bind(id).first(),
    ]);
    out.push({ ...st, recent: visits.results || [], years: years.results || [], first: span?.first ?? null, last: span?.last ?? null, visits: span?.visits ?? 0 });
  }
  return out;
}

// Per-station sample counts, "id:n|...": the IndexNow signal for /fishing and
// the gauge pages, which moves only when a new sample is filed.
export async function waterSampleCounts(env) {
  if (!env?.DB) return undefined;
  const r = (await env.DB.prepare("SELECT station, COUNT(DISTINCT day) AS n FROM water_samples GROUP BY station ORDER BY station").all()).results || [];
  return r.map((x) => `${x.station}:${x.n}`).join("|");
}

// --- rendering ----------------------------------------------------------------

const loc = (lang) => (lang === "es" ? "es-MX" : "en-US");
const dayText = (day, lang) => new Date(`${day}T12:00:00Z`).toLocaleDateString(loc(lang), { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
const n0 = (v, lang) => (v == null ? "—" : Math.round(v).toLocaleString(loc(lang)));
const n1 = (v) => (v == null ? "—" : (Math.round(v * 10) / 10).toFixed(1));

function intro(lang) {
  return T(
    lang,
    "Lab samples taken by the Texas Commission on Environmental Quality's monitoring program, published in the Water Quality Portal. Each is one sample on one day, published months later; bacteria in particular swing widely from day to day, so a single result is a snapshot, not a verdict on the water.",
    "Muestras de laboratorio tomadas por el programa de monitoreo de la Comisión de Calidad Ambiental de Texas, publicadas en el Water Quality Portal. Cada una es una muestra de un día, publicada meses después; las bacterias en particular varían mucho de un día a otro, así que un solo resultado es una instantánea, no un veredicto sobre el agua.",
  );
}
const legend = (lang) =>
  T(
    lang,
    "E. coli in MPN (most probable number) per 100 mL, dissolved oxygen in mg/L, clarity as Secchi depth in inches (how deep a disk stays visible). A dash means that measure was not taken on that visit.",
    "E. coli en NMP (número más probable) por 100 mL, oxígeno disuelto en mg/L, claridad como profundidad Secchi en pulgadas (hasta qué profundidad se ve un disco). Un guion significa que esa medida no se tomó en esa visita.",
  );

// One station's block. `years` adds the per-year summary (gauge pages).
function stationHtml(s, lang, { years = false } = {}) {
  const name = T(lang, s.en, s.es);
  if (!s.visits) return `<h3>${esc(name)}</h3>\n    <p class="none">${T(lang, "No samples in the record yet.", "Aún no hay muestras en el registro.")}</p>`;
  return `<h3><a href="${wqStationUrl(s.id)}">${esc(name)}</a></h3>
    <p class="note">${esc(T(lang, `${s.visits} sampling visits from ${dayText(s.first, lang)} to ${dayText(s.last, lang)}.`, `${s.visits} visitas de muestreo del ${dayText(s.first, lang)} al ${dayText(s.last, lang)}.`))}</p>
    <div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>${T(lang, "Sampled", "Muestreo")}</th><th>E. coli</th><th>${T(lang, "Oxygen", "Oxígeno")}</th><th>${T(lang, "Clarity", "Claridad")}</th></tr></thead>
      <tbody>
${s.recent.map((r) => `        <tr><td><time datetime="${esc(r.day)}">${esc(dayText(r.day, lang))}</time></td><td class="num">${esc(n0(r.ecoli, lang))}</td><td class="num">${esc(n1(r.oxygen))}</td><td class="num">${esc(n0(r.clarityIn, lang))}</td></tr>`).join("\n")}
      </tbody>
    </table></div>${
      years && s.years.length
        ? `
    <details class="years"><summary>${T(lang, "Every year on record", "Cada año del registro")}</summary>
    <div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>${T(lang, "Year", "Año")}</th><th>${T(lang, "Visits", "Visitas")}</th><th>${T(lang, "E. coli samples", "Muestras de E. coli")}</th><th>${T(lang, "Highest E. coli", "E. coli más alto")}</th><th>${T(lang, "Lowest oxygen", "Oxígeno más bajo")}</th></tr></thead>
      <tbody>
${s.years.map((y) => `        <tr><td>${esc(y.year)}</td><td class="num">${esc(y.visits)}</td><td class="num">${esc(y.ecoliN)}</td><td class="num">${esc(n0(y.ecoliMax, lang))}</td><td class="num">${esc(n1(y.oxygenMin))}</td></tr>`).join("\n")}
      </tbody>
    </table></div></details>`
        : ""
    }`;
}

export const WQ_CSS = `
  .wq h3 { font-size:0.98rem; margin:1rem 0 0.2rem; }
  .wq .note { font-size:0.85rem; color:var(--muted); margin:0.3rem 0 0; }
  .wq .tbl-wrap { overflow-x:auto; margin-top:0.4rem; }
  .wq .tbl { border-collapse:collapse; font-size:0.88rem; width:100%; }
  .wq .tbl th, .wq .tbl td { border:1px solid var(--line); padding:0.35rem 0.55rem; text-align:left; }
  .wq .tbl th { background:var(--card); }
  .wq .num { white-space:nowrap; }
  .wq details.years { margin-top:0.4rem; font-size:0.9rem; }
`;

export function waterSamplesHtml(stations, lang, opts = {}) {
  if (!Array.isArray(stations) || !stations.length) return "";
  return `<section class="wq">
    <h2>${opts.heading ? esc(T(lang, opts.heading[0], opts.heading[1])) : T(lang, "Water samples", "Muestras de agua")}</h2>
    <p class="note">${esc(intro(lang))}</p>
    <p class="note">${esc(legend(lang))}</p>
    ${stations.map((s) => stationHtml(s, lang, opts)).join("\n    ")}
  </section>`;
}

export function waterSamplesMarkdown(stations, lang, opts = {}) {
  if (!Array.isArray(stations) || !stations.length) return [];
  const out = [`## ${opts.heading ? T(lang, opts.heading[0], opts.heading[1]) : T(lang, "Water samples", "Muestras de agua")}`, "", intro(lang), "", legend(lang), ""];
  for (const s of stations) {
    out.push(`### ${T(lang, s.en, s.es)}`, "");
    if (!s.visits) { out.push(T(lang, "No samples in the record yet.", "Aún no hay muestras en el registro."), ""); continue; }
    out.push(T(lang, `${s.visits} sampling visits from ${dayText(s.first, lang)} to ${dayText(s.last, lang)}.`, `${s.visits} visitas de muestreo del ${dayText(s.first, lang)} al ${dayText(s.last, lang)}.`), "");
    out.push(`| ${T(lang, "Sampled", "Muestreo")} | E. coli | ${T(lang, "Oxygen", "Oxígeno")} | ${T(lang, "Clarity", "Claridad")} |`, "|---|---|---|---|");
    for (const r of s.recent) out.push(`| ${dayText(r.day, lang)} | ${n0(r.ecoli, lang)} | ${n1(r.oxygen)} | ${n0(r.clarityIn, lang)} |`);
    out.push("");
    if (opts.years && s.years.length) {
      out.push(`| ${T(lang, "Year", "Año")} | ${T(lang, "Visits", "Visitas")} | ${T(lang, "E. coli samples", "Muestras de E. coli")} | ${T(lang, "Highest E. coli", "E. coli más alto")} | ${T(lang, "Lowest oxygen", "Oxígeno más bajo")} |`, "|---|---|---|---|---|");
      for (const y of s.years) out.push(`| ${y.year} | ${y.visits} | ${y.ecoliN} | ${n0(y.ecoliMax, lang)} | ${n1(y.oxygenMin)} |`);
      out.push("");
    }
    out.push(`${T(lang, "Station", "Estación")}: ${wqStationUrl(s.id)}`, "");
  }
  return out;
}

// The stations that sample a gauge's waterway.
export const stationsForGauge = (lid) => WQ_STATIONS.filter((s) => s.lid === lid).map((s) => s.id);
