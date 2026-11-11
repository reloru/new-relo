// The record: what the site keeps beyond the latest snapshot.
//
// Every 15 minutes the cron overwrites the cache with the newest reading. This
// module is the other half: it files each observation in D1 so that what
// happened yesterday, last month and in 2017 is still there to be read. The
// pages built on it are the ones that do not change between a crawler's
// visits.
//
// Rules every writer here follows:
//   * Idempotent. Each row has a natural key and is upserted, so recording the
//     same observation twice changes nothing and a retry is always safe.
//   * Only what a source published or this site observed. Nothing is inferred,
//     smoothed or filled in; a gap in the feed is a gap in the record.
//   * Never in the way. The cron calls these after its cache writes, each in
//     its own try/catch, so a database failure cannot cost a live page its
//     refresh.
//
// Schema: migrations/0002_record.sql.

import { TZ } from "./config.js";

export const ctDay = (d) => new Date(d).toLocaleDateString("en-CA", { timeZone: TZ });

// --- NWS events -------------------------------------------------------------

// /O.NEW.KHGX.TO.W.0042.261111T0358Z-261111T0430Z/
// Built from strings: scripts/check-module-refs.mjs reads a regex literal as
// code and takes the "T" in a timestamp pattern for i18n's T().
const STAMP = "\\d{6}T\\d{4}Z";
const VTEC_RE = new RegExp(`/([OTEX])\\.([A-Z]{3})\\.([A-Z]{4})\\.([A-Z]{2})\\.([A-Z])\\.(\\d{4})\\.(${STAMP})-(${STAMP})/`);
const STAMP_PARTS = new RegExp("^(\\d{2})(\\d{2})(\\d{2})T(\\d{2})(\\d{2})Z$");

function vtecTime(s) {
  if (!s || s.startsWith("000000")) return null; // "already in effect" / "until further notice"
  const m = s.match(STAMP_PARTS);
  return m ? `20${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00Z` : null;
}

export function parseVtec(str) {
  const m = typeof str === "string" ? str.match(VTEC_RE) : null;
  if (!m) return null;
  return {
    action: m[2],
    wfo: m[3].slice(1), // KHGX -> HGX, the form the archive uses
    phenomena: m[4],
    significance: m[5],
    etn: Number(m[6]),
    begins: vtecTime(m[7]),
    ends: vtecTime(m[8]),
  };
}

// Warnings NWS draws as a polygon around the threat. An active one reached us
// through a point query, so its polygon contained Crosby. Everything else is
// issued for a whole forecast zone or county.
const POLYGON_EVENTS = new Set(["TO.W", "SV.W", "FF.W", "FA.W", "FA.Y", "MA.W", "EW.W", "SQ.W", "DS.W", "DS.Y"]);

export function scopeOf(v, alert) {
  if (POLYGON_EVENTS.has(`${v.phenomena}.${v.significance}`)) return "point";
  const ugc = alert?.geocode?.UGC;
  return Array.isArray(ugc) && ugc.some((u) => /^[A-Z]{2}Z\d{3}$/.test(u)) ? "zone" : "county";
}

const firstVtec = (a) => {
  const v = a?.parameters?.VTEC;
  return Array.isArray(v) && v.length ? v[0] : null;
};

// An event number is unique within the year the event was ISSUED in, which a
// later message does not restate. A new event takes the year it was sent; a
// continuation, cancellation or expiration belongs to whichever year already
// holds that event — this year's, or last year's for one that crossed New Year.
async function eventYear(env, v, a, nowIso) {
  const sent = new Date(a.sent || nowIso);
  const y = sent.getUTCFullYear();
  if (v.action === "NEW") return y;
  const rows = (await env.DB.prepare(
    "SELECT year, expires FROM nws_events WHERE wfo = ? AND phenomena = ? AND significance = ? AND etn = ? AND year IN (?, ?)",
  ).bind(v.wfo, v.phenomena, v.significance, v.etn, y, y - 1).all()).results || [];
  if (rows.some((r) => r.year === y)) return y;
  const weekBefore = new Date(sent.getTime() - 7 * 86400000).toISOString();
  return rows.some((r) => r.year === y - 1 && (!r.expires || r.expires >= weekBefore)) ? y - 1 : y;
}

