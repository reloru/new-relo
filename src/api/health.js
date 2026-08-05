// /api/health — a monitoring contract, not a liveness ping.
//
// The old version returned the literal string "ok" on every path, so a KV
// outage, a corrupt value, and a six-hour-stale cache all looked identical to
// anything watching. It is the `status` relation of EVERY api-catalog entry, so
// that made the catalog's health signal a constant.
//
// Two rules shape everything below.
//
// 1. NO LIVE UPSTREAM PROBES. Health evaluates exactly the cached state the
//    public endpoints serve, by reading KV directly. It deliberately does NOT
//    call the load*() helpers: those cold-warm on a miss, which would turn a
//    health check into an NWS/USGS/TranStar fetch and make a monitor's polling
//    interval into an upstream request rate. Read-only, always.
//
// 2. USEFULNESS, NOT REACHABILITY. "The Worker answered" is the least
//    interesting thing this can report — the response arriving proves it. What
//    a monitor needs to know is whether the data being served is still worth
//    serving: readable, correctly shaped, and recent enough for its own
//    refresh cadence.
//
// Freshness thresholds are per-feed, because the cadences differ by two orders
// of magnitude: water refreshes every 15 minutes and the school calendar every
// six hours. One global threshold would either scream about the calendar or
// stay silent while the forecast went cold.

import { KV_KEY } from "../config.js";
import { CALENDAR_KV_KEY } from "../features/calendar.js";
import { WATER_KV_KEY } from "../features/water.js";
import { FISHING_KV_KEY } from "../features/fishing.js";
import { TROPICS_KV_KEY } from "../features/tropics.js";
import { TRAFFIC_KV_KEY } from "../features/traffic.js";
import { POLLEN_KV_KEY } from "../features/pollen.js";
import { NEWS_KV_KEY } from "../features/news.js";

// Written by the cron at the end of every tick (see recordCronRun). Read here
// so health can answer "did the last refresh ATTEMPT succeed?" — which is not
// the same question as "is the data fresh?". An upstream that has been failing
// for ten minutes still has fresh data; that is worth seeing before it becomes
// staleness.
export const CRON_STATUS_KV_KEY = "cron_status";

// The three states, in escalating order. Kept as an array so rank comparison is
// the array index rather than a hand-maintained map.
export const HEALTH_STATES = ["ok", "degraded", "unhealthy"];
const worst = (...states) => HEALTH_STATES[Math.max(...states.map((s) => HEALTH_STATES.indexOf(s)))];

