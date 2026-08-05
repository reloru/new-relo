// Exercise /api/health's state machine directly, with stubbed KV.
//
// healthReport(env) is a pure function of `env` on purpose: it reads KV and
// nothing else, so every branch — unreadable, missing, malformed, stale,
// expired, refresh-failed, critical vs not — can be driven from a fake binding
// with no server, no network, and no clock games beyond the timestamps we hand
// it.
//
// This matters more than a smoke test would. The endpoint's whole value is that
// it distinguishes cases that used to look identical, and the only way to know
// it does is to construct each case and assert the verdict differs.
//
// Run: node scripts/test-health.mjs

import { healthReport, FEEDS, CRON_STATUS_KV_KEY } from "../src/api/health.js";

const ISO = (msAgo = 0) => new Date(Date.now() - msAgo).toISOString();
const period = {
  number: 1, name: "Now", startTime: ISO(30 * 60000), endTime: ISO(-30 * 60000),
  isDaytime: true, temperature: 78, temperatureUnit: "F", shortForecast: "Sunny",
  detailedForecast: "Sunny.", windSpeed: "5 mph", windDirection: "SW",
  probabilityOfPrecipitation: { value: 10 }, relativeHumidity: { value: 60 },
  icon: "https://api.weather.gov/icons/land/day/few?size=small",
};

// A healthy snapshot for every feed, all stamped "just now".
function healthyStore(age = 0) {
  return {
    weather: { updated: ISO(age), place: "Crosby, TX", hourly: [period], periods: [period], alerts: [], uv: { hourly: [1] }, aqi: { usAqi: 38, measured: true } },
    water: { updated: ISO(age), gauges: [{ id: "x", name: "Cedar Bayou" }] },
    fishing: { updated: ISO(age), stations: [{ id: "1", params: {} }] },
    traffic: { updated: ISO(age), incidents: [], closures: [] },
    tropics: { updated: ISO(age), storms: [] },
    pollen: { updated: ISO(age), countDate: "2026-08-05", groups: { tree: { category: "Low" } } },
    calendar: { updated: ISO(age), events: [{ summary: "E" }] },
    news: { updated: ISO(age), items: [{ title: "T" }] },
    [CRON_STATUS_KV_KEY]: { at: ISO(age), feeds: Object.fromEntries(FEEDS.filter((f) => f.cronOwned !== false).map((f) => [f.name, { ok: true, at: ISO(age) }])) },
  };
}

// `store` maps key -> value, or key -> Error to simulate a KV/parse failure.
const envWith = (store, extra = {}) => ({
  WEATHER: {
    get: async (key) => {
      const v = store[key];
      if (v instanceof Error) throw v;
      return v ?? null;
    },
  },
  ...extra,
});

let failures = 0;
async function check(label, env, expect) {
  const r = await healthReport(env);
  const got = { status: r.status, httpStatus: r.httpStatus, ...expect.probe?.(r.body) };
  const want = { status: expect.status, httpStatus: expect.httpStatus, ...expect.want };
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) {
    console.log(`          got  ${JSON.stringify(got)}`);
    console.log(`          want ${JSON.stringify(want)}`);
  }
}

console.log("\n/api/health state machine:\n");

// --- the healthy baseline --------------------------------------------------
await check("all feeds fresh and well-shaped -> ok / 200", envWith(healthyStore()), {
  status: "ok", httpStatus: 200,
  probe: (b) => ({ unhealthy: b.summary.unhealthy, degraded: b.summary.degraded, problems: b.summary.problems.length }),
  want: { unhealthy: 0, degraded: 0, problems: 0 },
});

// --- the distinction the old endpoint could not make ------------------------
// Each of these used to return an identical 200 {"status":"ok"}.

await check("weather KV unreadable (corrupt JSON) -> unhealthy / 503", envWith({ ...healthyStore(), weather: new Error("Unexpected token") }), {
  status: "unhealthy", httpStatus: 503,
  probe: (b) => ({ kv: b.feeds.weather.kv, shape: b.feeds.weather.shape }),
  want: { kv: "unreadable", shape: "ok" },
});

await check("weather key absent (cold cache) -> unhealthy / 503", envWith({ ...healthyStore(), weather: null }), {
  status: "unhealthy", httpStatus: 503,
  probe: (b) => ({ kv: b.feeds.weather.kv }),
  want: { kv: "missing" },
});

await check("weather present but hourly[] empty -> unhealthy / 503", envWith({ ...healthyStore(), weather: { updated: ISO(0), hourly: [], periods: [period], alerts: [] } }), {
  status: "unhealthy", httpStatus: 503,
  probe: (b) => ({ kv: b.feeds.weather.kv, shape: b.feeds.weather.shape }),
  want: { kv: "ok", shape: "invalid" },
});

// A freshly-fetched but fully-elapsed forecast window: `updated` is seconds old,
// every period is in the past. Parses fine, renders a hero, useless to a reader.
await check("weather fetched just now but forecast window elapsed -> unhealthy / 503", envWith({
  ...healthyStore(),
  weather: { updated: ISO(0), hourly: [{ ...period, startTime: ISO(7200000), endTime: ISO(3600000) }], periods: [period], alerts: [] },
}), {
  status: "unhealthy", httpStatus: 503,
  probe: (b) => ({ freshness: b.feeds.weather.freshness, shape: b.feeds.weather.shape }),
  want: { freshness: "fresh", shape: "invalid" },
});