// File the alerts active right now. `alerts` are NWS alert property objects as
// the weather cache holds them.
export async function recordAlerts(env, alerts, nowIso = new Date().toISOString()) {
  if (!env?.DB || !Array.isArray(alerts) || !alerts.length) return 0;
  const stmts = [];
  const alertStmt = env.DB.prepare(
    `INSERT INTO alerts (id, event, severity, urgency, certainty, headline, area, sent, onset, expires, ends,
                         vtec, year, wfo, phenomena, significance, etn, description, instruction, first_seen, last_seen)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET last_seen = excluded.last_seen, expires = excluded.expires, ends = excluded.ends`,
  );
  const eventStmt = env.DB.prepare(
    `INSERT INTO nws_events (year, wfo, phenomena, significance, etn, scope, name, issued, expires, source, nwsli, tags)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'observed', NULL, NULL)
     ON CONFLICT (year, wfo, phenomena, significance, etn) DO UPDATE SET
       issued = MIN(nws_events.issued, excluded.issued),
       expires = CASE WHEN ?10 = 1 THEN excluded.expires
                      WHEN nws_events.expires IS NULL OR excluded.expires > nws_events.expires THEN excluded.expires
                      ELSE nws_events.expires END`,
  );
  for (const a of alerts) {
    if (!a || typeof a.id !== "string" || typeof a.event !== "string") continue;
    const raw = firstVtec(a);
    const v = parseVtec(raw);
    const issued = v?.begins || a.onset || a.effective || a.sent || nowIso;
    const year = v ? await eventYear(env, v, a, nowIso) : null;
    stmts.push(
      alertStmt.bind(
        a.id, a.event, a.severity ?? null, a.urgency ?? null, a.certainty ?? null, a.headline ?? null, a.areaDesc ?? null,
        a.sent ?? null, a.onset ?? null, a.expires ?? null, a.ends ?? null,
        raw, year, v?.wfo ?? null, v?.phenomena ?? null, v?.significance ?? null, v?.etn ?? null,
        a.description ?? null, a.instruction ?? null, nowIso, nowIso,
      ),
    );
    if (v) {
      // A cancellation or expiration ends the event when it was sent, whatever
      // the earlier messages said.
      const ended = v.action === "CAN" || v.action === "EXP";
      const expires = ended ? (a.sent ?? nowIso) : (v.ends || a.ends || a.expires || null);
      stmts.push(eventStmt.bind(year, v.wfo, v.phenomena, v.significance, v.etn, scopeOf(v, a), a.event, new Date(issued).toISOString(), expires ? new Date(expires).toISOString() : null, ended ? 1 : 0));
    }
  }
  if (stmts.length) await env.DB.batch(stmts);
  return stmts.length;
}

// --- gauges -----------------------------------------------------------------

export const FLOOD_RANK = { action: 1, minor: 2, moderate: 3, major: 4 };
export const FLOOD_RANK_NAME = ["no_flooding", "action", "minor", "moderate", "major"];