// Per-feed contract. `critical` decides whether a failure takes the whole
// service down (503) or merely degrades it (200 + a named problem):
//
//   weather is critical because it is the only key the FRONT PAGE cannot render
//   without — it also backs /weather, /hourly, /alerts, /air, /radar's footer,
//   /api/weather, /api/air, /badge.svg, /alerts.xml and most MCP tools. Losing
//   it is losing the site.
//
//   everything else backs one section page. /fishing being stale is a bad
//   fishing page, not a broken weather site, and paging someone at 3am for it
//   would be the wrong call.
//
// freshSeconds / staleSeconds are read against each feed's OWN cadence, with
// roughly 2x headroom over the expected interval before "stale" and a wide
// margin again before "expired" — enough that one missed cron tick is not an
// alert, and a genuinely dead feed still surfaces well before the data becomes
// misleading.
export const FEEDS = [
  {
    name: "weather",
    kvKey: KV_KEY,
    critical: true,
    cadence: "every 15 min (cron)",
    freshSeconds: 1800,
    staleSeconds: 7200,
    serves: ["/", "/weather", "/hourly", "/alerts", "/air", "/api/weather", "/api/air", "/badge.svg", "/alerts.xml"],
    // Not just "is there an object" — is there a usable forecast in it. An
    // empty hourly array parses fine and renders a blank hero.
    shape(d) {
      if (!Array.isArray(d.hourly) || !d.hourly.length) return "hourly[] missing or empty";
      if (!Array.isArray(d.periods) || !d.periods.length) return "periods[] missing or empty";
      if (!Array.isArray(d.alerts)) return "alerts[] missing (absent != empty)";
      // Has the forecast WINDOW itself elapsed? `updated` only says when we
      // last fetched; NWS can hand back a product whose periods have all run
      // out, and that parses perfectly. Note this cannot be checked via
      // currentHourly(): it deliberately falls back to the last already-started
      // period rather than returning null, so the hero shows the most recent
      // known hour instead of a blank. Good for rendering, useless as a probe.
      const lastEnd = Date.parse(d.hourly[d.hourly.length - 1]?.endTime ?? "");
      if (Number.isFinite(lastEnd) && lastEnd < Date.now()) {
        return `hourly forecast window has fully elapsed (last period ended ${new Date(lastEnd).toISOString()})`;
      }
      return null;
    },
    // Sub-signals that degrade rather than fail: a pre-feature cache legitimately
    // has neither, and both are failure-tolerant by design upstream.
    notes(d) {
      const out = {};
      out.uv = d.uv?.hourly?.length ? "present" : "absent";
      out.airQuality = d.aqi?.usAqi != null ? (d.aqi.measured ? "measured" : "modeled") : "absent";
      out.nearbyOzoneMonitor = d.aqi?.nearby ? "reporting" : "not reporting";
      out.activeAlerts = Array.isArray(d.alerts) ? d.alerts.length : null;
      return out;
    },
  },
  {
    name: "water",
    kvKey: WATER_KV_KEY,
    critical: false,
    cadence: "every 15 min (cron)",
    freshSeconds: 1800,
    staleSeconds: 7200,
    serves: ["/water", "/api/water"],
    shape: (d) => (Array.isArray(d.gauges) && d.gauges.length ? null : "gauges[] missing or empty"),
    notes: (d) => ({ gauges: d.gauges?.length ?? 0 }),
  },
  {
    name: "fishing",
    kvKey: FISHING_KV_KEY,
    critical: false,
    cadence: "every 15 min (cron); USGS posts every 15-30 min",
    freshSeconds: 3600,
    staleSeconds: 14400,
    serves: ["/fishing", "/api/fishing"],
    shape: (d) => (Array.isArray(d.stations) && d.stations.length ? null : "stations[] missing or empty"),
    notes: (d) => ({ stations: d.stations?.length ?? 0 }),
  },
  {
    name: "traffic",
    kvKey: TRAFFIC_KV_KEY,
    critical: false,
    cadence: "every 15 min (cron)",
    freshSeconds: 1800,
    staleSeconds: 7200,
    serves: ["/traffic", "/api/traffic"],
    // null vs [] is load-bearing here and nowhere else: null means TranStar was
    // unreachable at the last refresh, [] means quiet roads. Absent means the
    // snapshot predates the field entirely, which IS broken.
    shape(d) {
      if (!("incidents" in d)) return "incidents key absent (null would mean 'feed unreachable', absent means malformed)";
      if (!("closures" in d)) return "closures key absent";
      return null;
    },
    notes: (d) => ({
      incidents: d.incidents === null ? "feed unreachable at last refresh" : d.incidents.length,
      closures: d.closures === null ? "feed unreachable at last refresh" : d.closures.length,
    }),
  },
  {
    name: "tropics",
    kvKey: TROPICS_KV_KEY,
    critical: false,
    cadence: "~hourly (cron, throttled)",
    freshSeconds: 7200,
    staleSeconds: 21600,
    serves: ["/tropics", "/api/tropics"],
    // An empty storms array is the normal quiet-basin state, NOT a failure.
    shape: (d) => (Array.isArray(d.storms) ? null : "storms[] missing (empty is normal; absent is not)"),
    notes: (d) => ({ activeStorms: d.storms?.length ?? 0 }),
  },
  {
    name: "pollen",
    kvKey: POLLEN_KV_KEY,
    critical: false,
    cadence: "~2h (cron, throttled); HHD publishes weekday mornings",
    freshSeconds: 10800,
    staleSeconds: 43200,
    serves: ["/pollen", "/api/pollen"],
    shape(d) {
      if (!d.groups || !Object.keys(d.groups).length) return "groups{} missing or empty";
      if (!d.countDate) return "countDate missing";
      return null;
    },
    // countDate is the day the count is FOR; weekends legitimately carry
    // Friday's, so it is reported but never used to judge freshness.
    notes: (d) => ({ countDate: d.countDate ?? null }),
  },
  {
    name: "calendar",
    kvKey: CALENDAR_KV_KEY,
    critical: false,
    cadence: "~6h (cron, throttled)",
    freshSeconds: 28800,
    staleSeconds: 172800,
    serves: ["/calendar", "/api/calendar"],
    shape: (d) => (Array.isArray(d.events) && d.events.length ? null : "events[] missing or empty"),
    notes: (d) => ({ events: d.events?.length ?? 0 }),
  },
  {
    name: "news",
    kvKey: NEWS_KV_KEY,
    critical: false,
    // The one key the Worker does not own: Google News blocks Worker IPs, so a
    // Claude routine writes it out-of-band. Nothing in the cron can refresh it,
    // which is why lastRefresh is null here rather than a result.
    cadence: "~daily (out-of-band routine, not the cron)",
    cronOwned: false,
    freshSeconds: 129600,
    staleSeconds: 604800,
    serves: ["/news", "/api/news", "/news.xml"],
    // An empty items array is acceptable: /news renders an honest "no recent
    // news" rather than an error. Absent is not.
    shape: (d) => (Array.isArray(d.items) ? null : "items[] missing (empty is acceptable; absent is not)"),
    notes: (d) => ({ items: d.items?.length ?? 0 }),
  },
];