// Pins the reason the check above cannot be written as `!currentHourly(d)`:
// currentHourly falls back to the last already-started period rather than
// returning null, so the hero degrades to the most recent known hour instead of
// going blank. Deliberate for rendering; it also makes it useless as a probe.
{
  const { currentHourly } = await import("../src/lib/derived.js");
  const allPast = { hourly: [{ ...period, startTime: ISO(7200000), endTime: ISO(3600000) }] };
  const ok = currentHourly(allPast) !== null && currentHourly({ hourly: [] }) === null;
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  currentHourly() falls back to the last started period (never null when non-empty)`);
}

// --- freshness, per feed ----------------------------------------------------
await check("weather 1h old (past fresh, inside stale) -> degraded / 200", envWith({ ...healthyStore(), weather: { ...healthyStore().weather, updated: ISO(3600 * 1000) } }), {
  status: "degraded", httpStatus: 200,
  probe: (b) => ({ freshness: b.feeds.weather.freshness }),
  want: { freshness: "stale" },
});

await check("weather 3h old (past stale) -> unhealthy / 503", envWith({ ...healthyStore(), weather: { ...healthyStore().weather, updated: ISO(3 * 3600 * 1000) } }), {
  status: "unhealthy", httpStatus: 503,
  probe: (b) => ({ freshness: b.feeds.weather.freshness }),
  want: { freshness: "expired" },
});

// The point of per-feed thresholds: the same age is fine for one feed and not
// another. 4h is expired for weather (2h limit) but fresh for the calendar (8h).
await check("calendar 4h old -> still fresh (its own cadence is ~6h)", envWith({ ...healthyStore(), calendar: { ...healthyStore().calendar, updated: ISO(4 * 3600 * 1000) } }), {
  status: "ok", httpStatus: 200,
  probe: (b) => ({ calendar: b.feeds.calendar.freshness, weatherWouldBe: b.feeds.weather.freshness }),
  want: { calendar: "fresh", weatherWouldBe: "fresh" },
});

// --- critical vs non-critical ----------------------------------------------
await check("non-critical feed dead (fishing missing) -> degraded / 200, NOT 503", envWith({ ...healthyStore(), fishing: null }), {
  status: "degraded", httpStatus: 200,
  probe: (b) => ({ feed: b.feeds.fishing.status, critical: b.feeds.fishing.critical, unhealthyCount: b.summary.unhealthy }),
  want: { feed: "unhealthy", critical: false, unhealthyCount: 1 },
});

await check("every non-critical feed dead -> still degraded / 200 (weather is fine)", envWith({
  ...Object.fromEntries(Object.keys(healthyStore()).map((k) => [k, k === "weather" || k === CRON_STATUS_KV_KEY ? healthyStore()[k] : null])),
}), {
  status: "degraded", httpStatus: 200,
  probe: (b) => ({ weather: b.feeds.weather.status, unhealthyCount: b.summary.unhealthy }),
  want: { weather: "ok", unhealthyCount: 7 },
});

// --- last refresh attempt ---------------------------------------------------
await check("upstream failing but data still fresh -> degraded / 200 (early warning)", envWith({
  ...healthyStore(),
  [CRON_STATUS_KV_KEY]: { at: ISO(0), feeds: { water: { ok: false, at: ISO(0), error: "NWPS 503" } } },
}), {
  status: "degraded", httpStatus: 200,
  probe: (b) => ({ water: b.feeds.water.status, freshness: b.feeds.water.freshness, refreshOk: b.feeds.water.lastRefresh.ok }),
  want: { water: "degraded", freshness: "fresh", refreshOk: false },
});

await check("throttled feed skipped this tick -> not a failure", envWith({
  ...healthyStore(),
  [CRON_STATUS_KV_KEY]: { at: ISO(0), feeds: { calendar: { ok: true, skipped: true, reason: "still within the throttle window", at: ISO(0) } } },
}), {
  status: "ok", httpStatus: 200,
  probe: (b) => ({ calendar: b.feeds.calendar.status, skipped: b.feeds.calendar.lastRefresh.skipped }),
  want: { calendar: "ok", skipped: true },
});

await check("news refresh is untracked (routine-owned, not the cron)", envWith(healthyStore()), {
  status: "ok", httpStatus: 200,
  probe: (b) => ({ tracked: b.feeds.news.lastRefresh.tracked }),
  want: { tracked: false },
});

// --- worker / bindings ------------------------------------------------------
await check("KV binding missing entirely -> unhealthy / 503", { AIRNOW_API_KEY: "x" }, {
  status: "unhealthy", httpStatus: 503,
  probe: (b) => ({ worker: b.worker.status, kv: b.worker.bindings.WEATHER, feeds: Object.keys(b.feeds).length }),
  want: { worker: "unhealthy", kv: "MISSING", feeds: 0 },
});

await check("optional secrets reported as presence only, never values", envWith(healthyStore(), { AIRNOW_API_KEY: "super-secret", CF_VERSION_METADATA: { id: "v1", tag: "", timestamp: ISO(0) } }), {
  status: "ok", httpStatus: 200,
  probe: (b) => ({ airnow: b.worker.bindings.AIRNOW_API_KEY, leaked: JSON.stringify(b).includes("super-secret"), versionId: b.worker.version.id }),
  want: { airnow: "set", leaked: false, versionId: "v1" },
});

await check("version metadata absent -> null, not a failure", envWith(healthyStore()), {
  status: "ok", httpStatus: 200,
  probe: (b) => ({ version: b.worker.version }),
  want: { version: null },
});

// --- backward compatibility -------------------------------------------------
await check("keeps the old {status, updated} contract at the top level", envWith(healthyStore()), {
  status: "ok", httpStatus: 200,
  probe: (b) => ({ hasStatus: typeof b.status === "string", hasUpdated: typeof b.updated === "string" }),
  want: { hasStatus: true, hasUpdated: true },
});

console.log(
  failures
    ? `\n${failures} health check(s) FAILED\n`
    : `\nHealth endpoint OK — every state distinguished, criticality respected.\n`,
);
process.exit(failures ? 1 : 0);