// Fold the current reading of each gauge into its day. `readings` counts
// distinct reading times, so recording the same reading on every tick until
// the gauge reports again adds nothing.
export async function recordGauges(env, water) {
  if (!env?.DB || !Array.isArray(water?.gauges)) return 0;
  const stmt = env.DB.prepare(
    `INSERT INTO gauge_daily (lid, day, max_stage, max_at, min_stage, last_stage, last_at, max_flow, max_rank, readings)
     VALUES (?1, ?2, ?3, ?4, ?3, ?3, ?4, ?5, ?6, 1)
     ON CONFLICT (lid, day) DO UPDATE SET
       max_at     = CASE WHEN excluded.max_stage > gauge_daily.max_stage THEN excluded.max_at ELSE gauge_daily.max_at END,
       max_stage  = MAX(gauge_daily.max_stage, excluded.max_stage),
       min_stage  = MIN(gauge_daily.min_stage, excluded.min_stage),
       last_stage = CASE WHEN excluded.last_at >= gauge_daily.last_at THEN excluded.last_stage ELSE gauge_daily.last_stage END,
       last_at    = MAX(gauge_daily.last_at, excluded.last_at),
       max_flow   = CASE WHEN gauge_daily.max_flow IS NULL THEN excluded.max_flow
                         WHEN excluded.max_flow IS NULL THEN gauge_daily.max_flow
                         ELSE MAX(gauge_daily.max_flow, excluded.max_flow) END,
       max_rank   = MAX(gauge_daily.max_rank, excluded.max_rank),
       readings   = gauge_daily.readings + (excluded.last_at <> gauge_daily.last_at)`,
  );
  const stmts = [];
  for (const g of water.gauges) {
    if (!g || typeof g.lid !== "string" || typeof g.stage !== "number" || !g.validTime) continue;
    const at = new Date(g.validTime);
    if (Number.isNaN(at.getTime())) continue;
    stmts.push(stmt.bind(g.lid, ctDay(at), g.stage, at.toISOString(), typeof g.flow === "number" ? g.flow : null, FLOOD_RANK[g.category] || 0));
  }
  if (stmts.length) await env.DB.batch(stmts);
  return stmts.length;
}

// NOAA's historic crests and flood-impact statements for each gauge. They
// change a few times a decade, so the cron sends them once a day.
export async function recordGaugeHistory(env, history, nowIso = new Date().toISOString()) {
  if (!env?.DB || !Array.isArray(history)) return 0;
  const crest = env.DB.prepare(
    `INSERT INTO gauge_crests (lid, occurred, stage, flow, quality, old_datum) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (lid, occurred) DO UPDATE SET stage = excluded.stage, flow = excluded.flow, quality = excluded.quality, old_datum = excluded.old_datum`,
  );
  const meta = env.DB.prepare(
    `INSERT INTO gauge_meta (lid, name, usgs_id, impacts, updated) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (lid) DO UPDATE SET name = excluded.name, usgs_id = excluded.usgs_id, impacts = excluded.impacts, updated = excluded.updated`,
  );
  const stmts = [];
  for (const h of history) {
    if (!h || typeof h.lid !== "string") continue;
    const impacts = (h.impacts || [])
      .filter((i) => i && typeof i.stage === "number" && typeof i.statement === "string")
      .map((i) => ({ stage: i.stage, statement: i.statement.trim() }));
    stmts.push(meta.bind(h.lid, h.name ?? null, h.usgsId ?? null, JSON.stringify(impacts), nowIso));
    for (const c of h.crests || []) {
      const at = c && c.occurredTime ? new Date(c.occurredTime) : null;
      if (!at || Number.isNaN(at.getTime()) || typeof c.stage !== "number") continue;
      stmts.push(crest.bind(h.lid, at.toISOString(), c.stage, typeof c.flow === "number" && c.flow > 0 ? c.flow : null, typeof c.preliminary === "string" ? c.preliminary : null, c.olddatum ? 1 : 0));
    }
  }
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
  return stmts.length;
}

export async function hasGaugeHistory(env) {
  if (!env?.DB) return true; // nothing to fill
  return !!(await env.DB.prepare("SELECT 1 AS x FROM gauge_meta LIMIT 1").first());
}

// --- pollen, air, burn ban --------------------------------------------------

const group = (g) => [Number.isFinite(g?.count) ? g.count : null, typeof g?.category === "string" ? g.category : null];