// Age in whole seconds, or null when the stamp is missing/unparseable.
function ageSeconds(iso, now) {
  const t = Date.parse(iso ?? "");
  return Number.isFinite(t) ? Math.max(0, Math.round((now - t) / 1000)) : null;
}

function freshnessOf(age, feed) {
  if (age == null) return "unknown";
  if (age <= feed.freshSeconds) return "fresh";
  if (age <= feed.staleSeconds) return "stale";
  return "expired";
}

// One feed's verdict, from its cached entry alone.
function checkFeed(feed, raw, cron, now) {
  const check = {
    status: "ok",
    critical: !!feed.critical,
    cadence: feed.cadence,
    serves: feed.serves,
    kv: "ok",
    updated: null,
    ageSeconds: null,
    freshness: "unknown",
    thresholds: { freshSeconds: feed.freshSeconds, staleSeconds: feed.staleSeconds },
    shape: "ok",
    lastRefresh: null,
    problems: [],
  };

  // KV-level outcomes first, and kept distinct from data-level ones: a binding
  // or parse failure is an infrastructure problem, a missing key is a cold
  // cache, and stale data is neither.
  if (raw.error) {
    check.kv = "unreadable";
    check.status = "unhealthy";
    check.problems.push(`KV read failed: ${raw.error}`);
    return check;
  }
  if (raw.value == null) {
    check.kv = "missing";
    check.status = "unhealthy";
    check.problems.push("no cached entry (key absent or null)");
    return check;
  }

  const d = raw.value;
  const bad = feed.shape(d);
  if (bad) {
    check.shape = "invalid";
    check.status = "unhealthy";
    check.problems.push(`unusable data: ${bad}`);
  }

  check.updated = d.updated ?? null;
  check.ageSeconds = ageSeconds(d.updated, now);
  check.freshness = freshnessOf(check.ageSeconds, feed);
  if (check.freshness === "expired") {
    check.status = worst(check.status, "unhealthy");
    check.problems.push(`data expired: ${check.ageSeconds}s old, over the ${feed.staleSeconds}s limit`);
  } else if (check.freshness === "stale") {
    check.status = worst(check.status, "degraded");
    check.problems.push(`data stale: ${check.ageSeconds}s old, over the ${feed.freshSeconds}s freshness window`);
  } else if (check.freshness === "unknown") {
    check.status = worst(check.status, "degraded");
    check.problems.push("no `updated` timestamp — age cannot be judged");
  }

  // Last refresh ATTEMPT, where it is tracked at all. A failing upstream with
  // still-fresh data is the early warning that precedes staleness, so it
  // degrades even while the data is fine.
  if (feed.cronOwned === false) {
    check.lastRefresh = { tracked: false, reason: "written out-of-band by the news routine, not the cron" };
  } else if (cron?.feeds?.[feed.name]) {
    const r = cron.feeds[feed.name];
    check.lastRefresh = { tracked: true, ...r };
    if (r.ok === false) {
      check.status = worst(check.status, "degraded");
      check.problems.push(`last refresh attempt failed: ${r.error || "unknown error"}`);
    }
  } else {
    check.lastRefresh = { tracked: true, recorded: false, reason: "no cron run recorded yet since this was deployed" };
  }

  if (feed.notes) check.data = feed.notes(d);
  return check;
}