// One row per count date. HHD sometimes corrects a count later in the day, so
// a re-read replaces the row rather than being ignored.
export async function recordPollen(env, pollen, nowIso = new Date().toISOString()) {
  if (!env?.DB || !pollen?.groups || !/^\d{4}-\d{2}-\d{2}$/.test(pollen.countDate || "")) return 0;
  const g = pollen.groups;
  await env.DB.prepare(
    `INSERT INTO pollen_daily (day, tree_count, tree_cat, weed_count, weed_cat, grass_count, grass_cat, mold_count, mold_cat, species, url, recorded)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (day) DO UPDATE SET
       tree_count = excluded.tree_count, tree_cat = excluded.tree_cat, weed_count = excluded.weed_count, weed_cat = excluded.weed_cat,
       grass_count = excluded.grass_count, grass_cat = excluded.grass_cat, mold_count = excluded.mold_count, mold_cat = excluded.mold_cat,
       species = excluded.species, url = excluded.url`,
  ).bind(pollen.countDate, ...group(g.tree), ...group(g.weed), ...group(g.grass), ...group(g.mold), JSON.stringify(pollen.species ?? {}), pollen.url ?? null, nowIso).run();
  return 1;
}

// The day's highest index among the readings this site saw. `weather` is the
// weather cache entry, which carries the AQI.
export async function recordAqi(env, weather) {
  const a = weather?.aqi;
  if (!env?.DB || !a || !Number.isFinite(a.usAqi)) return 0;
  // AirNow stamps its reading in local time ("2026-11-10 22:00 CST"); the
  // modeled fallback carries only our fetch time.
  const local = typeof a.observed === "string" && /^\d{4}-\d{2}-\d{2}/.test(a.observed) ? a.observed : null;
  const day = local ? local.slice(0, 10) : ctDay(a.time || weather.updated || Date.now());
  const at = local || a.time || weather.updated || null;
  await env.DB.prepare(
    `INSERT INTO aqi_daily (day, max_aqi, max_at, dominant, measured, readings) VALUES (?1, ?2, ?3, ?4, ?5, 1)
     ON CONFLICT (day) DO UPDATE SET
       max_at   = CASE WHEN excluded.max_aqi > aqi_daily.max_aqi THEN excluded.max_at ELSE aqi_daily.max_at END,
       dominant = CASE WHEN excluded.max_aqi > aqi_daily.max_aqi THEN excluded.dominant ELSE aqi_daily.dominant END,
       measured = CASE WHEN excluded.max_aqi > aqi_daily.max_aqi THEN excluded.measured ELSE aqi_daily.measured END,
       max_aqi  = MAX(aqi_daily.max_aqi, excluded.max_aqi),
       readings = aqi_daily.readings + 1`,
  ).bind(day, Math.round(a.usAqi), at, a.dominant ?? null, a.measured ? 1 : 0).run();
  return 1;
}

// Keep one row per ban. An active ban opens a period (with the Forest
// Service's own start date when it gives one); "no ban" closes whichever
// period is open, dated the day we first saw it lifted.
export async function recordBurnBan(env, data, nowIso = new Date().toISOString()) {
  if (!env?.DB || (data?.status !== "Yes" && data?.status !== "No")) return 0;
  if (data.status === "No") {
    const r = await env.DB.prepare("UPDATE burnban_periods SET ended = ?, end_source = 'observed' WHERE ended IS NULL").bind(ctDay(nowIso)).run();
    return r?.meta?.changes ?? 0;
  }
  if (await env.DB.prepare("SELECT 1 AS x FROM burnban_periods WHERE ended IS NULL LIMIT 1").first()) return 0;
  const official = data.startDate && !Number.isNaN(new Date(data.startDate).getTime());
  await env.DB.prepare("INSERT INTO burnban_periods (started, ended, start_source) VALUES (?, NULL, ?) ON CONFLICT (started) DO NOTHING")
    .bind(ctDay(official ? data.startDate : nowIso), official ? "tfs" : "observed").run();
  return 1;
}