// The whole report. Returns {status, httpStatus, body} so the route stays a
// thin serializer and this stays testable without a Request.
export async function healthReport(env) {
  const now = Date.now();
  const checkedAt = new Date(now).toISOString();

  // Deployment identity, so a monitor can tie a symptom to a specific release.
  // Optional binding — absent in local dev and on any deploy predating it, so
  // never assume its shape.
  const v = env?.CF_VERSION_METADATA;
  const version = v ? { id: v.id ?? null, tag: v.tag ?? null, timestamp: v.timestamp ?? null } : null;

  // Presence only, never values. A missing optional secret is not an error —
  // each feature degrades on its own — but knowing which are unset explains a
  // lot of otherwise-confusing behavior (no AirNow key => modeled AQI).
  const bindings = {
    WEATHER: env?.WEATHER ? "bound" : "MISSING",
    AIRNOW_API_KEY: env?.AIRNOW_API_KEY ? "set" : "unset",
    USGS_API_KEY: env?.USGS_API_KEY ? "set" : "unset",
    VAPID_PUBLIC_KEY: env?.VAPID_PUBLIC_KEY ? "set" : "unset",
    VAPID_PRIVATE_KEY: env?.VAPID_PRIVATE_KEY ? "set" : "unset",
    ADMIN_KEY: env?.ADMIN_KEY ? "set" : "unset",
  };

  const worker = {
    status: env?.WEATHER ? "ok" : "unhealthy",
    // Reaching this line IS the runtime check: dispatch, routing and response
    // generation all already happened. Stated rather than measured, because
    // measuring it from inside would be theatre.
    runtime: "responding",
    version,
    bindings,
  };

  // Without the KV binding there is nothing further to check, and every feed
  // would report an identical misleading "missing".
  if (!env?.WEATHER) {
    return {
      status: "unhealthy",
      httpStatus: 503,
      body: {
        status: "unhealthy",
        updated: null,
        checkedAt,
        worker,
        feeds: {},
        summary: { total: 0, ok: 0, degraded: 0, unhealthy: 0, problems: ["WEATHER KV binding is missing — no cached data is reachable"] },
      },
    };
  }

  // One read per feed plus the cron report, all in parallel, all read-only.
  const read = async (key) => {
    try {
      return { value: await env.WEATHER.get(key, "json") };
    } catch (e) {
      // .get(key, "json") throws on a value that is not valid JSON — the case
      // that must NOT be reported as merely stale.
      return { error: (e && e.message) || String(e) };
    }
  };
  const [cronRaw, ...raws] = await Promise.all([read(CRON_STATUS_KV_KEY), ...FEEDS.map((f) => read(f.kvKey))]);
  const cron = cronRaw.value || null;

  const feeds = {};
  for (let i = 0; i < FEEDS.length; i++) feeds[FEEDS[i].name] = checkFeed(FEEDS[i], raws[i], cron, now);

  const summary = { total: FEEDS.length, ok: 0, degraded: 0, unhealthy: 0, problems: [] };
  let overall = worker.status;
  for (const [name, c] of Object.entries(feeds)) {
    summary[c.status]++;
    for (const p of c.problems) summary.problems.push(`${name}: ${p}`);
    // A non-critical failure degrades the service; only a critical one takes it
    // down. This is the whole point of the critical flag.
    overall = worst(overall, c.critical ? c.status : c.status === "unhealthy" ? "degraded" : c.status);
  }

  return {
    status: overall,
    // 503 only when something critical is broken, so a monitor's default
    // "non-2xx = down" rule fires for outages and not for a stale pollen count.
    // `degraded` is deliberately a 200: the service is still serving useful
    // data, and the detail is in the body for anyone who looks.
    httpStatus: overall === "unhealthy" ? 503 : 200,
    body: {
      status: overall,
      // Kept at the top level for backward compatibility: the previous version
      // of this endpoint returned {status, updated} and that is what any
      // existing consumer reads.
      updated: feeds.weather?.updated ?? null,
      checkedAt,
      cronLastRun: cron?.at ?? null,
      worker,
      feeds,
      summary,
    },
  };
}

// --- cron side -------------------------------------------------------------

// Build a recorder the cron threads through its refreshes. Kept here, next to
// the reader, so the record's shape has exactly one definition.
export function cronRunRecorder() {
  const feeds = {};
  return {
    ok: (name) => { feeds[name] = { ok: true, at: new Date().toISOString() }; },
    // A throttled feed that was not due is neither a success nor a failure, and
    // conflating it with a success would hide a feed that stopped refreshing.
    skipped: (name, reason) => { feeds[name] = { ok: true, skipped: true, reason, at: new Date().toISOString() }; },
    failed: (name, err) => { feeds[name] = { ok: false, at: new Date().toISOString(), error: (err && err.message) || String(err) }; },
    snapshot: () => ({ at: new Date().toISOString(), feeds }),
  };
}

// Persist the run. Own try/catch and last in the tick: health reporting must
// never be able to break the refresh it reports on.
export async function recordCronRun(env, recorder) {
  try {
    await env.WEATHER.put(CRON_STATUS_KV_KEY, JSON.stringify(recorder.snapshot()));
  } catch (e) {
    console.error("cron status write failed:", e && e.stack);
  }
}
